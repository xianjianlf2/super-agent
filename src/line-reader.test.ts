import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { createLineReader } from './line-reader';

// ── 管道输入：行先到、question 后问 ─────────────────────────────────────────

describe('createLineReader 管道输入', () => {
  it('question 之间到达的行不丢失（多轮测试的核心场景）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reader = createLineReader(input, output);

    // 模拟管道：所有行一次性到达
    input.write('q1\nq2\nexit\n');
    input.end();

    expect(await reader.question('You: ')).toBe('q1');
    // 模拟 agent loop 耗时处理，期间 q2/exit 已到达但无人在等
    await new Promise((r) => setTimeout(r, 50));
    expect(await reader.question('You: ')).toBe('q2');
    expect(await reader.question('You: ')).toBe('exit');
    reader.close();
  });

  it('EOF 后 question 返回 null', async () => {
    const input = new PassThrough();
    const reader = createLineReader(input, new PassThrough());
    input.end('only\n');

    expect(await reader.question('> ')).toBe('only');
    expect(await reader.question('> ')).toBe(null);
    expect(await reader.question('> ')).toBe(null); // 幂等
    reader.close();
  });

  it('question 先等、行后到也能收到', async () => {
    const input = new PassThrough();
    const reader = createLineReader(input, new PassThrough());

    const pending = reader.question('> ');
    setTimeout(() => input.write('late\n'), 20);
    expect(await pending).toBe('late');
    reader.close();
  });

  it('等待期间流关闭返回 null', async () => {
    const input = new PassThrough();
    const reader = createLineReader(input, new PassThrough());

    const pending = reader.question('> ');
    setTimeout(() => input.end(), 20);
    expect(await pending).toBe(null);
    reader.close();
  });

  it('非 TTY 输入时把消费的行回显到输出，方便看测试记录', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reader = createLineReader(input, output);
    input.end('hello\n');

    await reader.question('You: ');
    reader.close();
    output.end();

    let echoed = '';
    for await (const chunk of output) echoed += chunk;
    expect(echoed).toContain('You: ');
    expect(echoed).toContain('hello');
  });
});
