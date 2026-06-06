import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { model, useReal } from './model';
import { tools } from './tools';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let closed = false;
  rl.on('close', () => { closed = true; });
  // 对话历史：每一轮都追加进去，再整体传给模型，模型才能“记住”上下文
  const messages: ModelMessage[] = [];

  console.log('开始对话（输入 exit 或 quit 退出）\n');

  while (true) {
    const input = await rl.question('你: ').catch(() => null);
    if (closed || input === null) break;
    if (input.trim() === 'exit' || input.trim() === 'quit') break;
    if (!input.trim()) continue;

    messages.push({ role: 'user', content: input });

    const result = streamText({
      model,
      messages,
      // 真实模型才挂工具；mock 模型不支持工具调用
      tools: useReal ? tools : undefined,
      // 模型调用工具后，要拿着工具结果再跑一轮才能给出最终回答。
      // stepCountIs(N) 允许最多 N 步（工具调用 + 回答）的循环。
      stopWhen: stepCountIs(5),
    });

    stdout.write('AI: ');
    // 用 fullStream 既能拿到文本增量，也能看到工具调用/结果事件
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          stdout.write(part.text);
          break;
        case 'tool-call':
          stdout.write(`\n  🔧 调用工具 ${part.toolName}(${JSON.stringify(part.input)})`);
          break;
        case 'tool-result':
          stdout.write(` → ${JSON.stringify(part.output)}\n`);
          break;
      }
    }
    stdout.write('\n\n');

    // 把本轮模型生成的所有消息（含工具调用与工具结果）整体存进历史，
    // 下一轮才有完整上下文
    messages.push(...(await result.response).messages);
  }

  rl.close();
}

main();
