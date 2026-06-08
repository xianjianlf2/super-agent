import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileTool, editFileTool, globTool, searchFilesTool, grepFilesTool } from './file-tools';

let dir: string;
let file: string;

beforeEach(() => {
  dir  = mkdtempSync(join(tmpdir(), 'edit-test-'));
  file = join(dir, 'sample.txt');
  writeFileSync(file, 'hello world');
});

afterEach(() => rmSync(dir, { recursive: true }));

describe('readFileTool', () => {
  it('无行范围时返回全部内容', async () => {
    writeFileSync(file, 'a\nb\nc');
    expect(await readFileTool.execute({ path: file })).toBe('a\nb\nc');
  });

  it('指定 start_line/end_line 只返回对应行', async () => {
    writeFileSync(file, 'line1\nline2\nline3\nline4');
    const result = await readFileTool.execute({ path: file, start_line: 2, end_line: 3 }) as string;
    expect(result).toContain('line2');
    expect(result).toContain('line3');
    expect(result).not.toContain('line1');
    expect(result).not.toContain('line4');
  });

  it('只给 start_line 时读到文件末尾', async () => {
    writeFileSync(file, 'a\nb\nc');
    const result = await readFileTool.execute({ path: file, start_line: 2 }) as string;
    expect(result).toContain('b');
    expect(result).toContain('c');
    expect(result).not.toContain('a');
  });

  it('有行范围时结果包含行号提示', async () => {
    writeFileSync(file, 'a\nb\nc');
    const result = await readFileTool.execute({ path: file, start_line: 1, end_line: 2 }) as string;
    expect(result).toContain('第 1–2 行');
  });
});

describe('editFileTool', () => {
  it('正常替换并更新文件内容', async () => {
    const result = await editFileTool.execute({ path: file, old_str: 'world', new_str: 'vitest' });
    expect(result).toBe('已替换 1 处');
    expect(readFileSync(file, 'utf-8')).toBe('hello vitest');
  });

  it('old_str 不存在时抛错', async () => {
    await expect(editFileTool.execute({ path: file, old_str: 'xyz', new_str: '' }))
      .rejects.toThrow('未找到');
  });

  it('old_str 不唯一时抛错并报告匹配数', async () => {
    writeFileSync(file, 'aa bb aa');
    await expect(editFileTool.execute({ path: file, old_str: 'aa', new_str: 'cc' }))
      .rejects.toThrow('找到 2 处');
  });

  it('文件不存在时抛错', async () => {
    await expect(editFileTool.execute({ path: '/tmp/__no_such_file__.txt', old_str: 'x', new_str: 'y' }))
      .rejects.toThrow('文件不存在');
  });

  it('替换多行内容', async () => {
    writeFileSync(file, 'line1\nline2\nline3');
    await editFileTool.execute({ path: file, old_str: 'line1\nline2', new_str: 'replaced' });
    expect(readFileSync(file, 'utf-8')).toBe('replaced\nline3');
  });
});

describe('globTool', () => {
  it('匹配指定后缀的文件', async () => {
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'b.ts'), '');
    writeFileSync(join(dir, 'c.js'), '');
    const result = await globTool.execute({ pattern: '*.ts', cwd: dir }) as string;
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).not.toContain('c.js');
  });

  it('无匹配时返回提示', async () => {
    const result = await globTool.execute({ pattern: '*.xyz', cwd: dir });
    expect(result).toBe('无匹配文件');
  });

  it('支持 ** 递归匹配', async () => {
    const subdir = join(dir, 'sub');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(join(subdir, 'deep.ts'), '');
    const result = await globTool.execute({ pattern: '**/*.ts', cwd: dir }) as string;
    expect(result).toContain('deep.ts');
  });
});

describe('searchFilesTool', () => {
  it('精确关键词能匹配', async () => {
    writeFileSync(join(dir, 'sample-data.txt'), '');
    const result = await searchFilesTool.execute({ keyword: 'sample-data', cwd: dir }) as string;
    expect(result).toContain('sample-data.txt');
  });

  it('去掉连字符后仍能匹配（sampledata → sample-data.txt）', async () => {
    writeFileSync(join(dir, 'sample-data.txt'), '');
    const result = await searchFilesTool.execute({ keyword: 'sampledata', cwd: dir }) as string;
    expect(result).toContain('sample-data.txt');
  });

  it('下划线形式也能匹配', async () => {
    writeFileSync(join(dir, 'sample_data.json'), '');
    const result = await searchFilesTool.execute({ keyword: 'sampledata', cwd: dir }) as string;
    expect(result).toContain('sample_data.json');
  });

  it('大小写不敏感', async () => {
    writeFileSync(join(dir, 'SampleData.ts'), '');
    const result = await searchFilesTool.execute({ keyword: 'sampledata', cwd: dir }) as string;
    expect(result).toContain('SampleData.ts');
  });

  it('无匹配时返回提示', async () => {
    const result = await searchFilesTool.execute({ keyword: 'nothinghere', cwd: dir });
    expect(result).toBe('无匹配文件');
  });
});

describe('grepFilesTool', () => {
  it('找到匹配行并返回 文件:行号: 内容 格式', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello world\nfoo bar\nhello again');
    const result = await grepFilesTool.execute({ keyword: 'hello', cwd: dir }) as string;
    expect(result).toContain('a.txt:1: hello world');
    expect(result).toContain('a.txt:3: hello again');
    expect(result).not.toContain('foo bar');
  });

  it('大小写不敏感', async () => {
    writeFileSync(join(dir, 'b.txt'), 'Hello World');
    const result = await grepFilesTool.execute({ keyword: 'hello', cwd: dir }) as string;
    expect(result).toContain('b.txt:1:');
  });

  it('跨文件搜索', async () => {
    writeFileSync(join(dir, 'x.txt'), 'find me here');
    writeFileSync(join(dir, 'y.txt'), 'nothing relevant');
    writeFileSync(join(dir, 'z.txt'), 'find me too');
    const result = await grepFilesTool.execute({ keyword: 'find me', cwd: dir }) as string;
    expect(result).toContain('x.txt');
    expect(result).toContain('z.txt');
    expect(result).not.toContain('y.txt');
  });

  it('无匹配时返回提示', async () => {
    writeFileSync(join(dir, 'c.txt'), 'nothing here');
    const result = await grepFilesTool.execute({ keyword: 'xyzxyz', cwd: dir });
    expect(result).toBe('无匹配内容');
  });

  it('include 过滤只搜指定后缀', async () => {
    writeFileSync(join(dir, 'a.ts'),  'TODO: fix this');
    writeFileSync(join(dir, 'b.md'), 'TODO: update docs');
    const result = await grepFilesTool.execute({ keyword: 'TODO', cwd: dir, include: '*.ts' }) as string;
    expect(result).toContain('a.ts');
    expect(result).not.toContain('b.md');
  });

  it('.gitignore 中的目录被跳过', async () => {
    writeFileSync(join(dir, '.gitignore'), 'ignored-dir\n');
    const ignoredDir = join(dir, 'ignored-dir');
    mkdirSync(ignoredDir);
    writeFileSync(join(ignoredDir, 'secret.txt'), 'should not appear');
    writeFileSync(join(dir, 'normal.txt'), 'should appear');
    const result = await grepFilesTool.execute({ keyword: 'should', cwd: dir }) as string;
    expect(result).toContain('normal.txt');
    expect(result).not.toContain('secret.txt');
  });
});
