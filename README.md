# Ollopa

Tauri v2 desktop AI chat app. Rust backend + React/TypeScript frontend. Connects to any OpenAI-compatible API (currently DeepSeek).

## Current State

**Stack**: Tauri v2 (Rust) / React 18 / TypeScript / Vite
**Default Model**: deepseek-v4-pro via DeepSeek API
**Codebase**: 19 Rust modules, 25 React components, 136+ Tauri commands

### Completed Features

| Feature | Status |
|---------|--------|
| Direct API streaming (SSE) | Done |
| Session snapshot persistence | Done |
| Shared memory layer (Claude Code files) | Done |
| Token optimizer with budget tracking | Done |
| Smart Context Assembly (P1) | Done |
| Budget Alerts — 50/80/95% thresholds (P2) | Done |
| Auto-Compaction (P3) | Done |
| API Tool Calling — 6 builtin tools (P4) | Done |
| Prompt Template Picker (P5) | Done |
| Export — PDF, clipboard, MD+frontmatter (P6) | Done |
| Claude Code Session Import (P7) | Done |
| Background Codebase Indexer (P8) | Done |
| Global Keyboard Shortcuts (P9) | Done |
| System Tray — minimize to tray (P10) | Done |
| Conversation Search with highlights (P11) | Done |
| Error Recovery Consistency (P12) | Done |
| Token counter fix (BUG1) | Done |
| Model display fix (BUG2) | Done |
| Second Brain (decisions, summaries, embeddings) | Done |
| Visual Intelligence (graphs, architecture) | Done |
| Multi-Agent delegation system | Done |
| Multi-Provider routing | Done |
| Workspace Intelligence (drift, patterns, impact) | Done |
| Predictive Workflows | Done |
| Web Search integration | Done |
| Prompt Transformer pipeline | Done |

### Architecture

```
src-tauri/src/
  api_client.rs      — DirectApiClient, SSE streaming, tool call handling
  api_tools.rs       — 6 builtin tool definitions + execution
  token_optimizer.rs — Budget, compaction, context assembly
  session_manager.rs — Snapshots, export, import, search
  codebase_indexer.rs— File tree walker, symbol extraction
  lib.rs             — 136+ Tauri commands, app setup, tray, shortcuts
  memory.rs          — Shared memory read/write
  second_brain.rs    — Decisions, summaries, semantic search
  visual_*.rs        — Graph builders
  agent_*.rs         — Multi-agent orchestration
  router_*.rs        — Multi-provider routing
  ...

src/
  App.tsx            — Main app, 1400+ lines
  hooks/useEventStore.ts — Event-driven state reducer
  components/        — 25 React components
```

### Docs

Additional documentation is in the `docs/` folder.
