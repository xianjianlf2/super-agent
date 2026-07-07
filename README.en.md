# super-agent

[中文](README.md)

A step-by-step learning project for building a **tool-using AI agent**. Built with [Vercel AI SDK](https://sdk.vercel.dev/) v6 + Qwen (Tongyi Qianwen).

Each chapter corresponds to one commit. Read them in order to see how the agent is built from scratch. To jump to any chapter: `git checkout <commit>`.

## Quick Start

```bash
pnpm install
echo "DASHSCOPE_API_KEY=sk-xxx" > .env   # omit to use the local mock model

pnpm start      # start the chat
pnpm compare    # auto-loop vs manual-loop demo
pnpm test       # run unit tests
```

## Chapters

| Chapter | Topic | Summary | Commit |
|---|---|---|---|
| Ch 1 | Scaffolding | `streamText` streaming output + local mock model | `b6bfd22` |
| Ch 2 | Multi-turn chat | `messages` array keeps context across turns | `aaff190` |
| Ch 3 | Tool calling | Define tools with `tool()`, run multi-step loops with `stopWhen` | `37042a1` |
| Ch 4 | Auto vs manual loop | `stopWhen` auto-loop ≈ a hand-written `while` loop | `f3c45c6` |
| Ch 5 | Three-layer guard | Loop detection + API retry + token budget circuit breaker | `e2d6201` |
| Ch 6 | Tool system | ToolRegistry + result truncation + reader-writer lock | `25fd247` |
| Ch 7 | Three real demos | `fetch_url` + `start_preview`; assemble code-analysis / Research / Vibe Coding from existing tools | `a3408ca` |
| Ch 8 | MCP integration | Hand-written MCP Client (JSON-RPC over stdio) wiring up GitHub; namespace isolation + three-tier fallback | `(TBD)` |

> Key insight: the model is stateless — it only decides which tool to call. Memory = resending full history each turn. Execution = your `execute` function. Looping = your `while` loop.

## Project Structure

```
src/
  index.ts            # CLI chat entry point
  model.ts            # creates the model (real Qwen or local mock)
  mock-model.ts       # local mock model, works without an API key
  agent-loop.ts       # agent main loop (three-layer guard)
  loop-detection.ts   # detects repeated calls and oscillating args
  retry.ts            # retry strategy with exponential backoff
  compare-loops.ts    # auto vs manual loop comparison demo
  tools/
    index.ts              # barrel export + allTools registration
    registry.ts           # ToolRegistry + reader-writer lock + truncation + MCP server registration
    mcp-client.ts         # MCP Client (JSON-RPC over stdio) + Mock fallback
    utility-tools.ts      # weather / calculator / fetch_url / start_preview
    file-tools.ts         # read_file / write_file / edit_file / glob / grep / list_directory
    bash-tools.ts         # bash command execution
    *.test.ts             # Vitest unit tests
app/                  # Ch 7 flagship demo: run TSX in the browser (served by start_preview)
demos/                # two more web demo samples (vibe-todo / landing)
```
