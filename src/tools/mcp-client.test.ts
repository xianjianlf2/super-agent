import { describe, it, expect } from 'vitest';
import { ToolRegistry } from './registry';
import { MockMCPClient } from './mcp-client';

// ── MockMCPClient 接口 ──────────────────────────────────────────────────────

describe('MockMCPClient', () => {
  it('listTools 返回预设的 3 个 GitHub 工具', async () => {
    const client = new MockMCPClient();
    const tools = await client.listTools();
    expect(tools.map(t => t.name)).toEqual([
      'list_issues', 'search_repositories', 'get_file_contents',
    ]);
  });

  it('每个工具的 inputSchema 是合法 JSON Schema', async () => {
    const client = new MockMCPClient();
    const tools = await client.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema).toHaveProperty('type', 'object');
      expect(tool.inputSchema).toHaveProperty('properties');
    }
  });

  it('callTool 按工具名返回对应的 mock 数据', async () => {
    const client = new MockMCPClient();
    const issues = await client.callTool('list_issues', { owner: 'vercel', repo: 'ai' });
    expect(issues).toContain('支持 MCP 协议接入');

    const file = await client.callTool('get_file_contents', {
      owner: 'vercel', repo: 'ai', path: 'README.md',
    });
    expect(file).toContain('vercel/ai/README.md');
  });

  it('未知工具返回提示而非抛错', async () => {
    const client = new MockMCPClient();
    expect(await client.callTool('no_such', {})).toContain('未知工具');
  });
});

// ── registerMCPServer 命名空间隔离与注册 ────────────────────────────────────

describe('ToolRegistry.registerMCPServer', () => {
  it('注册的工具带 mcp__<server>__ 前缀', async () => {
    const registry = new ToolRegistry();
    const names = await registry.registerMCPServer('github', new MockMCPClient());
    expect(names).toContain('mcp__github__list_issues');
    expect(registry.get('mcp__github__list_issues')).toBeDefined();
  });

  it('MCP 工具默认可并发、只读、带 [MCP:server] 描述前缀', async () => {
    const registry = new ToolRegistry();
    await registry.registerMCPServer('github', new MockMCPClient());
    const tool = registry.get('mcp__github__list_issues')!;
    expect(tool.isConcurrencySafe).toBe(true);
    expect(tool.isReadOnly).toBe(true);
    expect(tool.description).toContain('[MCP:github]');
  });

  it('execute 转发到 client.callTool', async () => {
    const registry = new ToolRegistry();
    await registry.registerMCPServer('github', new MockMCPClient());
    const tool = registry.get('mcp__github__list_issues')!;
    const result = await tool.execute({ owner: 'vercel', repo: 'ai' }) as string;
    expect(result).toContain('支持 MCP 协议接入');
  });

  it('不同 server 同名工具不冲突', async () => {
    const registry = new ToolRegistry();
    await registry.registerMCPServer('github', new MockMCPClient());
    await registry.registerMCPServer('gitlab', new MockMCPClient());
    expect(registry.get('mcp__github__list_issues')).toBeDefined();
    expect(registry.get('mcp__gitlab__list_issues')).toBeDefined();
  });

  it('MCP 工具经 toAISDKFormat 后可被 Agent Loop 统一调用', async () => {
    const registry = new ToolRegistry();
    await registry.registerMCPServer('github', new MockMCPClient());
    const fmt = registry.toAISDKFormat();
    expect(fmt).toHaveProperty('mcp__github__list_issues');
    const result = await fmt.mcp__github__list_issues.execute({
      owner: 'vercel', repo: 'ai',
    }) as string;
    expect(result).toContain('支持 MCP 协议接入');
  });

  it('closeAllMCP 后清空 client 列表（可重复调用）', async () => {
    const registry = new ToolRegistry();
    await registry.registerMCPServer('github', new MockMCPClient());
    await registry.closeAllMCP();
    await registry.closeAllMCP(); // 幂等，不应抛错
  });
});
