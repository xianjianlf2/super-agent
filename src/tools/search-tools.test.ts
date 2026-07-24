import { describe, it, expect } from 'vitest';
import { ToolRegistry, type ToolDefinition } from './registry';
import { createToolSearchTool } from './search-tools';

const makeTool = (name: string, description: string, deferred = true): ToolDefinition => ({
  name,
  description,
  parameters: {
    type: 'object',
    properties: { input: { type: 'string' } },
    required: ['input'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  deferred,
  execute: async () => 'ok',
});

// ── Registry 延迟加载 ───────────────────────────────────────────────────────

describe('ToolRegistry 延迟加载', () => {
  it('deferred 工具不出现在 toAISDKFormat，常驻工具正常出现', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('core_tool', '核心工具', false));
    registry.register(makeTool('lazy_tool', '延迟工具'));

    const formatted = registry.toAISDKFormat();
    expect(formatted).toHaveProperty('core_tool');
    expect(formatted).not.toHaveProperty('lazy_tool');
  });

  it('activate 后 deferred 工具出现在 toAISDKFormat', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('lazy_tool', '延迟工具'));

    registry.activate('lazy_tool');
    expect(registry.toAISDKFormat()).toHaveProperty('lazy_tool');
  });

  it('getDeferred 只返回未激活的 deferred 工具', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('core_tool', '核心', false));
    registry.register(makeTool('lazy_a', 'A'));
    registry.register(makeTool('lazy_b', 'B'));

    registry.activate('lazy_a');
    const names = registry.getDeferred().map(t => t.name);
    expect(names).toEqual(['lazy_b']);
  });

  it('getAll 不受延迟状态影响，始终返回全部', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('core_tool', '核心', false));
    registry.register(makeTool('lazy_tool', '延迟'));
    expect(registry.getAll()).toHaveLength(2);
  });
});

// ── tool_search 元工具 ──────────────────────────────────────────────────────

function setupGitHubLike() {
  const registry = new ToolRegistry();
  registry.register(makeTool('read_file', '读取文件内容', false));
  registry.register(makeTool('mcp__github__create_issue', '[MCP:github] Create a new issue in a GitHub repository'));
  registry.register(makeTool('mcp__github__list_issues', '[MCP:github] List issues in a GitHub repository'));
  registry.register(makeTool('mcp__github__add_issue_comment', '[MCP:github] Add a comment to an existing issue'));
  registry.register(makeTool('mcp__github__create_pull_request', '[MCP:github] Create a new pull request'));
  registry.register(makeTool('mcp__github__search_code', '[MCP:github] Search for code across repositories'));
  const toolSearch = createToolSearchTool(registry);
  return { registry, toolSearch };
}

describe('tool_search 关键词搜索', () => {
  it('按关键词匹配 name 和 description，返回完整 schema', async () => {
    const { toolSearch } = setupGitHubLike();
    const result = JSON.parse(await toolSearch.execute({ query: 'issue comment' }) as string);

    const names = result.tools.map((t: any) => t.name);
    expect(names).toContain('mcp__github__add_issue_comment');
    // 返回的是完整 schema，模型下一步就能正确构造参数
    expect(result.tools[0]).toHaveProperty('parameters');
    expect(result.tools[0].parameters).toHaveProperty('type', 'object');
  });

  it('name 命中的排在只有 description 命中的前面', async () => {
    const { toolSearch } = setupGitHubLike();
    const result = JSON.parse(await toolSearch.execute({ query: 'issue' }) as string);
    const names = result.tools.map((t: any) => t.name);

    // name 里带 issue 的（create_issue/list_issues/add_issue_comment）应排在
    // 只有 description 提到 issue 的工具前面
    expect(names.slice(0, 3)).toEqual(
      expect.arrayContaining(['mcp__github__create_issue', 'mcp__github__list_issues', 'mcp__github__add_issue_comment']),
    );
  });

  it('搜索命中即激活：匹配到的工具进入 toAISDKFormat', async () => {
    const { registry, toolSearch } = setupGitHubLike();
    expect(registry.toAISDKFormat()).not.toHaveProperty('mcp__github__create_issue');

    await toolSearch.execute({ query: 'create issue' });
    expect(registry.toAISDKFormat()).toHaveProperty('mcp__github__create_issue');
  });

  it('结果数量受 top N 限制（默认 5）', async () => {
    const registry = new ToolRegistry();
    for (let i = 0; i < 10; i++) {
      registry.register(makeTool(`github_tool_${i}`, 'github related tool'));
    }
    const toolSearch = createToolSearchTool(registry);
    const result = JSON.parse(await toolSearch.execute({ query: 'github' }) as string);
    expect(result.tools).toHaveLength(5);
    expect(result.omitted).toBe(5); // 明确告诉模型还有多少个没展示
  });

  it('无匹配时返回提示而不是空数组静默失败', async () => {
    const { toolSearch } = setupGitHubLike();
    const result = JSON.parse(await toolSearch.execute({ query: 'kubernetes 部署' }) as string);
    expect(result.tools).toHaveLength(0);
    expect(result.message).toContain('未找到');
  });

  it('已激活的工具不再出现在搜索结果里', async () => {
    const { registry, toolSearch } = setupGitHubLike();
    registry.activate('mcp__github__create_issue');
    const result = JSON.parse(await toolSearch.execute({ query: 'create issue' }) as string);
    const names = result.tools.map((t: any) => t.name);
    expect(names).not.toContain('mcp__github__create_issue');
  });
});

describe('tool_search 词形归一', () => {
  it('单数搜复数能命中：repository 匹配 search_repositories', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('mcp__github__search_repositories', '[MCP:github] Search GitHub repositories'));
    registry.register(makeTool('mcp__github__create_repository', '[MCP:github] Create a new GitHub repository in your account'));
    const toolSearch = createToolSearchTool(registry);

    const result = JSON.parse(await toolSearch.execute({ query: 'repository stars' }) as string);
    const names = result.tools.map((t: any) => t.name);
    expect(names).toContain('mcp__github__search_repositories');
  });

  it('复数搜单数也能命中：issues 匹配 create_issue', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('mcp__github__create_issue', '[MCP:github] Create a new issue'));
    const toolSearch = createToolSearchTool(registry);

    const result = JSON.parse(await toolSearch.execute({ query: 'issues' }) as string);
    expect(result.tools.map((t: any) => t.name)).toContain('mcp__github__create_issue');
  });
});

describe('tool_search 剩余工具名单', () => {
  it('搜索结果附带其余未激活工具的名字列表，模型可用 select: 直取', async () => {
    const { toolSearch } = setupGitHubLike();
    const result = JSON.parse(await toolSearch.execute({ query: 'issue' }) as string);

    // 没进搜索结果的 deferred 工具，名字要出现在 otherDeferred 里
    expect(result.otherDeferred).toContain('mcp__github__create_pull_request');
    // 已进结果的不重复出现
    for (const t of result.tools) {
      expect(result.otherDeferred).not.toContain(t.name);
    }
  });

  it('无匹配时 message 提示用 select: 从名单直取', async () => {
    const { toolSearch } = setupGitHubLike();
    const result = JSON.parse(await toolSearch.execute({ query: 'kubernetes 部署' }) as string);
    expect(result.tools).toHaveLength(0);
    expect(result.message).toContain('select:');
    expect(result.otherDeferred.length).toBeGreaterThan(0);
  });
});

describe('tool_search select: 精确模式', () => {
  it('select:name 直接返回并激活指定工具', async () => {
    const { registry, toolSearch } = setupGitHubLike();
    const result = JSON.parse(
      await toolSearch.execute({ query: 'select:mcp__github__search_code' }) as string,
    );
    expect(result.tools.map((t: any) => t.name)).toEqual(['mcp__github__search_code']);
    expect(registry.toAISDKFormat()).toHaveProperty('mcp__github__search_code');
  });

  it('select 支持逗号分隔多个名字，不存在的名字报告在 notFound', async () => {
    const { toolSearch } = setupGitHubLike();
    const result = JSON.parse(
      await toolSearch.execute({ query: 'select:mcp__github__create_issue,no_such_tool' }) as string,
    );
    expect(result.tools.map((t: any) => t.name)).toEqual(['mcp__github__create_issue']);
    expect(result.notFound).toEqual(['no_such_tool']);
  });
});
