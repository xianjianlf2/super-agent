import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { model } from './model';
import { tools } from './tools';

// 对比目标：模型调用工具后，需要“拿着工具结果再问一轮”才能给出最终答案。
// 这个“调用工具 → 喂回结果 → 再问模型”的外层循环，
//   - 方式 A 交给 SDK 的 stopWhen 自动完成；
//   - 方式 B 我们自己写 while 手动完成。
// 注意：两种方式里“工具的执行”都由 SDK 做（因为 tool 带了 execute），
//       手动的是“要不要再问一轮模型”这层循环 —— 这正是 stopWhen 替我们做的事。

const QUERY = '北京天气怎么样？顺便帮我算一下 (1+2)*3';

// ── 方式 A：SDK 自动循环 ───────────────────────────────────────────────
// 一次调用，stopWhen 让 SDK 内部把“调工具→喂结果→再问”自动跑完。
async function sdkAutoLoop() {
  const result = await generateText({
    model,
    tools,
    stopWhen: stepCountIs(5), // 最多自动跑 5 步，防止死循环
    messages: [{ role: 'user', content: QUERY }],
  });

  console.log('【方式 A：SDK 自动循环】');
  result.steps.forEach((step, i) => {
    const calls = step.toolCalls.map((c) => `${c.toolName}(${JSON.stringify(c.input)})`);
    console.log(`  step ${i + 1}: 工具=[${calls.join(', ')}] 文本=${JSON.stringify(step.text)}`);
  });
  console.log(`  SDK 自动跑了 ${result.steps.length} 步`);
  console.log('  最终回答:', result.text, '\n');
}

// ── 方式 B：手动循环 ──────────────────────────────────────────────────
// 默认 stopWhen 是 stepCountIs(1)：每次 generateText 只走一步，不自动续跑。
// 所以我们自己写 while：把上一步生成的消息（含工具调用与结果）塞回历史，
// 只要模型还想调工具（finishReason === 'tool-calls'）就再问一轮。
async function manualLoop() {
  console.log('【方式 B：手动循环】');
  const messages: ModelMessage[] = [{ role: 'user', content: QUERY }];

  let round = 0;
  const MAX_ROUNDS = 5;
  while (round < MAX_ROUNDS) {
    round++;
    const result = await generateText({ model, tools, messages }); // 单步
    messages.push(...result.response.messages); // 手动维护对话历史

    const calls = result.toolCalls.map((c) => `${c.toolName}(${JSON.stringify(c.input)})`);
    console.log(`  round ${round}: 工具=[${calls.join(', ')}] 文本=${JSON.stringify(result.text)}`);

    // 没有要调用的工具 = 模型给出最终答案，结束循环
    if (result.finishReason !== 'tool-calls') {
      console.log(`  手动跑了 ${round} 轮`);
      console.log('  最终回答:', result.text, '\n');
      return;
    }
  }
  console.log('  达到最大轮数上限，强制结束\n');
}

async function main() {
  await sdkAutoLoop();
  await manualLoop();
  console.log('结论：两者结果一致。stopWhen 就是把方式 B 的 while 循环封装成了一个参数。');
}

main();
