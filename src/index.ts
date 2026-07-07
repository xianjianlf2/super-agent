import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { type ModelMessage } from 'ai';
import { model, useReal } from './model';
import { ToolRegistry, allTools, MCPClient, MockMCPClient } from './tools';
import { agentLoop, type BudgetState } from './agent-loop';

const SYSTEM = `你是 Super Agent，一个有工具调用能力的 AI 助手。
需要查询信息时，主动使用工具，不要编造数据。
回答要简洁直接。`;

const budget: BudgetState = { used: 0, limit: 40000 };

const messages: ModelMessage[] = [];

// 创建 registry 并注册所有工具
const registry = new ToolRegistry();
registry.register(...allTools);

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
    console.log('\n连接 GitHub MCP Server...');
    try {
      const client = new MCPClient(
        'npx', ['-y', '@modelcontextprotocol/server-github'],
        { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
      );
      const tools = await registry.registerMCPServer('github', client);
      console.log(`  已注册 ${tools.length} 个 MCP 工具`);
      return;
    } catch (err) {
      console.log(`  MCP 连接失败: ${err instanceof Error ? err.message : err}`);
      console.log('  降级为 Mock MCP...');
    }
  }

  if (!githubToken) {
    console.log('\n未配置 GITHUB_PERSONAL_ACCESS_TOKEN，使用 Mock MCP');
  }

  const mockClient = new MockMCPClient();
  const tools = await registry.registerMCPServer('github', mockClient);
  console.log(`  已注册 ${tools.length} 个 Mock MCP 工具`);
}

function printTools() {
  console.log(`\n已注册 ${registry.getAll().length} 个工具：`);
  for (const tool of registry.getAll()) {
    const isMCP = tool.name.startsWith('mcp__');
    const source = isMCP ? 'MCP' : '内置';
    const flags = [source, tool.isConcurrencySafe ? '可并发' : '串行'].join(', ');
    console.log(`  - ${tool.name}（${flags}）`);
  }
}

async function main() {
  await connectMCP();
  printTools();

  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log(`\nSuper Agent v0.5 — MCP 接入（输入 exit 退出）  [${useReal ? '真实 Qwen' : 'Mock'}]\n`);
  console.log('试试："查看 vercel/ai 的 issues"、"帮我列一下当前目录的文件"、"北京天气"\n');

  while (true) {
    const input = (await rl.question('\nYou: ').catch(() => null))?.trim();
    if (input == null || input === 'exit' || input === 'quit') {
      console.log('Bye!');
      break;
    }
    if (!input) continue;

    messages.push({ role: 'user', content: input });
    await agentLoop(model, registry, messages, SYSTEM, budget);
  }

  rl.close();
  // 退出前关掉 MCP 进程，避免留下孤儿进程。
  await registry.closeAllMCP();
}

main();
