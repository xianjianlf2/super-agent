import type { ModelMessage } from 'ai';

export function estimateCharsAsTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function estimateMessagesTokens(messages: ModelMessage[]): number {
  return estimateCharsAsTokens(JSON.stringify(messages).length);
}
