// 本地 Mock 模型：不需要 API Key 也能演示三层防护。
// 填了 DASHSCOPE_API_KEY 后 model.ts 会自动切到真实 Qwen，这个文件就不生效了。
//
// 支持的“剧本”（由用户输入触发）：
//   测试死循环 —— 反复调用同一工具，直到收到 [系统提醒] 才“醒过来”停手
//   测试重试   —— 连抛两次 429，第三次成功
//   测试预算   —— 每步消耗 4500 tokens（输入 3000 + 输出 1500）
//   北京天气   —— 正常：先调 get_weather，拿到结果再给文本（验证防护没误伤）

const SMALL_USAGE = {
  inputTokens: { total: 50, noCache: 50, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 30, text: 30, reasoning: undefined },
};

// 预算模式：每步 3000 + 1500 = 4500 tokens；limit 15000 → 第 4 轮触发熔断
const BUDGET_USAGE = {
  inputTokens: { total: 3000, noCache: 3000, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1500, text: 1500, reasoning: undefined },
};

const CITIES = ['北京', '上海', '广州', '深圳'];

const RESPONSES: Record<string, string> = {
  default: '你好！我是模拟模型。填了 DASHSCOPE_API_KEY 后会自动切换到真实的 Qwen。',
  greeting: '你好！虽然是模拟的，但流式输出的效果和真实 API 一致 :)',
  intro: '我是通义千问（模拟版），在本地模拟回复，机制和真实 API 完全一致。',
};

const COMPRESS_RESPONSE = `## 用户意图
用户在探索项目结构和代码，了解工具系统的设计。

## 已完成的操作
- 列出了当前目录文件：\`.env\`、\`package.json\`、\`sample-data.txt\`、\`src/\`
- 读取了 \`package.json\`，确认项目名为 \`super-agent-08-compaction\`
- 搜索了 \`ToolRegistry\` 相关实现
- 读取了 \`src/tools/registry.ts\` 的关键逻辑

## 关键发现
- 工具通过 \`ToolRegistry\` 统一注册，并转换成 AI SDK 格式
- 工具结果需要按 AI SDK 的 \`tool-result\` 结构保存
- \`read_file\`、\`bash\`、\`grep_files\` 属于可清理的查询类工具

## 当前状态
已经完成早期项目结构探索，后续可以继续基于保留的最近工具结果分析。

## 需要保留的细节
- \`package.json\`
- \`src/tools/registry.ts\`
- \`ToolRegistry\`
- \`super-agent-08-compaction\``;

// --- 从 prompt 里抽取信息 ---

function userTexts(prompt: any[]): string[] {
  return (prompt || [])
    .filter((m: any) => m.role === 'user')
    .map((m: any) =>
      Array.isArray(m.content)
        ? m.content.map((c: any) => c.text || '').join('')
        : String(m.content || ''),
    );
}

function pickCity(text: string): string {
  return CITIES.find((c) => text.includes(c)) ?? '北京';
}

function pickDefault(allText: string): string {
  const t = allText.toLowerCase();
  if (t.includes('介绍你自己') || t.includes('你是谁')) return RESPONSES.intro;
  if (t.includes('你好') || t.includes('hello')) return RESPONSES.greeting;
  return RESPONSES.default;
}

// --- chunk 构造 ---

function textChunks(text: string, usage: any): any[] {
  const id = 'text-1';
  return [
    { type: 'text-start', id },
    ...[...text].map((ch) => ({ type: 'text-delta', id, delta: ch })),
    { type: 'text-end', id },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
  ];
}

let toolSeq = 0;
function toolCallChunks(toolName: string, args: unknown, usage: any): any[] {
  return [
    {
      type: 'tool-call',
      toolCallId: `call-${++toolSeq}`,
      toolName,
      input: JSON.stringify(args),
    },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ];
}

function createDelayedStream(chunks: any[], delayMs = 15): ReadableStream {
  return new ReadableStream({
    start(controller) {
      let i = 0;
      function next() {
        if (i < chunks.length) {
          controller.enqueue(chunks[i++]);
          setTimeout(next, delayMs);
        } else {
          controller.close();
        }
      }
      next();
    },
  });
}

// 测试重试的攻击计数：同一步内 prompt 长度不变 → calls 累加；新一轮 query 长度变化 → 归零
const retryState = { lastLen: -1, calls: 0 };
function bumpRetry(promptLen: number): number {
  if (promptLen !== retryState.lastLen) {
    retryState.lastLen = promptLen;
    retryState.calls = 0;
  }
  return ++retryState.calls;
}

// --- 核心：决定本步该输出什么 ---

function plan(prompt: any[]): { stream: ReadableStream } {
  const texts = userTexts(prompt);
  const all = texts.join(' ');
  const lastUser = texts[texts.length - 1] ?? '';
  const lastRole = prompt[prompt.length - 1]?.role;

  // 测试重试：抛 429
  if (all.includes('测试重试')) {
    const calls = bumpRetry(prompt.length);
    if (calls <= 2) {
      throw new Error('429 Too Many Requests: rate limit exceeded, please retry later');
    }
    return {
      stream: createDelayedStream(
        textChunks('重试成功！经过几次 429 错误后，我终于回来了。', SMALL_USAGE),
      ),
    };
  }

  // 测试预算：每步烧 4500 tokens，不调工具
  if (all.includes('测试预算')) {
    return {
      stream: createDelayedStream(
        textChunks('这是预算测试回复，本步约消耗 4500 tokens（输入 3000 + 输出 1500）。', BUDGET_USAGE),
      ),
    };
  }

  // 测试死循环：反复调同一工具，收到系统提醒后停手
  if (all.includes('测试死循环')) {
    if (lastUser.includes('系统提醒')) {
      return {
        stream: createDelayedStream(
          textChunks('收到提醒，我换个思路：北京今天晴，25°C，不再重复调用了。', SMALL_USAGE),
        ),
      };
    }
    return {
      stream: createDelayedStream(toolCallChunks('get_weather', { city: '北京' }, SMALL_USAGE)),
    };
  }

  // 正常天气：第一步调工具，拿到结果后给文本
  if (all.includes('天气')) {
    if (lastRole === 'tool') {
      return {
        stream: createDelayedStream(
          textChunks(`查到了，${pickCity(all)}的天气信息如上。`, SMALL_USAGE),
        ),
      };
    }
    return {
      stream: createDelayedStream(
        toolCallChunks('get_weather', { city: pickCity(all) }, SMALL_USAGE),
      ),
    };
  }

  // 兜底纯文本
  return { stream: createDelayedStream(textChunks(pickDefault(all), SMALL_USAGE)) };
}

export function createMockModel() {
  return {
    specificationVersion: 'v3' as const,
    provider: 'mock',
    modelId: 'mock-model',
    get supportedUrls() {
      return Promise.resolve({});
    },

    async doGenerate({ prompt }: any) {
      const text = userTexts(prompt).join(' ');
      if (text.includes('[#') && text.includes('tool-result')) {
        return {
          content: [{ type: 'text' as const, text: COMPRESS_RESPONSE }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: SMALL_USAGE,
          warnings: [],
        };
      }

      return {
        content: [{ type: 'text' as const, text: pickDefault(text) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: SMALL_USAGE,
        warnings: [],
      };
    },

    async doStream({ prompt }: any) {
      // plan 可能直接抛 429（测试重试），交给 agent loop 的重试逻辑处理
      return plan(prompt);
    },
  };
}
