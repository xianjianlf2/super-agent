# 第 11 章：Microcompact

## 本章目标

实现第一层上下文压缩：不删除消息、不改变工具调用结构，只把足够老的查询类工具结果替换成 `[tool result cleared]`。

## 为什么需要它

工具结果很容易撑爆上下文，尤其是 `read_file`、`bash`、`grep_files` 这类一次性查询结果。模型后续通常不再需要旧的大段输出，但 AI SDK 的 `ModelMessage` 仍要求保留 `tool-result` 结构，不能把工具结果直接删掉。

## 设计约束

- 只清理白名单工具：`read_file`、`bash`、`grep_files` 等查询类工具。
- 保留最近 3 个工具结果，避免清理模型下一步还会引用的内容。
- 替换时保持 AI SDK 结构化输出：`{ type: 'text', value: '[tool result cleared]' }`。
- 兼容旧 session 中可能残留的字符串工具结果读取。

## 核心实现

- `src/agent/tool-result-text.ts`：集中处理工具结果文本的编码和读取。
- `src/agent/microcompact.ts`：扫描历史消息，按白名单和最近结果保护规则清理旧工具结果。
- `src/agent/*microcompact*.test.ts`：覆盖白名单、最近结果保留和结构化输出。

## 运行方式

```bash
pnpm test -- src/agent/microcompact.test.ts src/agent/tool-result-text.test.ts
```

## 常见坑

- 不要把 `tool-result` 替换成裸字符串，AI SDK 5/6 使用带 `type` 的判别联合。
- 不要清理 `create_issue` 这类写操作结果，Issue ID 等信息后续可能还要用。
- 不要按消息数保留最近上下文，应该按工具结果数量保留。

## 下一章

Microcompact 是零成本压缩。如果清理工具结果后上下文仍然过大，下一章会用 LLM 把早期对话压缩成结构化摘要。
