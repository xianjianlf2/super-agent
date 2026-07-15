import type { ToolRegistry, ToolDefinition } from './registry';

const DEFAULT_MAX_RESULTS = 5;

// tool_search 是「元工具」：不干业务，只在未激活的 deferred 工具里搜索，
// 返回匹配工具的完整 schema 并激活 —— 下一步它们就会出现在模型的工具表里。
// 效果：长尾工具的肥 schema 不再每步都进 prompt，用到哪类才加载哪类。
export function createToolSearchTool(registry: ToolRegistry): ToolDefinition {
  return {
    name: 'tool_search',
    description:
      '搜索延迟加载的工具。部分工具的定义没有直接提供给你，需要先用本工具按关键词搜索' +
      '（如 "issue 评论"），匹配到的工具会返回完整参数 schema 并在下一步变为可直接调用。' +
      '也支持 "select:工具名1,工具名2" 按名字精确获取。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，或 "select:name1,name2" 精确选择',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    isConcurrencySafe: true,
    isReadOnly: true,
    // schema 本身就是要完整交给模型的内容，给个宽松上限避免被截断掐掉参数定义。
    maxResultChars: 8000,
    execute: async ({ query }: { query: string }) => {
      const trimmed = query.trim();
      const result = trimmed.toLowerCase().startsWith('select:')
        ? selectByName(registry, trimmed.slice('select:'.length))
        : searchByKeywords(registry, trimmed);

      registry.activate(...result.tools.map(t => t.name));

      // 附上剩余工具的名字（很便宜）：搜不准时模型直接 select:，不会反复搜索烧预算。
      const otherDeferred = registry.getDeferred().map(t => t.name);

      return JSON.stringify({
        ...result,
        tools: result.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        otherDeferred,
        ...(result.tools.length > 0
          ? { message: `以上 ${result.tools.length} 个工具已激活，下一步可直接调用。若都不合适，可用 "select:工具名" 从 otherDeferred 名单直取` }
          : { message: '未找到匹配的工具。请从 otherDeferred 名单里选择，用 "select:工具名" 直接获取' }),
      }, null, 2);
    },
  };
}

function selectByName(registry: ToolRegistry, names: string) {
  const tools: ToolDefinition[] = [];
  const notFound: string[] = [];
  for (const name of names.split(',').map(n => n.trim()).filter(Boolean)) {
    const tool = registry.get(name);
    if (tool) tools.push(tool);
    else notFound.push(name);
  }
  return { tools, notFound };
}

// 最简单复数归一。真实教训：搜 "repository" 时 "repositories".includes("repository")
// 是 false（y vs ies），相关工具怎么都搜不到，模型反复换词白烧了一整个 token 预算。
function variants(term: string): string[] {
  const v = new Set([term]);
  if (term.length > 4 && term.endsWith('ies')) v.add(term.slice(0, -3) + 'y');       // repositories → repository
  else if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss')) v.add(term.slice(0, -1)); // issues → issue
  if (term.endsWith('y')) v.add(term.slice(0, -1) + 'ie');                            // repository → repositorie(s)
  return [...v];
}

// 朴素计分：query 按空白分词，name 命中一词 3 分、description 命中 1 分。
// 教学项目不引搜索库，子串匹配（加词形归一）对 mcp__github__create_issue 这类命名已经够用。
function searchByKeywords(registry: ToolRegistry, query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = registry.getDeferred()
    .map(tool => {
      const name = tool.name.toLowerCase();
      const description = tool.description.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const forms = variants(term);
        if (forms.some(f => name.includes(f))) score += 3;
        else if (forms.some(f => description.includes(f))) score += 1;
      }
      return { tool, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, DEFAULT_MAX_RESULTS);
  return {
    tools: top.map(s => s.tool),
    omitted: scored.length - top.length,
  };
}
