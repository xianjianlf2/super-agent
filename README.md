# super-agent

[English](README.en.md)

一步步搭一个**会用工具的 AI 智能体**的学习项目。基于 [Vercel AI SDK](https://sdk.vercel.dev/) v6 + 通义千问（Qwen）。

每一章对应一个 commit，按顺序读即可看到智能体怎么长出来的。想回到某章代码：`git checkout <commit>`。

## 快速开始

```bash
pnpm install
echo "DASHSCOPE_API_KEY=sk-xxx" > .env   # 不填则用本地 mock 模型

pnpm start      # 启动对话
pnpm compare    # 自动循环 vs 手动循环对比 demo
pnpm test       # 运行单元测试
```

## 章节

| 章节 | 主题 | 一句话 | commit |
|---|---|---|---|
| 第 1 章 | 项目脚手架 | `streamText` 流式输出 + 本地 mock 模型 | `b6bfd22` |
| 第 2 章 | 多轮对话 | 用 `messages` 数组保留上下文，让模型"记住" | `aaff190` |
| 第 3 章 | 工具调用 | `tool()` 定义函数，`stopWhen` 跑多步循环 | `37042a1` |
| 第 4 章 | 自动 vs 手动循环 | `stopWhen` 自动循环 ≈ 手写 `while` 的封装 | `f3c45c6` |
| 第 5 章 | 三层防护 | 循环检测 + API 重试 + Token 预算熔断 | `e2d6201` |
| 第 6 章 | 工具系统 | ToolRegistry + 结果截断 + 读写锁并发控制 | `25fd247` |
| 第 7 章 | 三个实战 demo | `fetch_url` + `start_preview`，用现有工具组装代码分析 / Research / Vibe Coding | `a3408ca` |
| 第 8 章 | MCP 接入 | 手写 MCP Client（JSON-RPC over stdio）接入 GitHub，命名空间隔离 + 三层降级 | `(待填)` |

> 核心理解：模型本身无状态，只负责"决定调用哪个工具"；记忆 = 每次重发完整历史，执行 = 你代码里的 `execute`，循环 = 你写的 `while`。

## 项目结构

```
src/
  index.ts            # CLI 对话主程序
  model.ts            # 统一创建模型（真实 Qwen / 本地 mock）
  mock-model.ts       # 本地模拟模型，无 Key 也能跑
  agent-loop.ts       # Agent 主循环（三层防护）
  loop-detection.ts   # 循环检测（重复调用 / 参数震荡）
  retry.ts            # 重试策略与退避延迟
  compare-loops.ts    # 自动 vs 手动循环对比 demo
  tools/
    index.ts              # 汇总导出 + allTools 注册
    registry.ts           # ToolRegistry + 读写锁 + 结果截断 + MCP Server 注册
    mcp-client.ts         # MCP Client（JSON-RPC over stdio）+ Mock 降级
    utility-tools.ts      # weather / calculator / fetch_url / start_preview
    file-tools.ts         # read_file / write_file / edit_file / glob / grep / list_directory
    bash-tools.ts         # bash 命令执行
    *.test.ts             # Vitest 单元测试
app/                  # 第 7 章旗舰 demo：浏览器直跑 TSX（start_preview 默认服务）
demos/                # 另外两个网页 demo 样例（vibe-todo / landing）
```
