# super-agent

A branch-by-branch learning project for building a tool-using AI agent with the Vercel AI SDK and Qwen.

The `master` branch is only the index. Each chapter lives on its own branch with the code, tests, and chapter notes for that step.

## How To Read

```bash
git fetch --all
git switch <chapter-branch>
pnpm install
pnpm test
```

To compare one chapter with the previous one:

```bash
git diff <previous-branch>..<chapter-branch>
```

## Chapter Index

| Chapter | Branch | Notes | Focus |
|---|---|---|---|
| 1 | commit `b6bfd22` | README history | Project scaffold, streaming output, local mock model |
| 2 | commit `aaff190` | README history | Multi-turn chat with `messages` |
| 3 | commit `37042a1` | README history | Tool calling with AI SDK tools |
| 4 | commit `f3c45c6` | README history | Auto loop vs manual loop |
| 5 | commit `e2d6201` | README history | Loop detection, API retry, token budget guard |
| 6 | commit `25fd247` | README history | `ToolRegistry`, result truncation, reader-writer lock |
| 7 | commit `a3408ca` | README history | Practical demos with `fetch_url` and `start_preview` |
| 8 | commit `66dff00` | README history | Hand-written MCP client and GitHub tool integration |
| 9 | commit `0812f90` | README history | `tool_search` and deferred MCP tool loading |
| 10 | commit `b379d20` | README history | JSONL session persistence and Prompt Pipe |
| 11 | `markxian/ch11-microcompact` | `chapters/ch11-microcompact.md` | Microcompact for old tool results |
| 12 | `markxian/ch12-summary-compact` | `chapters/ch12-summary-compact.md` | LLM summary compaction |
| 13 | `markxian/ch13-compaction-runtime` | `chapters/ch13-compaction-runtime.md` | Runtime integration, failure guard, quiet logs |
| 14 | `markxian/ch14-compaction-demo` | `chapters/ch14-compaction-demo.md` | Reproducible compaction demo |

## Current Chapter Branch Chain

```text
master
  -> markxian/ch11-microcompact
      -> markxian/ch12-summary-compact
          -> markxian/ch13-compaction-runtime
              -> markxian/ch14-compaction-demo
```

## Useful Commands

```bash
pnpm start
pnpm continue
pnpm start -- --debug-prompt
pnpm test
```

For the compaction demo chapter:

```bash
git switch markxian/ch14-compaction-demo
pnpm exec tsx src/index.ts --demo-compaction --debug-compaction
```

## Project Idea

The core model is stateless. Memory comes from resending conversation history, execution comes from local tool `execute` functions, and agent behavior comes from the loop that coordinates model calls, tools, retries, and context management.
