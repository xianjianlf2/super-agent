import type { ModelMessage, ToolResultPart } from 'ai';
import { CLEARED_TOOL_RESULT_TEXT, readToolResultText, writeToolResultText } from './tool-result-text';

export interface MicrocompactOptions {
  clearableTools?: ReadonlySet<string>;
  keepRecentToolResults?: number;
  minResultChars?: number;
  placeholder?: string;
}

export interface MicrocompactStats {
  scanned: number;
  cleared: number;
  savedChars: number;
}

export const CLEARABLE_TOOLS = new Set([
  'read_file',
  'bash',
  'grep_files',
  'glob',
  'search_files',
  'list_directory',
  'fetch_url',
  'tool_search',
  'get_weather',
  'calculator',
]);

export const KEEP_RECENT_TOOL_RESULTS = 3;
const DEFAULT_MIN_RESULT_CHARS = 0;

function isToolResultPart(part: unknown): part is ToolResultPart {
  return !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'tool-result';
}

export function microcompactToolResults(
  messages: ModelMessage[],
  options: MicrocompactOptions = {},
): MicrocompactStats {
  const clearableTools = options.clearableTools ?? CLEARABLE_TOOLS;
  const keepRecentToolResults = options.keepRecentToolResults ?? KEEP_RECENT_TOOL_RESULTS;
  const minResultChars = options.minResultChars ?? DEFAULT_MIN_RESULT_CHARS;
  const placeholder = options.placeholder ?? CLEARED_TOOL_RESULT_TEXT;
  const protectedToolCallIds = new Set<string>();
  const stats: MicrocompactStats = { scanned: 0, cleared: 0, savedChars: 0 };

  for (let i = messages.length - 1; i >= 0 && protectedToolCallIds.size < keepRecentToolResults; i--) {
    const message = messages[i];
    if (!Array.isArray(message.content)) continue;

    for (let j = message.content.length - 1; j >= 0 && protectedToolCallIds.size < keepRecentToolResults; j--) {
      const part = message.content[j];
      if (isToolResultPart(part)) protectedToolCallIds.add(part.toolCallId);
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!Array.isArray(message.content)) continue;

    let changed = false;
    const content = message.content.map((part) => {
      if (!isToolResultPart(part)) return part;

      stats.scanned++;
      if (!clearableTools.has(part.toolName) || protectedToolCallIds.has(part.toolCallId)) return part;

      const text = readToolResultText(part);
      if (text == null || text === placeholder || text.length < minResultChars) return part;

      changed = true;
      stats.cleared++;
      stats.savedChars += Math.max(0, text.length - placeholder.length);
      return writeToolResultText(part, placeholder);
    });

    if (changed) {
      messages[i] = { ...message, content } as ModelMessage;
    }
  }

  return stats;
}
