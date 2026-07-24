import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type ModelMessage } from 'ai';

export interface SessionRecord {
  type: 'message';
  createdAt: string;
  message: ModelMessage;
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as { type?: unknown; message?: unknown };
  if (record.type !== 'message') return false;
  if (!record.message || typeof record.message !== 'object') return false;
  return typeof (record.message as { role?: unknown }).role === 'string';
}

export class JsonlSessionStore {
  constructor(public readonly filePath = '.sessions/default.jsonl') {}

  exists() {
    return existsSync(this.filePath);
  }

  load(): ModelMessage[] {
    if (!this.exists()) return [];

    const lines = readFileSync(this.filePath, 'utf-8').split(/\r?\n/);
    const messages: ModelMessage[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const record = JSON.parse(line);
        if (isSessionRecord(record)) messages.push(record.message);
      } catch {
        continue;
      }
    }

    return messages;
  }

  append(message: ModelMessage) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const record: SessionRecord = {
      type: 'message',
      createdAt: new Date().toISOString(),
      message,
    };
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf-8');
  }
}
