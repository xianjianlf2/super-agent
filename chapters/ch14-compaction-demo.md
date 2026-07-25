# 第 14 章：压缩演示与日志开关

## 本章目标

加入一个可重复运行的压缩演示：预注入 16 条模拟历史消息，展示 Microcompact 和 SummaryCompact 如何把上下文压缩成 9 条消息。

## 为什么需要它

上下文压缩很难只靠读代码理解。固定 demo 可以让读者直接看到：

- 压缩前有多少消息和估算 token。
- Microcompact 清理了哪些旧工具结果。
- SummaryCompact 压缩了多少早期消息。
- 最终保留了 1 条摘要和最近 8 条消息。

## 演示设计

模拟历史包含 4 轮工具调用，每轮 4 条消息：

1. 用户请求。
2. Assistant 发起工具调用。
3. Tool 返回结果。
4. Assistant 总结结果。

第一轮工具结果故意做得很长，用来触发 Microcompact。前两轮会被 SummaryCompact 压成摘要，后两轮作为最近上下文保留。

## 运行方式

```bash
pnpm exec tsx src/index.ts --demo-compaction --debug-compaction
```

预期输出形态：

```text
[Session] 新会话（已注入 16 条模拟历史）
[压缩前] 16 条消息, ~1290 tokens
[Layer 1: Microcompact] 清理了 1 个工具结果, ~720 tokens
[Layer 2: Summarization] 压缩了 8 条消息, ~80 tokens
[摘要预览] ## 用户意图 ...
[压缩后] 9 条消息, ~470 tokens
```

普通启动仍然保持安静：

```bash
pnpm start
```

## 核心实现

- `src/index.ts`：新增 `--demo-compaction`，只在显式打开时注入模拟历史。
- `src/mock-model.ts`：Mock 模型在摘要压缩场景返回符合模板的结构化摘要。

## 常见坑

- Demo 数据不要默认注入，否则正常新会话会混入教学历史。
- Demo 日志要挂在 `--debug-compaction` 下，避免生产对话刷屏。
- Mock 摘要必须满足模板校验，否则演示会显示压缩失败。

## 下一章

下一阶段可以继续做更轻量的防线：真实 token 估算、工具结果截断策略和 TTL 修剪。
