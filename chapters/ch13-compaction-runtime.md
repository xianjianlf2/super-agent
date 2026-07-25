# 第 13 章：压缩运行时集成

## 本章目标

把 Microcompact 和 SummaryCompact 接入 CLI 运行时，让 Agent 在恢复历史和每轮对话结束后自动检查上下文是否需要压缩。

## 为什么需要它

压缩模块单独存在还不够，真正的 Agent 需要在合适的时机自动执行压缩，并且不能让压缩日志、模型失败或额外 token 成本干扰正常对话。

## 集成时机

- 启动并恢复历史会话后：先压缩旧上下文，再进入交互。
- 每轮对话结束后：先持久化本轮新增消息，再压缩内存中的上下文，供下一轮使用。

## 稳定性保障

- 摘要压缩失败时保留原始消息。
- 连续失败 3 次后暂停 SummaryCompact，避免反复浪费 LLM 调用。
- 使用独立 `compressionModel`，可通过 `COMPRESSION_MODEL` 配置为更便宜的模型。
- 普通启动默认安静，压缩统计只在 `--debug-compaction` 下打印。
- 工具调用、工具结果、Step 和 Token 细节只在 `--verbose` 下打印。

## 核心实现

- `src/index.ts`：启动和轮次结束时串联 `Microcompact -> SummaryCompact`。
- `src/agent/loop.ts`：返回本轮新增消息，避免压缩历史后影响 JSONL 持久化。
- `src/model.ts`：导出主模型和压缩模型。
- `src/agent/token-estimate.ts`：集中提供轻量 token 估算。

## 运行方式

```bash
pnpm start
pnpm start -- --debug-compaction
pnpm start -- --verbose
COMPRESSION_MODEL=qwen-turbo-latest pnpm start
```

## 常见坑

- 不要在工具循环中途压缩上下文，否则可能破坏工具调用和工具结果的配对关系。
- 不要默认打印压缩详情，生产 Agent 的默认输出应该只服务用户。
- 不要把压缩后的内存消息直接覆盖 JSONL 原始历史；原始历史保留后更容易审计和重新压缩。

## 下一章

下一章加入一组 16 条模拟历史消息，用 `--demo-compaction` 展示从 16 条压缩到 9 条的完整流程。
