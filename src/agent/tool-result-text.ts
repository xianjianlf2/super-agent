import type { ToolResultPart } from 'ai';

export const CLEARED_TOOL_RESULT_TEXT = '[tool result cleared]';

type TextToolResultType = 'text' | 'error-text';
type ToolResultOutput = ToolResultPart['output'];
type TextToolResultOutput = Extract<ToolResultOutput, { type: TextToolResultType }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function textOutputType(output: unknown): TextToolResultType {
  return isRecord(output) && output.type === 'error-text' ? 'error-text' : 'text';
}

function textOutputProviderOptions(output: unknown): TextToolResultOutput['providerOptions'] | undefined {
  return isRecord(output)
    ? (output.providerOptions as TextToolResultOutput['providerOptions'] | undefined)
    : undefined;
}

export function encodeToolResultText(
  value: string,
  type: TextToolResultType = 'text',
  providerOptions?: TextToolResultOutput['providerOptions'],
): ToolResultOutput {
  return providerOptions ? { type, value, providerOptions } : { type, value };
}

export function readToolResultOutputText(output: unknown): string | undefined {
  // 兼容旧 session 里可能残留的 AI SDK 4 字符串结果。
  if (typeof output === 'string') return output;
  if (!isRecord(output)) return undefined;
  if ((output.type === 'text' || output.type === 'error-text') && typeof output.value === 'string') {
    return output.value;
  }
  return undefined;
}

export function readToolResultText(part: unknown): string | undefined {
  if (!isRecord(part) || part.type !== 'tool-result') return undefined;
  return readToolResultOutputText(part.output);
}

export function writeToolResultText<T extends ToolResultPart>(part: T, value: string): T {
  const output = isRecord(part.output) ? part.output : undefined;
  return {
    ...part,
    output: encodeToolResultText(
      value,
      textOutputType(output),
      textOutputProviderOptions(output),
    ),
  };
}
