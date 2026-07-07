import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { type ModelMessage } from 'ai';
import { model, useReal } from './model';
import { ToolRegistry, allTools } from './tools';
import { agentLoop, type BudgetState } from './agent-loop';

const SYSTEM = `你是 Super Agent，一个有工具调用能力的 AI 助手。
需要查询信息时，主动使用工具，不要编造数据。
回答要简洁直接。`;

const budget: BudgetState = { used: 0, limit: 40000 };

const messages: ModelMessage[] = [];

// 创建 registry 并注册所有工具
const registry = new ToolRegistry();
registry.register(...allTools);

console.log(`已注册 ${registry.getAll().length} 个工具：`);
for (const tool of registry.getAll()) {
  const flags = [
    tool.isConcurrencySafe ? '可并发' : '串行',
    tool.isReadOnly ? '只读' : '读写',
  ].join(', ');
  console.log(`  - ${tool.name}（${flags}）`);
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log(`\nSuper Agent v0.4 — 工具注册 + 截断 + 并发锁（输入 exit 退出）  [${useReal ? '真实 Qwen' : 'Mock'}]\n`);
  console.log('试试："帮我列一下当前目录的文件"、"读一下 sample-data.txt"、"北京天气"\n');

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
}

main();
