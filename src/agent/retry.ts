// --- 错误分类：哪些值得重试，哪些直接抛 ---
// 核心原则：429 限流 / 5xx / 网络抖动 → 等一会重试；
//          400 参数错误、鉴权失败 → 重试一万次也没用，直接抛。

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message || '';

  // 限流
  if (/\b429\b/.test(message) || /rate.?limit/i.test(message)) return true;
  // 服务端错误
  if (/\b5\d{2}\b/.test(message)) return true;
  // 超时 / 网络抖动
  if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed|network/i.test(message)) return true;
  // AI SDK 会把流式错误包装成 NoOutputGeneratedError
  if (message.includes('No output generated')) return true;

  return false;
}

// --- 指数退避 + 随机抖动 ---
// 指数退避：500ms → 1000ms → 2000ms → 4000ms，避免连续重试轰炸服务端。
// 随机抖动（±25%）：让并发客户端错开重试时刻，避免“惊群”同时回来。
// 参考 AWS：Exponential Backoff And Jitter。

export function calculateDelay(attempt: number, baseMs = 500, maxMs = 30000): number {
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxMs);
  const jitterRange = capped * 0.25;
  const jittered = capped + (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(jittered));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
