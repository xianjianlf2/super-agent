import { describe, expect, it } from 'vitest';
import type { ModelMessage, ToolResultPart } from 'ai';
import {
  COMPRESS_PROMPT,
  renderMessagesForSummary,
  SUMMARY_COMPRESSION_PROMPT,
  summaryCompactMessages,
} from './summary-compact';

function resultMessage(value: string, id: string): ModelMessage {
  const part: ToolResultPart = {
    type: 'tool-result',
    toolCallId: id,
    toolName: 'read_file',
    output: { type: 'text', value },
  };
  return { role: 'tool', content: [part] };
}

describe('summary compact', () => {
  it('uses a prompt that protects exact identifiers', () => {
    expect(SUMMARY_COMPRESSION_PROMPT).toBe(COMPRESS_PROMPT);
    expect(COMPRESS_PROMPT).toContain('## 用户意图');
    expect(COMPRESS_PROMPT).toContain('## 已完成的操作');
    expect(COMPRESS_PROMPT).toContain('## 关键发现');
    expect(COMPRESS_PROMPT).toContain('## 当前状态');
    expect(COMPRESS_PROMPT).toContain('## 需要保留的细节');
    expect(SUMMARY_COMPRESSION_PROMPT).toContain('文件路径');
    expect(SUMMARY_COMPRESSION_PROMPT).toContain('UUID');
    expect(SUMMARY_COMPRESSION_PROMPT).toContain('版本号');
    expect(SUMMARY_COMPRESSION_PROMPT).toContain('原样保留');
    expect(SUMMARY_COMPRESSION_PROMPT).toContain('不要写笼统的概述');
    expect(SUMMARY_COMPRESSION_PROMPT).toContain('800 字以内');
  });

  it('renders tool calls and structured text tool results into the transcript', () => {
    const transcript = renderMessagesForSummary([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: { path: 'src/index.ts' } }],
      },
      resultMessage('hello', 'call-1'),
    ]);

    expect(transcript).toContain('[tool-call read_file id=call-1 input={"path":"src/index.ts"}]');
    expect(transcript).toContain('[tool-result read_file id=call-1]');
    expect(transcript).toContain('hello');
  });

  it('summarizes old prefix and keeps the recent suffix intact', async () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'goal with /tmp/a.ts' },
      { role: 'assistant', content: 'ack' },
      resultMessage('old output '.repeat(50), 'call-1'),
      { role: 'user', content: 'middle' },
      { role: 'assistant', content: 'middle answer' },
      { role: 'user', content: 'recent question' },
      { role: 'assistant', content: 'recent answer' },
    ];
    const budget = { used: 10 };

    const stats = await summaryCompactMessages(null, messages, budget, {
      thresholdChars: 100,
      keepRecentMessages: 2,
      summarizeTranscript: async ({ system, transcript }) => {
        expect(system).toBe(SUMMARY_COMPRESSION_PROMPT);
        expect(transcript).toContain('/tmp/a.ts');
        return {
          text: [
            '## 用户意图',
            '- 处理 `/tmp/a.ts`',
            '',
            '## 已完成的操作',
            '- 已读取旧输出',
            '',
            '## 关键发现',
            '- 发现 `/tmp/a.ts`',
            '',
            '## 当前状态',
            '- 继续回答最近问题',
            '',
            '## 需要保留的细节',
            '- `/tmp/a.ts`',
          ].join('\n'),
          usage: { inputTokens: { total: 8 }, outputTokens: { total: 4 } },
        };
      },
    });

    expect(stats.triggered).toBe(true);
    expect(stats.compactedMessages).toBe(5);
    expect(budget.used).toBe(22);
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          '[上下文摘要]',
          '## 用户意图',
          '- 处理 `/tmp/a.ts`',
          '',
          '## 已完成的操作',
          '- 已读取旧输出',
          '',
          '## 关键发现',
          '- 发现 `/tmp/a.ts`',
          '',
          '## 当前状态',
          '- 继续回答最近问题',
          '',
          '## 需要保留的细节',
          '- `/tmp/a.ts`',
        ].join('\n'),
      },
      { role: 'user', content: 'recent question' },
      { role: 'assistant', content: 'recent answer' },
    ]);
  });

  it('moves the cutoff backward so the kept suffix starts with a user message', async () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'old goal' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: {} }] },
      resultMessage('old output '.repeat(50), 'call-1'),
      { role: 'user', content: 'safe suffix start' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-2', toolName: 'read_file', input: {} }] },
      resultMessage('recent output '.repeat(50), 'call-2'),
      { role: 'user', content: 'latest' },
      { role: 'assistant', content: 'latest answer' },
    ];

    const stats = await summaryCompactMessages(null, messages, undefined, {
      thresholdChars: 100,
      keepRecentMessages: 3,
      minPrefixMessages: 1,
      summarizeTranscript: async () => ({
        text: [
          '## 用户意图',
          '- old goal',
          '## 已完成的操作',
          '- read_file',
          '## 关键发现',
          '- old output',
          '## 当前状态',
          '- safe suffix start',
          '## 需要保留的细节',
          '- call-1',
        ].join('\n'),
      }),
    });

    expect(stats.compactedMessages).toBe(3);
    expect(messages[1]).toEqual({ role: 'user', content: 'safe suffix start' });
  });

  it('includes an existing summary when compacting again', async () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: '[上下文摘要]\n## 用户意图\n- 最早目标 `/tmp/old.ts`' },
      { role: 'user', content: 'new work' },
      { role: 'assistant', content: 'ack' },
      resultMessage('new output '.repeat(50), 'call-1'),
      { role: 'user', content: 'recent' },
      { role: 'assistant', content: 'recent answer' },
    ];

    await summaryCompactMessages(null, messages, undefined, {
      thresholdChars: 100,
      keepRecentMessages: 2,
      minPrefixMessages: 1,
      summarizeTranscript: async ({ transcript }) => {
        expect(transcript).toContain('[上下文摘要]');
        expect(transcript).toContain('/tmp/old.ts');
        return {
          text: [
            '## 用户意图',
            '- 累积目标 `/tmp/old.ts`',
            '## 已完成的操作',
            '- 继续 new work',
            '## 关键发现',
            '- new output',
            '## 当前状态',
            '- recent',
            '## 需要保留的细节',
            '- `/tmp/old.ts`',
          ].join('\n'),
        };
      },
    });

    expect(messages[0].content).toContain('累积目标 `/tmp/old.ts`');
  });

  it('skips compaction when the summary does not match the required template', async () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'a'.repeat(200) },
      { role: 'user', content: 'recent' },
    ];

    const stats = await summaryCompactMessages(null, messages, undefined, {
      thresholdChars: 100,
      keepRecentMessages: 1,
      minPrefixMessages: 1,
      summarizeTranscript: async () => ({ text: '泛泛概述' }),
    });

    expect(stats).toMatchObject({
      triggered: false,
      reason: 'invalid_summary_format',
    });
    expect(messages[0]).toEqual({ role: 'user', content: 'old' });
  });

  it('returns the original messages when summarization fails', async () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'a'.repeat(200) },
      { role: 'user', content: 'recent' },
    ];

    const stats = await summaryCompactMessages(null, messages, undefined, {
      thresholdChars: 100,
      keepRecentMessages: 1,
      minPrefixMessages: 1,
      summarizeTranscript: async () => {
        throw new Error('timeout');
      },
    });

    expect(stats).toMatchObject({
      triggered: false,
      reason: 'summarize_failed',
    });
    expect(messages).toEqual([
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'a'.repeat(200) },
      { role: 'user', content: 'recent' },
    ]);
  });

  it('does not compact below the threshold or without a safe user boundary', async () => {
    const messages: ModelMessage[] = [
      { role: 'assistant', content: 'a'.repeat(120) },
      { role: 'tool', content: [] },
    ];

    const stats = await summaryCompactMessages(null, messages, undefined, {
      thresholdChars: 100,
      keepRecentMessages: 1,
      summarizeTranscript: async () => {
        throw new Error('should not summarize');
      },
    });

    expect(stats.triggered).toBe(false);
    expect(messages).toHaveLength(2);
  });
});
