import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonlSessionStore } from './session-store';
import { type ModelMessage } from 'ai';

let dirs: string[] = [];

function tempSessionFile() {
  const dir = mkdtempSync(join(tmpdir(), 'super-agent-session-'));
  dirs.push(dir);
  return join(dir, 'default.jsonl');
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('JsonlSessionStore', () => {
  it('appends and reloads messages as JSONL records', () => {
    const file = tempSessionFile();
    const store = new JsonlSessionStore(file);
    const messages: ModelMessage[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好，有什么可以帮你？' },
    ];

    for (const message of messages) store.append(message);

    expect(store.load()).toEqual(messages);
    expect(store.exists()).toBe(true);
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ type: 'message', message: messages[0] });
  });

  it('returns false when the session file does not exist', () => {
    expect(new JsonlSessionStore(tempSessionFile()).exists()).toBe(false);
  });

  it('skips malformed lines without losing valid records', () => {
    const file = tempSessionFile();
    writeFileSync(
      file,
      [
        JSON.stringify({
          type: 'message',
          createdAt: '2026-07-24T00:00:00.000Z',
          message: { role: 'user', content: 'first' },
        }),
        '{"type":"message"',
        JSON.stringify({
          type: 'message',
          createdAt: '2026-07-24T00:00:00.000Z',
          message: { role: 'assistant', content: 'second' },
        }),
      ].join('\n'),
    );

    expect(new JsonlSessionStore(file).load()).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]);
  });
});
