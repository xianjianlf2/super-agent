import { jsonSchema } from 'ai';

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

  register(...tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
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
