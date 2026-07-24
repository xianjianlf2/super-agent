# super-agent

[中文](README.md)

A step-by-step learning project for building a **tool-using AI agent**. Built with [Vercel AI SDK](https://sdk.vercel.dev/) v6 + Qwen (Tongyi Qianwen).

Each chapter corresponds to one commit. Read them in order to see how the agent is built from scratch. To jump to any chapter: `git checkout <commit>`.

## Quick Start

```bash
pnpm install
echo "DASHSCOPE_API_KEY=sk-xxx" > .env   # omit to use the local mock model

pnpm start      # start the chat
pnpm continue   # resume the chat history in .sessions/default.jsonl
pnpm start -- --debug-prompt  # show Prompt Pipe ON/OFF state and character counts
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
| Ch 8 | MCP integration | Hand-written MCP Client (JSON-RPC over stdio) wiring up GitHub; namespace isolation + three-tier fallback | `66dff00` |
| Ch 9 | ToolSearch & deferred loading | `tool_search` meta-tool activates MCP tool schemas on demand; initial prompt saves 73% tokens | `0812f90` |
| Ch 10 | Session + Prompt Pipe | Persist chat history as JSONL; modularize the system prompt with Prompt Pipe and debug output | `b379d20` |

> Key insight: the model is stateless — it only decides which tool to call. Memory = resending full history each turn. Execution = your `execute` function. Looping = your `while` loop.

## Prompt Pipe

The system prompt is assembled through a chained `PromptBuilder`:

```ts
const promptBuilder = createPromptBuilder<RuntimePromptContext>()
  .pipe('coreRules', identityPipe())
  .pipe('toolGuide', toolUsePipe())
  .pipe('deferredTools', toolSearchPipe())
  .pipe('answerStyle', answerStylePipe())
  .pipe('sessionContext', sessionContextPipe());
```

The convention is **static first, dynamic last**: stable rules stay at the front, while `sessionContext`, memory, and RAG-style context go near the end so the stable prefix remains cache-friendly.

`--debug-prompt` prints each Pipe's state and character count:

```text
=== Prompt Pipe Debug ===
  coreRules: [ON] 32 chars
  toolGuide: [ON] 22 chars
  deferredTools: [ON] 71 chars
  answerStyle: [ON] 8 chars
  sessionContext: [OFF]
========================
```

## Project Structure

```
src/
  index.ts            # CLI chat entry point
  line-reader.ts      # buffered input reader (piped multi-turn input keeps every line)
  model.ts            # creates the model (real Qwen or local mock)
  mock-model.ts       # local mock model, works without an API key
  prompt-builder.ts   # Prompt Pipe assembly, rendering, and debug output
  session-store.ts    # JSONL session persistence
  compare-loops.ts    # auto vs manual loop comparison demo
  agent/
    loop.ts               # agent main loop (three-layer guard)
    loop-detection.ts     # detects repeated calls and oscillating args
    retry.ts              # retry strategy with exponential backoff
  tools/
    index.ts              # barrel export + allTools registration
    registry.ts           # ToolRegistry + reader-writer lock + truncation + MCP server registration
    mcp-client.ts         # MCP Client (JSON-RPC over stdio) + Mock fallback
    search-tools.ts       # tool_search meta-tool: search & activate deferred tools
    utility-tools.ts      # weather / calculator / fetch_url / start_preview
    file-tools.ts         # read_file / write_file / edit_file / glob / grep / list_directory
    shell-tools.ts        # bash command execution
    *.test.ts             # Vitest unit tests
app/                  # Ch 7 flagship demo: run TSX in the browser (served by start_preview)
demos/                # two more web demo samples (vibe-todo / landing)
```
