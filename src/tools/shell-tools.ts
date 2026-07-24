import { exec } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import type { ToolDefinition } from './registry';

const DEFAULT_TIMEOUT = 10_000;
const MAX_TIMEOUT     = 30_000;

// 每条规则说明拦截原因，方便日后审计和调整
const BLOCKED: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+.*(--recursive|-[a-z]*[rR])/,  reason: 'rm -r/--recursive 会递归删除，禁止使用' },
  { pattern: /\bdd\b/,                               reason: 'dd 可覆写磁盘设备' },
  { pattern: /\bmkfs\b/,                             reason: 'mkfs 会格式化分区' },
  { pattern: /\bsudo\b/,                             reason: '禁止提权操作' },
  { pattern: /\b(shutdown|reboot|poweroff|halt)\b/,  reason: '禁止电源管理命令' },
  { pattern: /:\(\)\s*\{[^}]*\|[^}]*&[^}]*\}/,      reason: 'fork bomb 特征' },
  { pattern: />\s*\/dev\/[sh]d[a-z]/,               reason: '禁止直接写入块设备' },
  { pattern: /\|\s*(ba|da|z)?sh\b/,                 reason: '禁止管道执行脚本（curl|bash 等）' },
  { pattern: /\bkill\s+-9\s+1\b/,                   reason: '禁止终止 init 进程' },
  { pattern: /\bchmod\s+.*-[rR]/,                   reason: '禁止递归 chmod' },
];

function checkSafe(command: string): void {
  for (const { pattern, reason } of BLOCKED) {
    if (pattern.test(command)) throw new Error(`命令被拦截：${reason}`);
  }
}

export const bashTool: ToolDefinition = {
  name: 'bash',
  description: '执行 shell 命令，返回 stdout + stderr。危险命令（rm -r、sudo、dd 等）会被拦截，超时默认 10s。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string',  description: '要执行的 shell 命令' },
      cwd:     { type: 'string',  description: '工作目录，默认为当前目录' },
      timeout: { type: 'integer', description: `超时毫秒数，默认 ${DEFAULT_TIMEOUT}，最大 ${MAX_TIMEOUT}` },
    },
    required: ['command'],
    additionalProperties: false,
  },
  isConcurrencySafe: false,
  isReadOnly: false,
  execute: async ({ command, cwd = '.', timeout = DEFAULT_TIMEOUT }
    : { command: string; cwd?: string; timeout?: number }) => {

    checkSafe(command);

    const cappedTimeout = Math.min(timeout, MAX_TIMEOUT);

    const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
      (resolve, reject) => {
        const child = exec(command, {
          cwd:       resolvePath(cwd),
          timeout:   cappedTimeout,
          maxBuffer: 1024 * 1024, // 1 MB，防止超大输出撑爆内存
        }, (err, stdout, stderr) => {
          if (err?.killed) {
            reject(new Error(`命令超时（>${cappedTimeout}ms）`));
          } else {
            resolve({ stdout, stderr, code: err?.code ?? 0 });
          }
        });
        void child;
      }
    );

    const output = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n');
    const exitHint = code !== 0 ? `\n[exit ${code}]` : '';
    return (output || '（无输出）') + exitHint;
  },
};
