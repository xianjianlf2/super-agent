import { describe, expect, it } from 'vitest';
import {
  CLEARED_TOOL_RESULT_TEXT,
  encodeToolResultText,
  readToolResultOutputText,
  readToolResultText,
  writeToolResultText,
} from './tool-result-text';
import type { ToolResultPart } from 'ai';

describe('tool-result text helpers', () => {
  it('encodes text results with the AI SDK discriminated union shape', () => {
    expect(encodeToolResultText(CLEARED_TOOL_RESULT_TEXT)).toEqual({
      type: 'text',
      value: CLEARED_TOOL_RESULT_TEXT,
    });
  });

  it('reads current text tool-result output and legacy string output', () => {
    const part: ToolResultPart = {
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'read_file',
      output: { type: 'text', value: 'file contents' },
    };

    expect(readToolResultText(part)).toBe('file contents');
    expect(readToolResultOutputText('legacy text')).toBe('legacy text');
  });

  it('writes replacement text without falling back to a raw string output', () => {
    const part: ToolResultPart = {
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'read_file',
      output: { type: 'text', value: 'original' },
    };

    const replaced = writeToolResultText(part, CLEARED_TOOL_RESULT_TEXT);

    expect(replaced.output).toEqual({ type: 'text', value: CLEARED_TOOL_RESULT_TEXT });
  });
});
