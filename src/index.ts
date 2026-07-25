import 'dotenv/config';
import { argv, stdin, stdout } from 'node:process';
import { createLineReader } from './line-reader';
import { type ModelMessage } from 'ai';
import { compressionModel, model, useReal } from './model';
import { ToolRegistry, allTools, MCPClient, MockMCPClient, createToolSearchTool } from './tools';
import { agentLoop, type BudgetState } from './agent/loop';
import { JsonlSessionStore } from './session-store';
import { createPromptBuilder, type PromptPipe } from './prompt-builder';
import { microcompactToolResults } from './agent/microcompact';
import { summaryCompactMessages } from './agent/summary-compact';
import { estimateCharsAsTokens, estimateMessagesTokens } from './agent/token-estimate';

interface RuntimePromptContext {
  deferredToolCount: number;
  sessionMessageCount: number;
}

const identityPipe = (): PromptPipe<RuntimePromptContext> => () =>
  '你是 Super Agent，一个有工具调用能力的 AI 助手。';

const toolUsePipe = (): PromptPipe<RuntimePromptContext> => () =>
  '需要查询信息时，主动使用工具，不要编造数据。';

const toolSearchPipe = (): PromptPipe<RuntimePromptContext> => (ctx) =>
  ctx.deferredToolCount > 0
    ? `部分工具（如 GitHub 相关）是延迟加载的，不在你当前的工具表里：
需要时先用 tool_search 按关键词搜索，激活后即可直接调用。`
    : null;

const sessionContextPipe = (): PromptPipe<RuntimePromptContext> => (ctx) =>
  ctx.sessionMessageCount > 0
    ? `当前是恢复的历史会话，已加载 ${ctx.sessionMessageCount} 条历史消息作为上下文。`
    : null;

const answerStylePipe = (): PromptPipe<RuntimePromptContext> => () =>
  '回答要简洁直接。';

const promptBuilder = createPromptBuilder<RuntimePromptContext>()
  .pipe('coreRules', identityPipe())
  .pipe('toolGuide', toolUsePipe())
  .pipe('deferredTools', toolSearchPipe())
  .pipe('answerStyle', answerStylePipe())
  .pipe('sessionContext', sessionContextPipe());

const budget: BudgetState = { used: 0, limit: 40000 };
const MAX_SUMMARY_FAILURES = 3;
const summaryState = { consecutiveFailures: 0, disabled: false };

const sessionStore = new JsonlSessionStore();
const shouldContinue = argv.includes('--continue');
const shouldDebugPrompt = argv.includes('--debug-prompt');
const shouldDebugCompaction = argv.includes('--debug-compaction');
const shouldVerbose = argv.includes('--verbose');
const shouldDemoCompaction = argv.includes('--demo-compaction');
const messages: ModelMessage[] =
  shouldContinue && sessionStore.exists() ? sessionStore.load() : [];
const sessionMessageCount = messages.length;

function toolCallMessage(toolCallId: string, toolName: string, input: unknown): ModelMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId, toolName, input }],
  };
}

function toolResultMessage(toolCallId: string, toolName: string, value: string): ModelMessage {
  return {
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId, toolName, output: { type: 'text', value } }],
  };
}

function createDemoHistory(): ModelMessage[] {
  const largeDirectoryListing = [
    '[FILE] .env',
    '[FILE] package.json',
    '[FILE] pnpm-lock.yaml',
    '[FILE] README.md',
    '[FILE] sample-data.txt',
    '[DIR] src',
    '[DIR] src/agent',
    '[DIR] src/tools',
    '[DIR] demos',
    '[DIR] app',
    '[DIR] sample-project',
  ].join('\n') + '\n' + '历史目录输出，用于演示 Microcompact 清理旧工具结果。\n'.repeat(80);

  return [
    { role: 'user', content: '先列出当前目录，看看这个项目里有什么。' },
    toolCallMessage('demo-call-1', 'list_directory', { path: '.' }),
    toolResultMessage('demo-call-1', 'list_directory', largeDirectoryListing),
    { role: 'assistant', content: '当前目录包含 `.env`、`package.json`、`sample-data.txt`、`src/` 等文件和目录。' },

    { role: 'user', content: '读取 `package.json`，确认项目名和脚本。' },
    toolCallMessage('demo-call-2', 'read_file', { path: 'package.json' }),
    toolResultMessage('demo-call-2', 'read_file', '{\n  "name": "super-agent-08-compaction",\n  "scripts": {\n    "start": "tsx src/index.ts",\n    "test": "vitest run"\n  }\n}'),
    { role: 'assistant', content: '`package.json` 显示项目名是 `super-agent-08-compaction`，启动脚本是 `pnpm start`。' },

    { role: 'user', content: '搜索 `ToolRegistry` 在哪里实现。' },
    toolCallMessage('demo-call-3', 'grep_files', { keyword: 'ToolRegistry', cwd: 'src' }),
    toolResultMessage('demo-call-3', 'grep_files', 'tools/registry.ts:22:export class ToolRegistry {\ntools/index.ts:1:import { ToolRegistry } from "./registry";'),
    { role: 'assistant', content: '`ToolRegistry` 主要在 `src/tools/registry.ts` 中实现。' },

    { role: 'user', content: '读取 `src/tools/registry.ts` 的核心逻辑。' },
    toolCallMessage('demo-call-4', 'read_file', { path: 'src/tools/registry.ts', start_line: 20, end_line: 80 }),
    toolResultMessage('demo-call-4', 'read_file', 'export class ToolRegistry {\n  private tools = new Map<string, ToolDefinition>();\n  register(...tools: ToolDefinition[]): void { ... }\n  toAISDKFormat(): Record<string, any> { ... }\n}'),
    { role: 'assistant', content: '`ToolRegistry` 负责注册工具、激活 deferred 工具，并转换成 AI SDK 工具格式。' },
  ];
}

if (shouldDemoCompaction && !shouldContinue && messages.length === 0) {
  messages.push(...createDemoHistory());
}

// 创建 registry 并注册所有工具。tool_search 元工具负责按需激活 deferred 工具。
const registry = new ToolRegistry();
registry.register(...allTools);
registry.register(createToolSearchTool(registry));

// 三层降级：有 token + 能 spawn → 连真实 GitHub MCP Server；连接出错 → 降级 Mock；
// 没 token → 直接 Mock。保证没有 MCP 时 Agent 核心功能不受影响，有了只是多外部能力。
async function connectMCP() {
  const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  let canSpawn = true;
  try {
    const { execSync } = await import('node:child_process');
    execSync('echo test', { stdio: 'ignore' });
  } catch {
    canSpawn = false;
  }

  if (githubToken && canSpawn) {
    if (shouldVerbose) console.log('\n连接 GitHub MCP Server...');
    try {
      const client = new MCPClient(
        'npx', ['-y', '@modelcontextprotocol/server-github'],
        { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
      );
      // MCP 工具长尾且 schema 肥，标为 deferred：不进初始工具表，经 tool_search 按需激活。
      const tools = await registry.registerMCPServer('github', client, { deferred: true });
      if (shouldVerbose) console.log(`  已注册 ${tools.length} 个 MCP 工具（延迟加载）`);
      return;
    } catch (err) {
      if (shouldVerbose) {
        console.log(`  MCP 连接失败: ${err instanceof Error ? err.message : err}`);
        console.log('  降级为 Mock MCP...');
      }
    }
  }

  if (!githubToken && shouldVerbose) {
    console.log('\n未配置 GITHUB_PERSONAL_ACCESS_TOKEN，使用 Mock MCP');
  }

  const mockClient = new MockMCPClient();
  const tools = await registry.registerMCPServer('github', mockClient, { deferred: true });
  if (shouldVerbose) console.log(`  已注册 ${tools.length} 个 Mock MCP 工具（延迟加载）`);
}

function summaryPreview(): string | null {
  const first = messages[0];
  if (first?.role !== 'user' || typeof first.content !== 'string') return null;
  if (!first.content.startsWith('[上下文摘要]\n')) return null;
  const summary = first.content.slice('[上下文摘要]\n'.length);
  return summary.length > 220 ? `${summary.slice(0, 220)}...` : summary;
}

function printTools() {
  const all = registry.getAll();
  const deferred = registry.getDeferred();
  console.log(`\n已注册 ${all.length} 个工具（${all.length - deferred.length} 个常驻 + ${deferred.length} 个延迟加载）：`);
  for (const tool of all) {
    const isMCP = tool.name.startsWith('mcp__');
    const source = isMCP ? 'MCP' : '内置';
    const flags = [source, tool.isConcurrencySafe ? '可并发' : '串行'];
    if (tool.deferred) flags.push('延迟');
    console.log(`  - ${tool.name}（${flags.join(', ')}）`);
  }
}

async function compactContext(reason: string) {
  const beforeCount = messages.length;
  const beforeTokens = estimateMessagesTokens(messages);
  if (shouldDebugCompaction) console.log(`[压缩前] ${beforeCount} 条消息, ~${beforeTokens} tokens`);

  const microStats = microcompactToolResults(messages);
  if (microStats.cleared > 0 && shouldDebugCompaction) {
    console.log(
      `[Layer 1: Microcompact] 清理了 ${microStats.cleared} 个工具结果, ~${estimateCharsAsTokens(microStats.savedChars)} tokens`,
    );
  }

  if (summaryState.disabled) {
    if (shouldDebugCompaction) {
      console.log(`[Layer 2: Summarization] 已跳过：连续失败 ${MAX_SUMMARY_FAILURES} 次后暂停压缩`);
      console.log(`[压缩后] ${messages.length} 条消息, ~${estimateMessagesTokens(messages)} tokens`);
    }
    return;
  }

  try {
    const summaryStats = await summaryCompactMessages(compressionModel, messages, budget);
    if (summaryStats.triggered) {
      summaryState.consecutiveFailures = 0;
      if (shouldDebugCompaction) {
        console.log(
          `[Layer 2: Summarization] 压缩了 ${summaryStats.compactedMessages} 条消息, ~${estimateCharsAsTokens(summaryStats.savedChars)} tokens`,
        );
        const preview = summaryPreview();
        if (preview) console.log(`[摘要预览] ${preview}`);
      }
    } else if (
      summaryStats.reason === 'invalid_summary_format' ||
      summaryStats.reason === 'summarize_failed'
    ) {
      summaryState.consecutiveFailures++;
      if (shouldDebugCompaction) {
        console.log(
          `[Layer 2: Summarization] 跳过：${summaryStats.reason}（连续失败 ${summaryState.consecutiveFailures}/${MAX_SUMMARY_FAILURES}）`,
        );
      }
      if (summaryState.consecutiveFailures >= MAX_SUMMARY_FAILURES) {
        summaryState.disabled = true;
        if (shouldDebugCompaction) console.log(`[Layer 2: Summarization] 连续失败 ${MAX_SUMMARY_FAILURES} 次，后续不再尝试摘要压缩`);
      }
    } else if (summaryStats.reason !== 'below_threshold' && shouldDebugCompaction) {
      console.log(`[Layer 2: Summarization] 跳过：${summaryStats.reason}`);
    }
  } catch (error) {
    summaryState.consecutiveFailures++;
    if (shouldDebugCompaction) {
      console.log(
        `  [${reason} SummaryCompact] 跳过：${error instanceof Error ? error.message : error}（连续失败 ${summaryState.consecutiveFailures}/${MAX_SUMMARY_FAILURES}）`,
      );
    }
    if (summaryState.consecutiveFailures >= MAX_SUMMARY_FAILURES) {
      summaryState.disabled = true;
      if (shouldDebugCompaction) console.log(`[Layer 2: Summarization] 连续失败 ${MAX_SUMMARY_FAILURES} 次，后续不再尝试摘要压缩`);
    }
  }

  if (shouldDebugCompaction) console.log(`[压缩后] ${messages.length} 条消息, ~${estimateMessagesTokens(messages)} tokens`);
}

async function main() {
  await connectMCP();
  if (shouldVerbose) printTools();

  // 用带缓冲的 line reader 替代 rl.question：管道输入多个问题时后续行不会丢，
  // 支持 printf 'q1\nq2\nexit\n' | pnpm start 这样的多轮测试。
  const rl = createLineReader(stdin, stdout);

  console.log(`\nSuper Agent v0.6 — ToolSearch 延迟加载（输入 exit 退出）  [${useReal ? '真实 Qwen' : 'Mock'}]\n`);
  if (shouldContinue && messages.length > 0) {
    console.log(`已从 ${sessionStore.filePath} 恢复 ${messages.length} 条历史消息\n`);
    await compactContext('启动');
  } else if (shouldDemoCompaction) {
    console.log(`[Session] 新会话（已注入 ${messages.length} 条模拟历史）\n`);
    await compactContext('启动');
  }
  console.log('试试："查看 vercel/ai 的 issues"、"帮我列一下当前目录的文件"、"北京天气"\n');

  while (true) {
    const input = (await rl.question('\nYou: '))?.trim();
    if (input == null || input === 'exit' || input === 'quit') {
      console.log('Bye!');
      break;
    }
    if (!input) continue;

    const userMessage: ModelMessage = { role: 'user', content: input };
    messages.push(userMessage);
    sessionStore.append(userMessage);

    const promptContext = {
      deferredToolCount: registry.getDeferred().length,
      sessionMessageCount,
    };
    const promptResult = promptBuilder.render(promptContext);
    if (shouldDebugPrompt) {
      console.log(`\n${promptResult.debug}\n`);
    }
    const system = promptResult.prompt;
    const loopResult = await agentLoop(model, registry, messages, system, budget, {
      verbose: shouldVerbose,
    });
    for (const message of loopResult.newMessages) {
      sessionStore.append(message);
    }
    await compactContext('轮次结束');
  }

  rl.close();
  // 退出前关掉 MCP 进程，避免留下孤儿进程。
  await registry.closeAllMCP();
}

main();
