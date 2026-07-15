import { jsonSchema } from 'ai';
import type { IMCPClient } from './mcp-client';

// ToolDefinition 把两类信息合并在一个接口里：
// - 模型层（name/description/parameters）：AI SDK 需要，决定模型怎么调用这个工具
// - 运行时层（isConcurrencySafe/isReadOnly/maxResultChars）：Agent Loop 需要，决定怎么管理执行
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  isConcurrencySafe?: boolean; // true = 只读，可与其他只读工具并行；false = 有副作用，独占执行
  isReadOnly?: boolean;
  maxResultChars?: number;     // 结果超出此长度时触发 Head/Tail 截断，防止撑爆上下文
  deferred?: boolean;          // true = 延迟加载：schema 不进初始工具表，需经 tool_search 激活
  execute: (input: any) => Promise<unknown>;
}

const DEFAULT_MAX_RESULT_CHARS = 3000;

// ToolRegistry 做三件事：注册工具、查找工具、转换成 AI SDK 需要的格式。
// 注册一次，Agent Loop 和 AI SDK 都能用，工具定义不再散落各处。
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  // 读写锁三个状态变量：
  // exclusiveLock  — 当前是否有写操作持有独占锁
  // concurrentCount — 当前持有共享锁（读操作）的数量
  // waitQueue      — 阻塞等待中的 resolve 函数，释放锁时全部唤醒重新抢
  private exclusiveLock = false;
  private concurrentCount = 0;
  private waitQueue: Array<() => void> = [];

  // 已连接的 MCP Client，进程退出时统一 close。
  private mcpClients: IMCPClient[] = [];

  // 被 tool_search 激活的 deferred 工具。激活状态跟着 registry 走：
  // 一次会话里搜过的工具，后续每轮都直接可用，不用重复搜。
  private activated = new Set<string>();

  register(...tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  // 连接一个 MCP Server，发现它暴露的工具，逐个注册进 Registry。
  // 注册完成后，MCP 工具和内置工具走完全相同的截断 + 并发管线，Agent Loop 无需区分来源。
  async registerMCPServer(
    serverName: string,
    client: IMCPClient,
    options: { deferred?: boolean } = {},
  ): Promise<string[]> {
    await client.connect();
    this.mcpClients.push(client);

    const tools = await client.listTools();
    const registered: string[] = [];

    for (const tool of tools) {
      // 命名空间前缀 mcp__<server>__<tool>：避免不同 Server 同名工具互相覆盖，
      // 模型看到前缀也能一眼识别这是外部工具（Claude Code 用的同一方案）。
      const prefixedName = `mcp__${serverName}__${tool.name}`;
      if (this.tools.has(prefixedName)) continue;

      const originalName = tool.name;
      this.register({
        name: prefixedName,
        // [MCP:xxx] 前缀是给调试看的：结果不对时，一眼分辨是内置工具还是 MCP Server 的问题。
        description: `[MCP:${serverName}] ${tool.description}`,
        parameters: tool.inputSchema,
        isConcurrencySafe: true, // MCP 工具通常是无状态 API 调用，天然可并发（写操作需另行标 false）
        isReadOnly: true,
        maxResultChars: 3000,
        deferred: options.deferred,
        // execute 是个闭包，调用时通过 JSON-RPC 转发给 Server。
        execute: async (input: any) => client.callTool(originalName, input),
      });
      registered.push(prefixedName);
    }

    return registered;
  }

  async closeAllMCP(): Promise<void> {
    for (const client of this.mcpClients) {
      await client.close();
    }
    this.mcpClients = [];
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  activate(...names: string[]): void {
    for (const name of names) {
      if (this.tools.has(name)) this.activated.add(name);
    }
  }

  // 未激活的 deferred 工具 —— tool_search 的搜索范围。
  getDeferred(): ToolDefinition[] {
    return this.getAll().filter(t => t.deferred && !this.activated.has(t.name));
  }

  // 共享锁：有独占锁时挂起，否则直接 concurrentCount++
  private async acquireConcurrent(): Promise<void> {
    while (this.exclusiveLock) {
      await new Promise<void>(r => this.waitQueue.push(r));
    }
    this.concurrentCount++;
  }

  private releaseConcurrent(): void {
    this.concurrentCount--;
    // 最后一个读操作释放后才唤醒等待的写操作
    if (this.concurrentCount === 0) this.drainQueue();
  }

  // 独占锁：必须等所有读操作结束且无其他写操作才能持有
  private async acquireExclusive(): Promise<void> {
    while (this.exclusiveLock || this.concurrentCount > 0) {
      await new Promise<void>(r => this.waitQueue.push(r));
    }
    this.exclusiveLock = true;
  }

  private releaseExclusive(): void {
    this.exclusiveLock = false;
    this.drainQueue();
  }

  // 释放锁时一次性唤醒所有等待者，让它们重新竞争锁，避免饥饿
  private drainQueue(): void {
    const waiting = this.waitQueue.splice(0);
    for (const resolve of waiting) resolve();
  }

  // 把 ToolDefinition 转换成 AI SDK 的工具格式，同时在 execute 包装层注入：
  // 1. 读写锁（按 isConcurrencySafe 决定共享 or 独占）
  // 2. 结果截断（按 maxResultChars）
  // Agent Loop 直接把返回值传给 streamText，不需要关心这两层细节。
  toAISDKFormat(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [name, tool] of this.tools) {
      // 未激活的 deferred 工具对模型不可见 —— 这就是「延迟加载」的全部机制。
      if (tool.deferred && !this.activated.has(name)) continue;
      const maxChars = tool.maxResultChars;
      const executeFn = tool.execute;
      const isSafe = tool.isConcurrencySafe === true;
      const registry = this;

      result[name] = {
        description: tool.description,
        inputSchema: jsonSchema(tool.parameters as any),
        execute: async (input: any) => {
          if (isSafe) {
            await registry.acquireConcurrent();
          } else {
            await registry.acquireExclusive();
          }
          try {
            const raw = await executeFn(input);
            const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
            return truncateResult(text, maxChars);
          } finally {
            // 不管成功还是抛异常，锁都要还回去，否则 Registry 会死锁
            if (isSafe) {
              registry.releaseConcurrent();
            } else {
              registry.releaseExclusive();
            }
          }
        },
      };
    }
    return result;
  }
}

// Head/Tail 60/40 截断：保留头部（标题/开头）和尾部（最新内容/最后改动），跳过中间冗余部分
export function truncateResult(text: string, maxChars: number = DEFAULT_MAX_RESULT_CHARS): string {
  if (text.length <= maxChars) return text;

  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = maxChars - headSize;
  const head = text.slice(0, headSize);
  const tail = text.slice(-tailSize);
  const dropped = text.length - headSize - tailSize;

  return `${head}\n\n... [省略 ${dropped} 字符] ...\n\n${tail}`;
}
