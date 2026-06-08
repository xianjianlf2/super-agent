import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { type ModelMessage } from 'ai';
import { model, useReal } from './model';
import { tools } from './tools';
import { agentLoop, type BudgetState } from './agent-loop';

const SYSTEM = `你是 Super Agent，一个有工具调用能力的 AI 助手。
需要查询信息时，主动使用工具，不要编造数据。
回答要简洁直接。`;

// 预算声明在模块顶层 → 跨多轮 user 提问持续累计。
// 演示用 limit 调小，方便快速看到熔断；普通对话每步只消耗几十 tokens，不会被预算抢戏。
const budget: BudgetState = { used: 0, limit: 15000 };

const messages: ModelMessage[] = [];

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log(`Super Agent v0.3 — 三层防护（输入 exit 退出）  [${useReal ? '真实 Qwen' : 'Mock'}]\n`);
  console.log('试试输入："测试死循环"、"测试重试"、"测试预算" 看三层防护效果\n');

  while (true) {
    const input = (await rl.question('\nYou: ').catch(() => null))?.trim();
    if (input == null || input === 'exit' || input === 'quit') {
      console.log('Bye!');
      break;
    }
    if (!input) continue;

    messages.push({ role: 'user', content: input });
    await agentLoop(model, tools, messages, SYSTEM, budget);
  }

  rl.close();
}

main();
