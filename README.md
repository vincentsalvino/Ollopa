# Ollopa

Desktop-native agentic AI system. Tauri v2 (Rust backend) + React 18 / TypeScript frontend. Autonomous multi-step task completion with Plan → Execute → Reflect → Verify loop. Connects to DeepSeek and MiMo APIs.

## Current State

**Stack**: Tauri v2 (Rust) / React 18 / TypeScript / Vite  
**Default Models**: DeepSeek v4 Pro (code), DeepSeek v4 Flash (planning), MiMo v2.5 Pro  
**Codebase**: 20 Rust modules, 26 React components, 150+ Tauri commands

---

## Ollopa v2 — Changelog

All 3 phases of the Ollopa v2 architecture plan have been implemented.

### Phase 1: Fix the Foundation

| Change | Details |
|--------|---------|
| `reasoning_content` support | DeepSeek/MiMo thinking mode — streaming + collapsible display |
| Provider overhaul | DeepSeek v4 (flash/pro) + MiMo (v2.5-pro/v2.5/v2-flash) as built-in providers. Removed Claude, OpenAI, NousResearch defaults |
| Pricing update | Real DeepSeek v4 / MiMo per-token rates |
| `MIMO_API_KEY` | Dual header format (`api-key` + `Authorization: Bearer`) |
| Thinking mode toggle | `set_thinking_mode` command, collapsible "Thinking..." in timeline |
| Removed `claude_memory.rs` | 74 lines of legacy Claude Code dependency deleted |

### Phase 2: Agent Loop + Write Tools

| Change | Details |
|--------|---------|
| `agent_loop.rs` | State machine: Idle → Planning → Executing → Reflecting → Verifying → Done/Failed/Paused. Max 25 iterations, pause/resume/interrupt |
| 6 write tools | `write_file`, `edit_file`, `shell_execute`, `web_fetch`, `git_command`, `save_memory` |
| Approval wiring | shell_execute = High risk, write/edit/git = Medium, web_fetch/save_memory = Safe |
| 8 new events | AgentPlanCreated, AgentStepStarted, AgentReflection, ShellOutput, FileEdited, AgentLoopStarted/Finished, ReasoningChunk |
| `AgentExecutionPanel.tsx` | Task input, iteration config, live plan visualization with step progress |
| Timeline extensions | Rendering for reasoning, shell output, file diffs, agent plan/step/reflection |
| Removed `multi_agent.rs` | 1,141 lines of scaffolded code replaced by real state machine |
| `prompt_template.rs` | Refactored from `prompt_transformer.rs`, preserving all transform functions |

### Phase 3: Smart Context + Learning

| Change | Details |
|--------|---------|
| Repo map generation | Compact `path → [exported symbols]` format, 5-min cache TTL, auto-invalidation on file changes |
| Task-based file selection | Keyword scoring against paths + symbols, selects 5-15 most relevant files within token budget |
| Skill acquisition | `Skill` struct: task_pattern, tool_sequence, files_involved, success_count. Auto-saved after agent loop, searched via Jaccard similarity on new tasks |
| Multi-model routing | Flash model for planning/reflection (cheap), Pro model for code generation (quality), auto-switches during loop |
| Cost estimation | Live cost estimate shown before running agent loop |
| Step progress bar | Visual progress during agent loop execution |
| MiMo web search | New `MiMoSearch` provider using MiMo chat API with `web_search` tool |
| 6 new commands | `generate_repo_map`, `repo_map_text`, `select_files_for_task`, `search_skills`, `list_skills`, `estimate_agent_cost` |

### Net Impact

- **Added**: ~2,400 lines of implementation
- **Removed**: ~1,700 lines of scaffolded/legacy code
- **Build**: `cargo check` and `npx tsc --noEmit` pass with 0 errors

---

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Ollopa Desktop App                     │
│                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐ │
│  │   React UI   │  │  Agent Panel  │  │ Timeline/Chat │ │
│  │  (settings,  │  │  (plan, steps │  │  (messages,   │ │
│  │   panels)    │  │   progress)   │  │   tool output)│ │
│  └──────┬───────┘  └──────┬────────┘  └──────┬────────┘ │
│         │                 │                   │          │
│  ───────┴─────────────────┴───────────────────┴──────    │
│                  Tauri Event System                       │
│  ────────────────────────┬───────────────────────────    │
│                          │                               │
│  ┌───────────────────────┴─────────────────────────┐    │
│  │              Agent Loop                          │    │
│  │  Plan → Select Tool → Execute → Observe → Reflect│    │
│  │  (max_iterations, pause/resume, error recovery)  │    │
│  └──────────┬──────────────────────┬───────────────┘    │
│             │                      │                     │
│  ┌──────────┴────────┐  ┌─────────┴───────────────┐    │
│  │   API Client      │  │   Tool Executor          │    │
│  │  (SSE streaming,  │  │  read/write/edit/shell/  │    │
│  │   reasoning mode, │  │  search/git/web/memory   │    │
│  │   thinking toggle)│  │  + approval system       │    │
│  └────────┬──────────┘  └─────────┬───────────────┘    │
│           │                       │                      │
│  ┌────────┴──────────┐  ┌────────┴────────────────┐    │
│  │ Provider Router   │  │  Context Assembly        │    │
│  │ (DeepSeek, MiMo,  │  │  (repo map, file select, │    │
│  │  flash→plan,      │  │   token budget, skills)  │    │
│  │  pro→code)        │  │                          │    │
│  └───────────────────┘  └──────────────────────────┘    │
│                                                          │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────────┐ │
│  │ Session Mgr  │  │ Second     │  │ Repo Intel +    │ │
│  │ (persist,    │  │ Brain      │  │ Codebase Index  │ │
│  │  recover,    │  │ (memory,   │  │ (lang detect,   │ │
│  │  export)     │  │  skills)   │  │  symbols, map)  │ │
│  └──────────────┘  └────────────┘  └─────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Component Summary

| Layer | Module | Purpose |
|-------|--------|---------|
| **Frontend** | `App.tsx` | Main app shell, settings, panels, toasts |
| | `AgentExecutionPanel.tsx` | Agent loop UI — task input, model selection, cost estimate, plan visualization, progress bar |
| | `TimelineEntry.tsx` | Renders all timeline entry types: messages, tool output, reasoning, shell output, file diffs, agent plan/steps/reflections |
| | `useEventStore.ts` | Event-driven state reducer — processes 15+ event types from Rust backend |
| **Agent Loop** | `agent_loop.rs` | State machine orchestrating Plan → Execute → Reflect → Verify cycles |
| **Tools** | `api_tools.rs` | 12 builtin tools: read_file, list_directory, search_code, file_info, read_url, task_complete + write_file, edit_file, shell_execute, web_fetch, git_command, save_memory |
| **Context** | `codebase_indexer.rs` | File tree walker, symbol extraction, repo map generation, task-based file selection |
| | `token_optimizer.rs` | Token budget tracking, context compaction, cost estimation |
| **Learning** | `second_brain.rs` | Semantic memory, decisions, summaries, skill acquisition + search |
| **API** | `api_client.rs` | DirectApiClient, SSE streaming, reasoning_content, tool call handling |
| | `provider_router.rs` | Multi-provider routing (DeepSeek/MiMo), strategy-based selection |
| **Approval** | `approval_manager.rs` | Risk classification (Safe/Low/Medium/High/Critical), tiered approval |
| **Events** | `ollopa_events.rs` | 15+ event types bridging Rust backend to React frontend |
| **Persistence** | `session_manager.rs` | Session snapshots, export (PDF/MD/clipboard), search, import |
| **Search** | `web_search.rs` | DuckDuckGo, Tavily, SearXNG, MiMo web search providers |

### Data Flow

```
User types task
    → AgentExecutionPanel invokes agent_run_loop
    → AgentLoop::run() starts
        → Generates repo map (codebase_indexer)
        → Selects relevant files (token budget)
        → Searches matching skills (second_brain)
        → Switches to flash model for planning
        → LLM creates numbered plan
        → Emits AgentPlanCreated event
        → For each step:
            → Switches to pro model for code gen
            → LLM executes using tools (write_file, shell_execute, etc.)
            → Approval check (auto for Safe/Medium, user click for High)
            → Emits AgentStepStarted, ShellOutput, FileEdited events
            → Switches to flash model for reflection
            → LLM evaluates result
            → Emits AgentReflection event
        → Verify phase: LLM summarizes
        → Save skill to Second Brain
        → Invalidate repo map cache
        → Emits AgentLoopFinished event
    → Frontend updates timeline + plan display in real-time
```

---

## Features

| Feature | Status |
|---------|--------|
| Direct API streaming (SSE) | Done |
| Session snapshot persistence | Done |
| Token optimizer with budget tracking | Done |
| API Tool Calling — 12 builtin tools | Done |
| Prompt Template Picker | Done |
| Export — PDF, clipboard, MD+frontmatter | Done |
| Background Codebase Indexer | Done |
| Global Keyboard Shortcuts | Done |
| System Tray — minimize to tray | Done |
| Conversation Search with highlights | Done |
| Error Recovery | Done |
| Second Brain (decisions, summaries, embeddings) | Done |
| Visual Intelligence (graphs, architecture) | Done |
| Multi-Provider routing (DeepSeek/MiMo) | Done |
| Workspace Intelligence (drift, patterns, impact) | Done |
| Predictive Workflows | Done |
| Web Search (DuckDuckGo/Tavily/SearXNG/MiMo) | Done |
| Reasoning/Thinking mode display | Done |
| Agent Loop (Plan→Execute→Reflect→Verify) | Done |
| Write Tools (file/shell/git/web/memory) | Done |
| Approval System (risk-tiered) | Done |
| Repo Map + Smart File Selection | Done |
| Skill Acquisition + Reuse | Done |
| Multi-Model Routing (flash→plan, pro→code) | Done |
| Cost Estimation | Done |

---

## Getting Started

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEEPSEEK_API_KEY` | Yes (or MIMO) | DeepSeek v4 API key |
| `MIMO_API_KEY` | Optional | MiMo API key (enables MiMo models + web search) |
| `TAVILY_API_KEY` | Optional | Tavily search API key |

### Docs

Additional documentation is in the `docs/` folder.
