import 'dotenv/config';
import { streamText, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createMockModel } from './mock-model';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const qwen = createOpenAI({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY,
});

const model = process.env.DASHSCOPE_API_KEY
  ? qwen.chat('qwen-plus-latest')
  : createMockModel();

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

    const result = streamText({ model, messages });

    stdout.write('AI: ');
    let reply = '';
    for await (const chunk of result.textStream) {
      stdout.write(chunk);
      reply += chunk;
    }
    stdout.write('\n\n');

    // 把模型的回复也存进历史，下一轮才有上下文
    messages.push({ role: 'assistant', content: reply });
  }

  rl.close();
}

main();
