import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, extname, join } from 'node:path';
import type { ToolDefinition } from './registry';

const MOCK_PAGES: Record<string, string> = {
  'https://example.com': 'Example Domain\n\nThis domain is for use in illustrative examples in documents.',
  'https://httpbin.org/get': '{\n  "url": "https://httpbin.org/get",\n  "headers": { "Host": "httpbin.org" }\n}',
};

export const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: '查询指定城市的天气',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: '要查询的城市名称' },
    },
    required: ['city'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ city }: { city: string }) => {
    const cityMap = new Map([
      ['北京', { temperature: 25, description: '晴天' }],
      ['上海', { temperature: 20, description: '阴天' }],
      ['广州', { temperature: 22, description: '小雨' }],
      ['深圳', { temperature: 23, description: '多云' }],
    ]);
    return cityMap.get(city) ?? { error: `城市 ${city} 暂不支持查询天气` };
  },
};

export const fetchUrlTool: ToolDefinition = {
  name: 'fetch_url',
  description: '抓取指定 URL 的网页内容，返回去除脚本/样式/HTML 标签后的纯文本',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要抓取的网页 URL' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  maxResultChars: 1500, // 网页剥完标签仍可能几万字符，截断兜底避免撑爆上下文
  execute: async ({ url }: { url: string }) => {
    if (MOCK_PAGES[url]) {
      return { url, text: MOCK_PAGES[url], source: 'mock' };
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { error: `HTTP ${res.status}: ${res.statusText}` };
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return { url, text, source: 'network' };
    } catch (err) {
      return { error: String(err) };
    }
  },
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// singleton: reuse the same server across calls instead of binding a new port each time
let previewServer: Server | null = null;
let previewRoot = '';

export const startPreviewTool: ToolDefinition = {
  name: 'start_preview',
  description: '在 8080 端口启动静态文件服务，将 app/ 目录暴露为 HTTP 站点，方便即时预览 Agent 生成的页面。重复调用时若服务已在运行则直接返回 URL。',
  parameters: {
    type: 'object',
    properties: {
      root: {
        type: 'string',
        description: '要伺服的目录路径，默认为 "app"（相对于当前工作目录）',
      },
      port: {
        type: 'integer',
        description: '监听端口，默认 8080',
      },
    },
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: false,
  isReadOnly: false,
  execute: async ({ root = 'app', port = 8080 }: { root?: string; port?: number }) => {
    const absRoot = resolvePath(root);

    if (previewServer?.listening && previewRoot === absRoot) {
      return { status: 'already_running', url: `http://localhost:${port}`, root: absRoot };
    }

    // shut down any previous server serving a different root
    if (previewServer?.listening) {
      await new Promise<void>(r => previewServer!.close(() => r()));
    }

    previewRoot = absRoot;

    previewServer = createServer(async (req, res) => {
      const safePath = (req.url ?? '/').split('?')[0].replace(/\.\./g, '');
      const filePath = join(absRoot, safePath === '/' ? 'index.html' : safePath);
      try {
        const data = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
        res.end(data);
      } catch {
        // fallback to index.html for SPA-style routing
        try {
          const data = await readFile(join(absRoot, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      previewServer!.listen(port, '127.0.0.1', resolve).once('error', reject);
    });

    return { status: 'started', url: `http://localhost:${port}`, root: absRoot };
  },
};

export async function closePreviewServer(): Promise<void> {
  if (previewServer?.listening) {
    await new Promise<void>(r => previewServer!.close(() => r()));
    previewServer = null;
    previewRoot = '';
  }
}

export const calculatorTool: ToolDefinition = {
  name: 'calculator',
  description: '计算数学表达式',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: '数学表达式，例如 (1+2)*3' },
    },
    required: ['expression'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ expression }: { expression: string }) => {
    if (!/^[\d+\-*/().\s]+$/.test(expression)) {
      return { error: `表达式包含不支持的字符: ${expression}` };
    }
    try {
      const result = eval(expression);
      return { expression, result };
    } catch {
      return { error: `无法计算表达式: ${expression}` };
    }
  },
};
