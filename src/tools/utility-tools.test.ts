import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, afterEach, afterAll, beforeAll } from 'vitest';
import { fetchUrlTool, startPreviewTool, closePreviewServer } from './utility-tools';

afterEach(() => vi.unstubAllGlobals());

const TEST_PORT = 19_080;
let tmpRoot = '';

describe('startPreviewTool', () => {
  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'preview-test-'));
    await writeFile(join(tmpRoot, 'index.html'), '<h1>Hello Preview</h1>');
    await mkdir(join(tmpRoot, 'assets'));
    await writeFile(join(tmpRoot, 'assets', 'style.css'), 'body { color: red; }');
  });

  afterAll(() => closePreviewServer());

  it('首次调用返回 started', async () => {
    const result = await startPreviewTool.execute({ root: tmpRoot, port: TEST_PORT }) as any;
    expect(result.status).toBe('started');
    expect(result.url).toBe(`http://localhost:${TEST_PORT}`);
    expect(result.root).toBe(tmpRoot);
  });

  it('重复调用同一 root 返回 already_running', async () => {
    const result = await startPreviewTool.execute({ root: tmpRoot, port: TEST_PORT }) as any;
    expect(result.status).toBe('already_running');
  });

  it('GET / 返回 index.html 内容', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Hello Preview');
  });

  it('GET /assets/style.css 返回 CSS MIME', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/assets/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('不存在的路径回退到 index.html（SPA routing）', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/no-such-page`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Hello Preview');
  });

  it('路径穿越（../）被阻断，不能读取 tmpRoot 外的文件', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/../../etc/passwd`);
    // 回退到 index.html 而不是暴露系统文件
    const body = await res.text();
    expect(body).not.toContain('root:');
  });
});

describe('fetchUrlTool — mock 路径', () => {
  it('命中 MOCK_PAGES 时返回 mock source', async () => {
    const result = await fetchUrlTool.execute({ url: 'https://example.com' }) as any;
    expect(result.source).toBe('mock');
    expect(result.text).toContain('Example Domain');
  });

  it('mock 结果不含 HTML 标签', async () => {
    const result = await fetchUrlTool.execute({ url: 'https://example.com' }) as any;
    expect(result.text).not.toMatch(/<[^>]+>/);
  });
});

describe('fetchUrlTool — network 路径（stub fetch）', () => {
  it('剥掉 script / style / HTML 标签后只剩纯文本', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      text: async () =>
        `<html><head><style>body{color:red}</style></head>` +
        `<body><script>alert(1)</script><h1>Hello</h1><p>World</p></body></html>`,
    }));

    const result = await fetchUrlTool.execute({ url: 'https://not-in-mock.example' }) as any;
    expect(result.source).toBe('network');
    expect(result.text).toContain('Hello');
    expect(result.text).toContain('World');
    expect(result.text).not.toMatch(/<[^>]+>/);
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('body{color:red}');
  });

  it('HTTP 非 2xx 时返回 error', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, statusText: 'Not Found' }));
    const result = await fetchUrlTool.execute({ url: 'https://not-in-mock.example' }) as any;
    expect(result.error).toMatch(/404/);
  });

  it('fetch 抛出异常时返回 error', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network timeout'); });
    const result = await fetchUrlTool.execute({ url: 'https://not-in-mock.example' }) as any;
    expect(result.error).toContain('network timeout');
  });
});
