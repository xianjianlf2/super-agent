import { describe, expect, it } from 'vitest';
import type { ModelMessage, ToolResultPart } from 'ai';
import { KEEP_RECENT_TOOL_RESULTS, microcompactToolResults } from './microcompact';
import { CLEARED_TOOL_RESULT_TEXT } from './tool-result-text';

function textToolResult(value: string, id: string, toolName = 'read_file'): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: id,
    toolName,
    output: { type: 'text', value },
  };
}

describe('microcompactToolResults', () => {
  it('replaces clearable tool results except the latest 3 tool results', () => {
    const oldText = 'x'.repeat(1200);
    const recentTexts = ['a'.repeat(1200), 'b'.repeat(1200), 'c'.repeat(1200)];
    const messages: ModelMessage[] = [
      { role: 'user', content: 'read a file' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: {} }],
      },
      { role: 'tool', content: [textToolResult(oldText, 'call-1')] },
      { role: 'tool', content: [textToolResult(recentTexts[0], 'call-2')] },
      { role: 'tool', content: [textToolResult(recentTexts[1], 'call-3')] },
      { role: 'tool', content: [textToolResult(recentTexts[2], 'call-4')] },
    ];

    const stats = microcompactToolResults(messages, { minResultChars: 1000 });

    const oldResult = (messages[2].content as ToolResultPart[])[0].output;
    const recentResults = messages.slice(3).map((message) => (
      (message.content as ToolResultPart[])[0].output
    ));

    expect(stats).toEqual({
      scanned: 4,
      cleared: 1,
      savedChars: oldText.length - CLEARED_TOOL_RESULT_TEXT.length,
    });
    expect(oldResult).toEqual({ type: 'text', value: CLEARED_TOOL_RESULT_TEXT });
    expect(recentResults).toEqual(recentTexts.map((text) => ({ type: 'text', value: text })));
    expect(KEEP_RECENT_TOOL_RESULTS).toBe(3);
  });

  it('does not clear non-whitelisted tool results even when they are old', () => {
    const issueId = 'ISSUE-123';
    const messages: ModelMessage[] = [
      { role: 'tool', content: [textToolResult(issueId, 'call-1', 'create_issue')] },
      { role: 'tool', content: [textToolResult('old grep output', 'call-2', 'grep_files')] },
      { role: 'tool', content: [textToolResult('recent 1', 'call-3')] },
      { role: 'tool', content: [textToolResult('recent 2', 'call-4')] },
      { role: 'tool', content: [textToolResult('recent 3', 'call-5')] },
    ];

    const stats = microcompactToolResults(messages);

    expect(stats.cleared).toBe(1);
    expect((messages[0].content as ToolResultPart[])[0].output).toEqual({
      type: 'text',
      value: issueId,
    });
    expect((messages[1].content as ToolResultPart[])[0].output).toEqual({
      type: 'text',
      value: CLEARED_TOOL_RESULT_TEXT,
    });
  });

  it('leaves small and already-cleared tool results unchanged', () => {
    const messages: ModelMessage[] = [
      { role: 'tool', content: [textToolResult('small', 'call-1')] },
      { role: 'tool', content: [textToolResult(CLEARED_TOOL_RESULT_TEXT, 'call-2')] },
      { role: 'user', content: 'current' },
    ];

    const stats = microcompactToolResults(messages, {
      keepRecentToolResults: 0,
      minResultChars: 100,
    });

    expect(stats).toEqual({ scanned: 2, cleared: 0, savedChars: 0 });
  });
});
