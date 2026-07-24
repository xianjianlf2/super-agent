import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import type { ToolDefinition } from './registry';

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: '读取文件内容。可用 start_line/end_line 指定行范围（1-indexed），配合 grep_files 定位后精准读取上下文。',
  parameters: {
    type: 'object',
    properties: {
      path:       { type: 'string',  description: '文件路径' },
      start_line: { type: 'integer', description: '起始行（含），默认第 1 行' },
      end_line:   { type: 'integer', description: '结束行（含），默认最后一行' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  maxResultChars: 500,
  execute: async ({ path, start_line, end_line }: { path: string; start_line?: number; end_line?: number }) => {
    const lines = readFileSync(resolve(path), 'utf-8').split('\n');
    const from = (start_line ?? 1) - 1;
    const to   = end_line ?? lines.length;
    const slice = lines.slice(from, to).join('\n');
    return (start_line != null || end_line != null)
      ? `[第 ${from + 1}–${to} 行]\n${slice}`
      : slice;
  },
};

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: '写入内容到指定文件路径',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      content: { type: 'string', description: '要写入的内容' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  isConcurrencySafe: false,
  isReadOnly: false,
  execute: async ({ path, content }: { path: string; content: string }) => {
    writeFileSync(resolve(path), content, 'utf-8');
    return `已写入 ${content.length} 字符到 ${path}`;
  },
};

export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: '对文件做精确字符串替换：将 old_str 替换为 new_str。old_str 必须在文件中唯一且完整匹配。',
  parameters: {
    type: 'object',
    properties: {
      path:    { type: 'string', description: '文件路径' },
      old_str: { type: 'string', description: '要被替换的原始字符串（必须唯一）' },
      new_str: { type: 'string', description: '替换后的新字符串' },
    },
    required: ['path', 'old_str', 'new_str'],
    additionalProperties: false,
  },
  isConcurrencySafe: false,
  isReadOnly: false,
  execute: async ({ path, old_str, new_str }: { path: string; old_str: string; new_str: string }) => {
    const resolved = resolve(path);
    if (!existsSync(resolved)) throw new Error(`文件不存在: ${path}`);

    const content = readFileSync(resolved, 'utf-8');
    const count = content.split(old_str).length - 1;
    if (count === 0) throw new Error(`未找到匹配字符串`);
    if (count > 1)   throw new Error(`找到 ${count} 处匹配，old_str 必须唯一`);

    writeFileSync(resolved, content.replace(old_str, new_str), 'utf-8');
    return `已替换 1 处`;
  },
};

export const globTool: ToolDefinition = {
  name: 'glob',
  description: '用 glob 模式匹配文件路径，支持 ** 递归通配符。按名称查找文件用 **/*<关键词>*（如查找 sample-data 用 **/*sample-data*），按类型用 src/**/*.ts。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'glob 模式，如 src/**/*.ts' },
      cwd:     { type: 'string', description: '搜索根目录，默认为当前目录' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ pattern, cwd = '.' }: { pattern: string; cwd?: string }) => {
    const matches = globFiles(pattern, resolve(cwd));
    if (matches.length === 0) return '无匹配文件';
    return matches.sort().join('\n');
  },
};

// 归一化：小写 + 去掉所有分隔符，让 sampledata / sample_data / sample-data 等价
const normalize = (s: string) => s.toLowerCase().replace(/[-_.\s]/g, '');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__']);

// 读项目根目录的 .gitignore，把无通配符的条目合并进 SKIP_DIRS
function buildSkipSet(root: string): Set<string> {
  const gitignorePath = join(root, '.gitignore');
  if (!existsSync(gitignorePath)) return SKIP_DIRS;

  const extras = readFileSync(gitignorePath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('!') && !/[*?{}]/.test(l))
    .map(l => l.replace(/\/$/, '')); // dist/ → dist

  return new Set([...SKIP_DIRS, ...extras]);
}

function walkFiles(dir: string, skip: Set<string> = SKIP_DIRS): string[] {
  return readdirSync(dir).flatMap(name => {
    if (skip.has(name)) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walkFiles(full, skip) : [full];
  });
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === '*') {
      if (next === '*') {
        const after = pattern[i + 2];
        if (after === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i++;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      source += '[^/]';
      continue;
    }
    source += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

function globFiles(pattern: string, root: string): string[] {
  const matcher = globToRegExp(pattern.replace(/\\/g, '/'));
  return walkFiles(root, buildSkipSet(root))
    .map(f => relative(root, f).replace(/\\/g, '/'))
    .filter(f => matcher.test(f));
}

export const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  description: '按文件名模糊搜索，忽略大小写和 - _ . 分隔符。用户输入 sampledata 也能找到 sample-data.txt。',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词，支持模糊匹配' },
      cwd:     { type: 'string', description: '搜索根目录，默认为当前目录' },
    },
    required: ['keyword'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ keyword, cwd = '.' }: { keyword: string; cwd?: string }) => {
    const root = resolve(cwd);
    const skip  = buildSkipSet(root);
    const needle = normalize(keyword);
    const matches = walkFiles(root, skip)
      .filter(f => normalize(f).includes(needle))
      .map(f => relative(root, f));
    return matches.length === 0 ? '无匹配文件' : matches.sort().join('\n');
  },
};

const MAX_GREP_MATCHES = 100;

// 粗判二进制：读前 512 字节，出现 \0 即认为是二进制。
// 打不开或读不了（目录、无权限）时按“二进制”处理，让调用方跳过该项。
function isBinary(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(512);
    const read = readSync(fd, buf, 0, 512, 0);
    return buf.subarray(0, read).includes(0);
  } catch {
    return true;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export const grepFilesTool: ToolDefinition = {
  name: 'grep_files',
  description: '在文件内容中搜索关键词，返回 文件:行号: 内容 格式，大小写不敏感。可用 include 限定文件范围（如 **/*.ts）。',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词' },
      cwd:     { type: 'string', description: '搜索根目录，默认为当前目录' },
      include: { type: 'string', description: '只搜索匹配此 glob 的文件，如 **/*.ts' },
    },
    required: ['keyword'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ keyword, cwd = '.', include }: { keyword: string; cwd?: string; include?: string }) => {
    const root   = resolve(cwd);
    const needle = keyword.toLowerCase();
    const lines: string[] = [];

    let files: string[];
    if (include) {
      files = globFiles(include, root).map(f => join(root, f));
    } else {
      files = walkFiles(root, buildSkipSet(root));
    }

    for (const file of files) {
      if (isBinary(file)) continue;
      const rel = relative(root, file);
      // glob 可能匹配到目录（如 src/**/* 命中 src/tools），或遇到无权限文件；
      // 读失败时跳过该项，避免整个 grep 因单个条目抛错而中断。
      let content: string;
      try {
        content = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      for (const [i, line] of content.split('\n').entries()) {
        if (line.toLowerCase().includes(needle)) {
          lines.push(`${rel}:${i + 1}: ${line.trimEnd()}`);
          if (lines.length >= MAX_GREP_MATCHES) break;
        }
      }
      if (lines.length >= MAX_GREP_MATCHES) break;
    }

    if (lines.length === 0) return '无匹配内容';
    const suffix = lines.length >= MAX_GREP_MATCHES ? `\n（已截断，只显示前 ${MAX_GREP_MATCHES} 条）` : '';
    return lines.join('\n') + suffix;
  },
};

export const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description: '列出指定目录下的文件和子目录',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径，默认为当前目录' },
    },
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ path = '.' }: { path?: string }) => {
    const resolved = resolve(path);
    return readdirSync(resolved)
      .map(name => {
        const stat = statSync(join(resolved, name));
        return `${stat.isDirectory() ? '[DIR]' : '[FILE]'} ${name}`;
      })
      .join('\n');
  },
};
