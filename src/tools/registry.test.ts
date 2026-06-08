import { describe, it, expect } from 'vitest';
import { ToolRegistry, truncateResult, type ToolDefinition } from './registry';

// ── truncateResult ──────────────────────────────────────────────────────────

describe('truncateResult', () => {
  it('短于上限时原样返回', () => {
    expect(truncateResult('hello', 100)).toBe('hello');
  });

  it('刚好等于上限时不截断', () => {
    const text = 'a'.repeat(100);
    expect(truncateResult(text, 100)).toBe(text);
  });

  it('超出上限时保留头 60% + 尾 40%', () => {
    const text = 'a'.repeat(60) + 'b'.repeat(40) + 'c'.repeat(100); // 200字，限100
    const result = truncateResult(text, 100);
    expect(result).toContain('省略');
    expect(result.startsWith('a'.repeat(60))).toBe(true); // 头60%
    expect(result.endsWith('c'.repeat(40))).toBe(true);   // 尾40%
  });

  it('省略信息里包含正确的字符数', () => {
    const text = 'x'.repeat(200);
    const result = truncateResult(text, 100);
    // 头60 + 尾40 = 100，省略 100 字符
    expect(result).toContain('省略 100 字符');
  });
});

// ── ToolRegistry 注册与查找 ─────────────────────────────────────────────────

const mockTool: ToolDefinition = {
  name: 'mock_tool',
  description: '测试工具',
  parameters: {
    type: 'object',
    properties: { input: { type: 'string' } },
    required: ['input'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ input }: { input: string }) => `echo: ${input}`,
};

describe('ToolRegistry 注册与查找', () => {
  it('注册后能通过 get 查到工具', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    expect(registry.get('mock_tool')).toBe(mockTool);
  });

  it('查不存在的工具返回 undefined', () => {
    const registry = new ToolRegistry();
    expect(registry.get('no_such_tool')).toBeUndefined();
  });

  it('getAll 返回所有已注册工具', () => {
    const registry = new ToolRegistry();
    const another: ToolDefinition = { ...mockTool, name: 'another' };
    registry.register(mockTool, another);
    expect(registry.getAll()).toHaveLength(2);
  });

  it('toAISDKFormat 包含所有工具名作为 key', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    const formatted = registry.toAISDKFormat();
    expect(formatted).toHaveProperty('mock_tool');
    expect(formatted.mock_tool).toHaveProperty('description', '测试工具');
    expect(formatted.mock_tool).toHaveProperty('execute');
  });

  it('toAISDKFormat 的 execute 应用了 maxResultChars 截断', async () => {
    const bigTool: ToolDefinition = {
      ...mockTool,
      name: 'big_tool',
      maxResultChars: 10,
      execute: async () => 'x'.repeat(100),
    };
    const registry = new ToolRegistry();
    registry.register(bigTool);
    const result = await registry.toAISDKFormat().big_tool.execute({}) as string;
    expect(result).toContain('省略');
    expect(result.startsWith('x'.repeat(6))).toBe(true); // 头 60% = 6字符
    expect(result.endsWith('x'.repeat(4))).toBe(true);   // 尾 40% = 4字符
  });
});

// ── 读写锁并发行为 ──────────────────────────────────────────────────────────

describe('读写锁', () => {
  it('多个只读工具可同时执行（共享锁）', async () => {
    const log: string[] = [];

    const makeReadTool = (name: string): ToolDefinition => ({
      name,
      description: '',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      isConcurrencySafe: true,
      isReadOnly: true,
      execute: async () => {
        log.push(`${name}:start`);
        await new Promise(r => setTimeout(r, 20));
        log.push(`${name}:end`);
        return name;
      },
    });

    const registry = new ToolRegistry();
    registry.register(makeReadTool('r1'), makeReadTool('r2'));
    const fmt = registry.toAISDKFormat();

    // 同时触发两个只读工具
    await Promise.all([fmt.r1.execute({}), fmt.r2.execute({})]);

    // 两个 start 都应在任意一个 end 之前出现（说明是并行的）
    expect(log.indexOf('r1:start')).toBeLessThan(log.indexOf('r2:end'));
    expect(log.indexOf('r2:start')).toBeLessThan(log.indexOf('r1:end'));
  });

  it('写工具独占执行，不与其他工具并行', async () => {
    const log: string[] = [];

    const readTool: ToolDefinition = {
      name: 'read',
      description: '',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      isConcurrencySafe: true,
      isReadOnly: true,
      execute: async () => {
        log.push('read:start');
        await new Promise(r => setTimeout(r, 30));
        log.push('read:end');
        return 'read';
      },
    };

    const writeTool: ToolDefinition = {
      name: 'write',
      description: '',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      isConcurrencySafe: false,
      isReadOnly: false,
      execute: async () => {
        log.push('write:start');
        await new Promise(r => setTimeout(r, 10));
        log.push('write:end');
        return 'write';
      },
    };

    const registry = new ToolRegistry();
    registry.register(readTool, writeTool);
    const fmt = registry.toAISDKFormat();

    // 先启动读，再启动写（写必须等读结束）
    const readPromise = fmt.read.execute({});
    await new Promise(r => setTimeout(r, 5)); // 确保读先拿到锁
    const writePromise = fmt.write.execute({});
    await Promise.all([readPromise, writePromise]);

    // write:start 必须在 read:end 之后
    expect(log.indexOf('write:start')).toBeGreaterThan(log.indexOf('read:end'));
  });
});
