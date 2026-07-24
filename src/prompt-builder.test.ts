import { describe, expect, it } from 'vitest';
import { createPromptBuilder, type PromptPipe } from './prompt-builder';

interface TestPromptContext {
  enabled: boolean;
  name: string;
}

const fixedPipe = (text: string): PromptPipe<TestPromptContext> => () => text;

const optionalPipe = (): PromptPipe<TestPromptContext> => (ctx) =>
  ctx.enabled ? `enabled for ${ctx.name}` : null;

describe('PromptBuilder', () => {
  it('按注册顺序拼接 pipe 输出', () => {
    const builder = createPromptBuilder<TestPromptContext>()
      .pipe('first', fixedPipe('first prompt'))
      .pipe('second', fixedPipe('second prompt'));

    expect(builder.build({ enabled: true, name: 'test' })).toBe(
      'first prompt\n\nsecond prompt',
    );
  });

  it('跳过返回 null 的 pipe', () => {
    const builder = createPromptBuilder<TestPromptContext>()
      .pipe('base', fixedPipe('base prompt'))
      .pipe('optional', optionalPipe())
      .pipe('style', fixedPipe('style prompt'));

    expect(builder.build({ enabled: false, name: 'test' })).toBe(
      'base prompt\n\nstyle prompt',
    );
  });

  it('pipe 可以根据运行时上下文决定内容', () => {
    const builder = createPromptBuilder<TestPromptContext>()
      .pipe('base', fixedPipe('base prompt'))
      .pipe('optional', optionalPipe());

    expect(builder.build({ enabled: true, name: 'Super Agent' })).toBe(
      'base prompt\n\nenabled for Super Agent',
    );
  });

  it('inspect 返回每个 pipe 的开关状态、字符数和内容', () => {
    const builder = createPromptBuilder<TestPromptContext>()
      .pipe('coreRules', fixedPipe('base prompt'))
      .pipe('sessionContext', optionalPipe());

    expect(builder.inspect({ enabled: false, name: 'Super Agent' })).toEqual([
      {
        name: 'coreRules',
        enabled: true,
        chars: 11,
        content: 'base prompt',
      },
      {
        name: 'sessionContext',
        enabled: false,
        chars: 0,
        content: null,
      },
    ]);
  });

  it('debug 输出每个 pipe 的 ON/OFF 状态', () => {
    const builder = createPromptBuilder<TestPromptContext>()
      .pipe('coreRules', fixedPipe('base prompt'))
      .pipe('sessionContext', optionalPipe());

    expect(builder.debug({ enabled: false, name: 'Super Agent' })).toBe(
      [
        '=== Prompt Pipe Debug ===',
        '  coreRules: [ON] 11 chars',
        '  sessionContext: [OFF]',
        '========================',
      ].join('\n'),
    );
  });

  it('render 一次执行 pipe，同时返回 prompt、entries 和 debug', () => {
    let calls = 0;
    const countedPipe = (): PromptPipe<TestPromptContext> => () => {
      calls++;
      return 'counted prompt';
    };
    const builder = createPromptBuilder<TestPromptContext>()
      .pipe('counted', countedPipe())
      .pipe('optional', optionalPipe());

    const result = builder.render({ enabled: false, name: 'Super Agent' });

    expect(calls).toBe(1);
    expect(result.prompt).toBe('counted prompt');
    expect(result.entries).toEqual([
      {
        name: 'counted',
        enabled: true,
        chars: 14,
        content: 'counted prompt',
      },
      {
        name: 'optional',
        enabled: false,
        chars: 0,
        content: null,
      },
    ]);
    expect(result.debug).toBe(
      [
        '=== Prompt Pipe Debug ===',
        '  counted: [ON] 14 chars',
        '  optional: [OFF]',
        '========================',
      ].join('\n'),
    );
  });
});
