import { streamText, type ModelMessage } from 'ai';
import { detect, recordCall, recordResult, resetHistory } from './loop-detection';
import { isRetryable, calculateDelay, sleep } from './retry';
import type { ToolRegistry } from '../tools';

const MAX_STEPS = 15;   // 代码层的硬上限：兜住 while(true) 这种纯结构性死循环
const MAX_RETRIES = 3;  // 单步最多重试次数

// 预算由调用方（index.ts 模块顶层）持有，跨多轮 user 提问持续累计。
// 若把累计变量写进本函数内部，每轮新 query 都会清零 —— 长会话的滚雪球就兜不住了。
export interface BudgetState {
  used: number;
  limit: number;
}

export interface AgentLoopResult {
  newMessages: ModelMessage[];
}

export interface AgentLoopOptions {
  verbose?: boolean;
}

export async function agentLoop(
  model: any,
  registry: ToolRegistry,
  messages: ModelMessage[],
  system: string,
  budget: BudgetState,
  options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
  let step = 0;
  const newMessages: ModelMessage[] = [];
  const verbose = options.verbose === true;
  resetHistory(); // 循环检测窗口按”单次 query”清空

  while (step < MAX_STEPS) {
    step++;
    // 每步重建工具表：tool_search 激活 deferred 工具后，下一步就能直接调用（构建成本可忽略）
    const tools = registry.toAISDKFormat();
    if (verbose) console.log(`\n--- Step ${step} ---`);

    let hasToolCall = false;
    let fullText = '';
    let shouldBreak = false;
    let lastToolCall: { name: string; input: unknown } | null = null;
    let stepResponse: any;
    let stepUsage: any;

    // 步骤级重试：用 try-catch 包裹整个 stream 消费过程。
    // maxRetries: 0 关掉 SDK 内置重试，错误处理全在我们手里。
    for (let attempt = 1; ; attempt++) {
      try {
        const result = streamText({
          model,
          system,
          tools,
          messages,
          maxRetries: 0,
          onError: () => {}, // 抑制 SDK 把错误堆栈直接打到终端
        });

        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta':
              process.stdout.write(part.text);
              fullText += part.text;
              break;

            case 'tool-call': {
              hasToolCall = true;
              lastToolCall = { name: part.toolName, input: part.input };
              if (verbose) console.log(`  [调用: ${part.toolName}(${JSON.stringify(part.input)})]`);

              // 第一层：循环检测（在 recordCall 之前）
              const detection = detect(part.toolName, part.input);
              if (detection.stuck) {
                if (verbose) console.log(`  ${detection.message}`);
                if (detection.level === 'critical') {
                  shouldBreak = true; // 严重 → 直接熔断
                } else {
                  // 警告 → 注入系统提醒，给模型一次自我纠偏的机会
                  messages.push({
                    role: 'user' as const,
                    content: `[系统提醒] ${detection.message}。请换一个思路解决问题，不要重复同样的操作。`,
                  });
                  newMessages.push(messages[messages.length - 1]);
                }
              }
              recordCall(part.toolName, part.input);
              break;
            }

            case 'tool-result': {
              if (verbose) {
                const text = typeof part.output === 'string' ? part.output : JSON.stringify(part.output);
                const preview = text.length > 200 ? text.slice(0, 200) + '…' : text;
                console.log(`  [结果: ${part.toolName}] ${preview}`);
              }
              if (lastToolCall) {
                recordResult(lastToolCall.name, lastToolCall.input, part.output);
              }
              break;
            }
          }
        }

        stepResponse = await result.response;
        stepUsage = await result.usage;
        break; // 本步成功，跳出重试循环
      } catch (error) {
        // 第二层：API 容错。不可重试错误 / 次数用尽 → 直接抛。
        if (attempt > MAX_RETRIES || !isRetryable(error)) throw error;
        const delay = calculateDelay(attempt);
        if (verbose) console.log(`  [重试] 第 ${attempt}/${MAX_RETRIES} 次失败，${delay}ms 后重试...`);
        await sleep(delay);
        // 重置本步状态，干净地重来
        hasToolCall = false;
        fullText = '';
        shouldBreak = false;
        lastToolCall = null;
      }
    }

    if (shouldBreak) {
      if (verbose) console.log('\n[循环检测触发，Agent 已停止]');
      break;
    }

    const responseMessages = stepResponse.messages as ModelMessage[];
    messages.push(...responseMessages);
    newMessages.push(...responseMessages);

    // 第三层：Token 预算（budget 跨轮累计）
    const inp =
      typeof stepUsage?.inputTokens === 'number'
        ? stepUsage.inputTokens
        : (stepUsage?.inputTokens?.total ?? 0);
    const out =
      typeof stepUsage?.outputTokens === 'number'
        ? stepUsage.outputTokens
        : (stepUsage?.outputTokens?.total ?? 0);
    budget.used += inp + out;
    const pct = Math.round((budget.used / budget.limit) * 100);
    if (verbose) console.log(`  [Token] ${budget.used}/${budget.limit} (${pct}%)`);
    if (budget.used > budget.limit) {
      console.log('\n[Token 预算耗尽，强制停止]');
      break;
    }

    if (!hasToolCall) {
      if (fullText) console.log();
      break; // 没有工具调用 = 模型给出了最终回答
    }

    if (verbose) console.log('  → 继续下一步...');
  }

  if (step >= MAX_STEPS) {
    console.log('\n[达到最大步数限制，强制停止]');
  }

  return { newMessages };
}
