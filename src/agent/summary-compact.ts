import { generateText, type ModelMessage } from 'ai';
import { readToolResultText } from './tool-result-text';

export const SUMMARY_COMPACT_THRESHOLD_CHARS = 2_000;
export const SUMMARY_KEEP_RECENT_MESSAGES = 8;

export const COMPRESS_PROMPT = `你是一个对话压缩系统。你的任务是把 Agent 和用户之间的
对话历史压缩成一份结构化摘要，确保后续对话能够无缝继续。

请严格按照以下模板输出，每个字段都要填写：

## 用户意图
（用户在这次对话中想要完成什么）

## 已完成的操作
（Agent 执行了哪些工具调用、产生了什么结果）

## 关键发现
（读取的文件内容要点、搜索结果、命令输出中的关键信息）

## 当前状态
（对话进行到哪一步了、还有什么没做完）

## 需要保留的细节
（文件路径、变量名、配置值、错误信息等不能丢失的具体内容）

注意事项：
- 用对话中使用的语言输出
- 文件路径、UUID、版本号等标识符必须原样保留，不要翻译或改写
- 不要写笼统的概述，只保留具体的、可操作的信息
- 总长度控制在 800 字以内`;

export const SUMMARY_COMPRESSION_PROMPT = COMPRESS_PROMPT;

export interface SummaryCompactOptions {
  thresholdChars?: number;
  keepRecentMessages?: number;
  minPrefixMessages?: number;
  summarizeTranscript?: (input: {
    system: string;
    transcript: string;
  }) => Promise<{ text: string; usage?: unknown; error?: unknown }>;
}

export interface SummaryCompactStats {
  triggered: boolean;
  compactedMessages: number;
  beforeChars: number;
  afterChars: number;
  savedChars: number;
  summaryChars: number;
  reason?: string;
  usage?: unknown;
}

interface TokenBudget {
  used: number;
}

function messageChars(messages: ModelMessage[]): number {
  return JSON.stringify(messages).length;
}

function renderContent(content: ModelMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content);

  return content.map((part) => {
    switch (part.type) {
      case 'text':
        return part.text;
      case 'tool-call':
        return `[tool-call ${part.toolName} id=${part.toolCallId} input=${JSON.stringify(part.input)}]`;
      case 'tool-result': {
        const text = readToolResultText(part);
        return `[tool-result ${part.toolName} id=${part.toolCallId}]\n${text ?? JSON.stringify(part.output)}`;
      }
      case 'tool-approval-response':
        return `[tool-approval-response id=${part.approvalId} approved=${part.approved} reason=${part.reason ?? ''}]`;
      default:
        return JSON.stringify(part);
    }
  }).join('\n');
}

export function renderMessagesForSummary(messages: ModelMessage[]): string {
  return messages
    .map((message, index) => `[#${index + 1} ${message.role}]\n${renderContent(message.content)}`)
    .join('\n\n');
}

function findSummaryCutoff(messages: ModelMessage[], keepRecentMessages: number): number {
  const target = Math.max(0, messages.length - keepRecentMessages);
  for (let i = target; i > 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return 0;
}

function usageTokens(usage: unknown): number {
  const value = usage as {
    inputTokens?: number | { total?: number };
    outputTokens?: number | { total?: number };
  } | undefined;
  const input = typeof value?.inputTokens === 'number'
    ? value.inputTokens
    : (value?.inputTokens?.total ?? 0);
  const output = typeof value?.outputTokens === 'number'
    ? value.outputTokens
    : (value?.outputTokens?.total ?? 0);
  return input + output;
}

function hasRequiredSummarySections(summary: string): boolean {
  return [
    '## 用户意图',
    '## 已完成的操作',
    '## 关键发现',
    '## 当前状态',
    '## 需要保留的细节',
  ].every((heading) => summary.includes(heading));
}

async function summarizeWithModel(model: any, system: string, transcript: string) {
  try {
    const result = await generateText({
      model,
      system,
      messages: [{ role: 'user', content: transcript }],
      maxRetries: 0,
    });
    return { text: result.text.trim(), usage: result.usage };
  } catch (error) {
    return { text: '', error };
  }
}

export async function summaryCompactMessages(
  model: any,
  messages: ModelMessage[],
  budget?: TokenBudget,
  options: SummaryCompactOptions = {},
): Promise<SummaryCompactStats> {
  const thresholdChars = options.thresholdChars ?? SUMMARY_COMPACT_THRESHOLD_CHARS;
  const keepRecentMessages = options.keepRecentMessages ?? SUMMARY_KEEP_RECENT_MESSAGES;
  const minPrefixMessages = options.minPrefixMessages ?? 4;
  const beforeChars = messageChars(messages);

  if (beforeChars <= thresholdChars) {
    return {
      triggered: false,
      compactedMessages: 0,
      beforeChars,
      afterChars: beforeChars,
      savedChars: 0,
      summaryChars: 0,
      reason: 'below_threshold',
    };
  }

  const cutoff = findSummaryCutoff(messages, keepRecentMessages);
  if (cutoff < minPrefixMessages) {
    return {
      triggered: false,
      compactedMessages: 0,
      beforeChars,
      afterChars: beforeChars,
      savedChars: 0,
      summaryChars: 0,
      reason: 'no_safe_user_boundary',
    };
  }

  const prefix = messages.slice(0, cutoff);
  const transcript = renderMessagesForSummary(prefix);
  const summarize = options.summarizeTranscript ?? ((input) => summarizeWithModel(model, input.system, input.transcript));
  let summaryResult: { text: string; usage?: unknown; error?: unknown };
  try {
    summaryResult = await summarize({ system: COMPRESS_PROMPT, transcript });
  } catch (error) {
    summaryResult = { text: '', error };
  }

  const { text, usage, error } = summaryResult;
  if (error) {
    return {
      triggered: false,
      compactedMessages: 0,
      beforeChars,
      afterChars: beforeChars,
      savedChars: 0,
      summaryChars: 0,
      reason: 'summarize_failed',
      usage,
    };
  }

  const summary = text.trim();
  const spent = usageTokens(usage);
  if (budget && spent > 0) budget.used += spent;

  if (!hasRequiredSummarySections(summary)) {
    return {
      triggered: false,
      compactedMessages: 0,
      beforeChars,
      afterChars: beforeChars,
      savedChars: 0,
      summaryChars: summary.length,
      reason: 'invalid_summary_format',
      usage,
    };
  }

  const summaryMessage: ModelMessage = {
    role: 'user',
    content: `[上下文摘要]\n${summary}`,
  };

  messages.splice(0, cutoff, summaryMessage);

  const afterChars = messageChars(messages);
  return {
    triggered: true,
    compactedMessages: cutoff,
    beforeChars,
    afterChars,
    savedChars: Math.max(0, beforeChars - afterChars),
    summaryChars: summary.length,
    usage,
  };
}
