# AI Workspace Refactor — Progress Tracker

## Architecture

```
Claude CLI (stream-json) → claude_process.rs → AppEvent → Tauri emit → useEventStore → Timeline UI
```

---

## Phase 1 — Stream-JSON Backend Foundation

**Status: COMPLETE**

### Goals
- Completely remove PTY architecture
- Implement structured stream-json parsing
- Build internal event system

### What Was Built

#### Removed
- `pty.rs` — entire PTY architecture (422 lines)
- `portable-pty` crate dependency
- ANSI parsing and terminal synchronization
- `PinnedPrompts.tsx` (unused)

#### Added (5 Rust modules)
- **`claude_events.rs`** — `ClaudeStreamEvent` enum (system/assistant/user/result) + `AppEvent` enum (10 structured event types)
- **`claude_process.rs`** — Spawns `claude --output-format stream-json`, async stdout/stderr streaming, transforms stream events → AppEvents, emits via Tauri
- **`event_bus.rs`** — Broadcast channel with bounded history for session recovery
- **`session_manager.rs`** — Session lifecycle, persistence snapshots, crash recovery
- **`approval_manager.rs`** — Tool risk classification (Safe→Critical), dangerous pattern regex matching

#### Updated
- `lib.rs` — All commands rewired to SessionManager
- `memory.rs` — Project tree reading, full memory editor
- `App.tsx` — Consumes `app-event` instead of `pty-output`
- `Cargo.toml` — Removed portable-pty, added tokio

### Success Criteria
- [x] Claude streams correctly WITHOUT PTY
- [x] Frontend receives structured events

### Build Status
- `cargo check` — 0 errors, 0 warnings
- `npx tsc --noEmit` — 0 errors
- `npx vite build` — clean

---

## Phase 2 — Event-Driven Frontend

**Status: COMPLETE**

### Goals
- Replace terminal rendering with structured rendering
- Centralize event store with streaming reducers

### What Was Built

#### New Files (11)
- **`src/types.ts`** — Central types: AppEvent (10 types), TimelineEntry (9 kinds), EventStoreState, SlashCommand
- **`src/hooks/useEventStore.ts`** — Redux-like reducer managing all frontend state from backend events
- **`src/components/timeline/TimelineView.tsx`** — Main scrollable timeline replacing ChatPane
- **`src/components/timeline/TimelineEntry.tsx`** — Polymorphic entry renderer (9 kinds)
- **`src/components/timeline/MessageBubble.tsx`** — Markdown renderer (code blocks, inline code, bold)
- **`src/components/tools/ToolCard.tsx`** — Expandable tool card with status, duration, summary
- **`src/components/approvals/ApprovalModal.tsx`** — Risk-classified approval dialog
- **`src/components/approvals/FileDiffModal.tsx`** — Line-by-line diff viewer
- **`src/components/sessions/SessionSidebar.tsx`** — Session history browser
- **`src/components/Toast.tsx`** — Auto-dismiss notification system
- **`src/components/InputBar.tsx`** — Slash command autocomplete input

#### Rewritten
- **`src/App.tsx`** — Uses useEventStore reducer, wires all Phase 2 components
- **`src/components/Dashboard.tsx`** — Execution metrics grid, tool analytics, memory editor

#### Removed
- `ChatPane.tsx` — Replaced by TimelineView + InputBar

### Success Criteria
- [x] UI no longer depends on terminal rendering
- [x] Centralized event store manages all state
- [x] Structured rendering for all event types

### Build Status
- `cargo check` — 0 errors, 0 warnings
- `npx tsc --noEmit` — 0 errors
- `npx vite build` — 51 modules, clean

---

## Phase 3 — Tool Visualization + Diff Workflow

**Status: COMPLETE**

### Goals
- Visualize Claude actions cleanly
- Build diff approval system
- Build structured tool interface

### What Was Built

#### FileDiffModal v2
- Syntax highlighting (20+ languages: TS, Rust, Python, Go, Java, etc.)
- Unified/split view toggle
- Old + new line numbers in table layout
- Revert button
- Language badge auto-detection

#### ToolCard v2
- Category badges (file/command/search/fs)
- Tabbed body (Input / Output / Files tabs)
- Affected files list extracted from tool input
- Status badges (Running/Done/Error)
- Command preview bar (collapsed view for bash tools)

#### CommandPreview
- Risk classification (safe / caution / danger)
- Command syntax highlighting (binary, flags, paths, variables, operators)
- Dangerous pattern detection (rm -rf, sudo, curl|bash, etc.)
- Copy button

#### ToolDetailPanel
- Full-screen modal for tool inspection
- Complete input/output display
- Timing info (start, finish, duration)
- Copy output button

#### Timeline Improvements
- Vertical rail connectors between entries (visual flow)
- Empty state placeholder
- Approval cards with expandable input details
- Session cards with metadata (tool count, cwd, end stats)

### Success Criteria
- [x] Users can inspect and approve actions visually
- [x] Diff system with syntax highlighting and view modes
- [x] Tool execution visualized with full context

### Build Status
- `cargo check` — 0 errors, 0 warnings
- `npx tsc --noEmit` — 0 errors
- `npx vite build` — 52 modules, clean

---

## Phase 4 — Session Architecture

**Status: COMPLETE**

### Goals
- Improve reliability and persistence
- Session restoration, snapshots, replay, crash recovery

### What Was Built

#### Backend (session_manager.rs rewrite)
- **SessionSnapshot** — Full session state persistence (events, status, cost, duration)
- **PersistedEvent** — Lightweight event record for session replay
- **SessionStatus** — Active / Completed / Crashed / Recovered lifecycle
- **Heartbeat system** — 30-second interval updates; stale sessions (>60s) auto-marked as crashed
- **Crash recovery** — `mark_crashed_sessions()` runs on startup to detect orphaned sessions
- **Event recording** — `record_event()` appends events to snapshot for replay
- **Session restore** — `load_session_events()` and `get_session_snapshot()` for frontend replay
- **Enriched SessionMeta** — Status, project_path, created_at, updated_at, cost_usd

#### Backend Commands (lib.rs)
- `get_session_events` — Load events for replay
- `get_session_snapshot` — Get full snapshot data

#### Frontend (useEventStore.ts)
- **REPLAY_EVENTS action** — Replays array of AppEvents through reducer to rebuild full state
- Enables full session restoration from persisted snapshots

#### Frontend (SessionSidebar v2)
- Status filter tabs (All / Active / Completed / Crashed) with counts
- Project grouping — sessions grouped by project folder name
- State indicators — color-coded dots and left-border (green=active, blue=completed, red=crashed, yellow=recovered)
- Click-to-restore — loads session events and replays them in the event store
- Enriched metadata — time ago, cost, message count, status label
- Loading state and empty states per filter

#### Frontend Types
- `SessionMeta` — Extended with status, project_path, created_at, updated_at, cost_usd
- `PersistedEvent` — Event replay record
- `SessionSnapshot` — Full snapshot interface

### Success Criteria
- [x] Sessions persist with full event history
- [x] Sessions survive crashes (heartbeat + auto-mark crashed)
- [x] Sessions can be restored/replayed from sidebar
- [x] Session sidebar shows state indicators and project grouping

### Build Status
- `cargo check` — 0 errors (2 warnings: unused functions)
- `npx tsc --noEmit` — 0 errors
- `npx vite build` — 52 modules, clean

---

## Phase 5 — Second-Brain Foundation

**Status: COMPLETE**

### Goals
- Build persistent workspace intelligence
- Memory summaries, semantic indexing, retrieval

### What Was Built

#### Backend (`second_brain.rs` — new module, ~450 lines)
- **SessionSummary** — Auto-summarizes sessions: title, summary text, key actions, files touched, tags, token count
- **Decision records** — Architectural Decision Records (ADR): title, context, decision, rationale, tags, status (Active/Superseded/Deprecated)
- **Semantic index** — Keyword-based BM25-inspired search with IDF scoring, recency boost, snippet extraction
- **Keyword extraction** — Tokenization + stopword removal (100+ stopwords)
- **Compressed context** — `get_compressed_context()` generates token-budgeted context for prompt injection (decisions first, then summaries, then compressed memory)
- **Auto-indexing** — Saving summaries/decisions automatically adds to semantic index
- **Note indexing** — Free-form notes can be indexed with tags
- **Brain stats** — Overview of total summaries, decisions, index entries, memory size, projects tracked

#### Backend Commands (9 new in lib.rs)
- `brain_search` — Keyword search across all indexed content
- `brain_stats` — Workspace intelligence overview
- `brain_save_decision` — Record architectural decision
- `brain_list_decisions` — List all decisions (filterable by project)
- `brain_delete_decision` — Delete a decision
- `brain_list_summaries` — List session summaries
- `brain_delete_summary` — Delete a summary
- `brain_get_context` — Get compressed context for prompt injection
- `brain_index_note` — Index a free-form note

#### Frontend (`BrainPanel.tsx` — new component, ~400 lines)
- **Overview tab** — 4-stat grid (summaries, decisions, index entries, memory size), projects tracked, recent tags, add note form
- **Search tab** — Full-text search bar with results showing type, score, snippet, metadata
- **Decisions tab** — Record new decisions (title/context/decision/rationale/tags form), list with status badges, delete
- **Summaries tab** — View session summaries with key actions, files touched, tags, token count, delete

#### Frontend Types (4 new interfaces)
- `SessionSummaryData`, `DecisionData`, `BrainSearchResult`, `BrainStats`

#### App Integration
- "Brain" button in toolbar opens BrainPanel
- BrainPanel receives projectPath for project-scoped queries

### Storage Structure
```
~/.claude/workspace-brain/
├── summaries/        # Session summary JSON files
├── decisions/        # Decision record JSON files
└── semantic-index.json  # Keyword index for search
```

### Success Criteria
- [x] Workspace persists summaries, decisions, and indexed notes
- [x] Semantic search retrieves relevant content with BM25 scoring
- [x] Compressed context generation for token-efficient prompt injection
- [x] Full CRUD UI for decisions and summaries

### Build Status
- `cargo check` — 0 errors (6 warnings: unused functions from earlier phases)
- `npx tsc --noEmit` — 0 errors
- `npx vite build` — 53 modules, clean

---

## Phase 6 — Visual Memory Systems

**Status: COMPLETE**

### Goals
- Visualize workspace intelligence
- Relationship graphs, architecture graphs, workflow DAGs, dependency visualization, session timelines

### What Was Built

#### Backend (`visual_memory.rs` — new module, ~500 lines)
- **GraphNode / GraphEdge / Graph** — Generic graph primitives with typed nodes, labeled edges, and metadata
- **TimelineEvent / SessionTimelineData** — Timeline event structures with status, duration, and drill-down detail
- **build_relationship_graph()** — Auto-generates a force-directed graph from session summaries and decisions, linking sessions → files → tags
- **build_architecture_graph()** — Extracts components from file paths, links decisions to components via tags
- **build_workflow_dag()** — Builds a directed acyclic graph from session key_actions, showing tool execution flow
- **build_dependency_graph()** — Computes file co-modification relationships across sessions, weighted by frequency
- **build_session_timeline()** — Reconstructs a timeline from persisted session snapshots with tool durations
- **Graph persistence** — Save/list/delete graph snapshots to `~/.claude/workspace-brain/visual/graphs/`
- **Visual stats** — Overview of total graphs, timelines, and graph type counts
- **VisualStats** — Summary struct for dashboard integration

#### Backend Commands (10 new in lib.rs)
- `visual_build_relationship_graph` — Generate relationship graph from brain data
- `visual_build_architecture_graph` — Generate architecture graph from decisions + files
- `visual_build_workflow_dag` — Generate workflow DAG from session actions
- `visual_build_dependency_graph` — Generate file co-dependency graph
- `visual_build_session_timeline` — Generate timeline from session snapshot
- `visual_save_graph` — Persist a graph snapshot
- `visual_list_graphs` — List saved graphs (filterable by project/type)
- `visual_delete_graph` — Delete a saved graph
- `visual_get_stats` — Get visual memory statistics
- `visual_list_sessions_for_timeline` — List sessions available for timeline view

#### Frontend (`src/components/graphs/` — 5 new files, ~800 lines)
- **`ForceGraph.tsx`** — Force-directed graph renderer using SVG with physics simulation (repulsion, attraction, center gravity, damping), interactive hover/click, node coloring by type, edge highlighting
- **`DAGView.tsx`** — Directed acyclic graph layout using BFS-based layer assignment, top-to-bottom flow with arrow markers, session/step node styling
- **`SessionTimelineView.tsx`** — Vertical timeline with dot-and-rail connector pattern, event icons, duration badges, expandable detail panels
- **`NodeDetail.tsx`** — Slide-in detail panel showing node metadata, type badge, and properties
- **`GraphPanel.tsx`** — Full-screen modal with 5-tab navigation (Relationships / Architecture / Workflow DAG / Dependencies / Timeline), auto-sizing via ResizeObserver, graph toolbar with refresh and save, session picker for timeline, legend, stats bar

#### Frontend Types (6 new interfaces in types.ts)
- `GraphNode`, `GraphEdge`, `GraphData`, `TimelineEvent`, `SessionTimelineData`, `VisualStats`

#### App Integration
- "Graphs" button in toolbar opens GraphPanel
- GraphPanel receives projectPath for project-scoped visualizations
- All graph types auto-generated from existing brain data (no manual entry needed)

### Storage Structure
```
~/.claude/workspace-brain/visual/
├── graphs/        # Saved graph snapshots
└── timelines/     # Timeline data
```

### Design Decisions
- **Pure SVG rendering** — No external graph library (keeps bundle lightweight per architecture spec)
- **Physics simulation** — Custom force-directed layout with 120-iteration convergence
- **Auto-generation** — Graphs computed from existing brain data rather than requiring manual creation
- **Five visualization types** — Covering relationships, architecture, workflows, dependencies, and session timelines

### Success Criteria
- [x] Relationship graphs show connections between sessions, files, tags, and decisions
- [x] Architecture graphs extract components from file structure and link to decisions
- [x] Workflow DAGs show tool execution flow from session key actions
- [x] Dependency visualization shows file co-modification patterns
- [x] Session timelines provide drill-down view of individual session events
- [x] Users can visually navigate project intelligence

### Build Status
- `cargo check` — 0 errors (9 warnings: unused functions from earlier phases + visual_memory helpers)
- `npx tsc --noEmit` — 0 errors
- `npx vite build` — 58 modules, clean

---

## Phase 7 — Token Optimization

**Status: COMPLETE**

### Goals
- Minimize DeepSeek costs
- Retrieval optimization, rolling summaries, token budgeting, semantic chunking, prompt caching

### What Was Built

#### Backend (`token_optimizer.rs` — new module, ~650 lines)
- **TokenBudget** — Configurable budget with monthly USD limit, max context/summary/decision/memory tokens, rolling window, cache TTL
- **Rolling Summaries** — Auto-compress older session summaries into weekly digests (merges titles, deduplicates files/tags, caps actions)
- **Semantic Chunking** — Break large text into paragraph/sentence-boundary chunks within token limits
- **Prompt Cache** — TTL-based cache for pre-built context strings (avoids recomputing same context within configurable window)
- **Token Usage Tracking** — Daily usage records with input/output token counts and cost calculation
- **Budget Management** — Load/save configurable budgets, track monthly spend, project costs
- **Optimized Context Builder** — Priority-ordered context generation: decisions → rolling summaries → recent summaries → search results → memory, each with dedicated token budget
- **Optimization Pass** — Single-command optimization: roll up old summaries, chunk large ones, prune expired cache, compute savings

#### Backend Commands (10 new in lib.rs)
- `optimizer_get_stats` — Comprehensive optimization statistics (budget, usage, cache, savings)
- `optimizer_get_budget` — Load current token budget configuration
- `optimizer_save_budget` — Persist budget changes
- `optimizer_run` — Execute full optimization pass
- `optimizer_build_context` — Build optimized prompt context with caching
- `optimizer_record_usage` — Record token usage for budget tracking
- `optimizer_prune_cache` — Remove expired cache entries
- `optimizer_list_rolling` — List all rolling summaries
- `optimizer_clear_data` — Clear all optimization data
- `optimizer_estimate_tokens` — Estimate token count for arbitrary text

#### Frontend (`src/components/optimizer/TokenPanel.tsx` — ~430 lines)
- **Overview Tab** — Budget meter with color-coded progress bar, stats grid (daily avg, projected monthly, input/output tokens, savings %, rolling count), one-click optimization
- **Budget Tab** — Full budget configuration form: monthly USD limit, max context tokens, per-category token limits (summary/decision/memory), rolling window days, cache TTL minutes
- **Cache Tab** — Cache statistics (total/active entries, hits, token savings, hit rate), prune button
- **Rolling Summaries Tab** — Browsable list of compressed weekly digests with period dates, session count, content preview, theme tags
- **Context Preview Tab** — Live preview of what gets injected into prompts, with optional query input, showing token/char counts

#### Frontend Types (7 new interfaces in types.ts)
- `TokenBudget`, `MonthUsage`, `CacheStats`, `OptimizationStats`, `OptimizationResult`, `RollingSummary`

#### App Integration
- "Tokens" button in toolbar opens TokenPanel
- Budget remaining shown as badge in panel header

### Storage Structure
```
~/.claude/workspace-brain/optimizer/
├── budget.json        # Token budget configuration
├── rolling/           # Rolling summary snapshots
├── cache/             # Prompt context cache (TTL-based)
├── chunks/            # Semantic chunks
└── usage/             # Daily token usage records
```

### Design Decisions
- **Priority-ordered context** — Decisions (highest value) → rolling summaries (cheap) → recent summaries → search → memory (lowest priority)
- **Rolling summaries** — Weekly compression of old sessions reduces token cost for historical context
- **Prompt caching** — Avoids recomputing identical context within TTL window (default 15 min)
- **Configurable budgets** — Users set monthly USD limit and per-category token allocations
- **Approximate token estimation** — Uses 3.5 chars/token heuristic (fast, no external dependency)

### Success Criteria
- [x] Rolling summaries compress old sessions into weekly digests
- [x] Token budgeting with configurable monthly USD limit
- [x] Semantic chunking breaks large text at paragraph/sentence boundaries
- [x] Prompt caching avoids redundant context computation
- [x] Optimized context builder respects per-category token budgets
- [x] Daily usage tracking with cost projections
- [x] System remains affordable under low monthly budgets

### Build Status
- `cargo check` — 0 errors (9 warnings: unused functions from earlier phases)
- `npx tsc --noEmit` — 0 errors
- `npx vite build` — 59 modules, clean

---

## Phase 8 — Future Enhancements

**Status: COMPLETE**

### Goals
- Lightweight multi-agent workflows
- Provider routing with cost/quality/failover strategies
- Agent registry, task routing, workflow orchestration

### What Was Built

#### Multi-Agent System (`multi_agent.rs` — ~480 lines)
- **Agent Registry** — 5 built-in agents (Coder, Reviewer, Architect, Tester, Documenter) + custom agent support
- **Capability-Based Routing** — Route tasks to best-fit agent by capabilities and keyword matching
- **Workflow Orchestration** — DAG-based workflows with dependency tracking, step advancement, status propagation
- **Task Management** — Create, list, complete tasks with priority levels (Low/Normal/High/Critical)
- **Workflow Templates** — "Code Review" (3 steps) and "Feature Dev" (5 steps)

#### Provider Router (`provider_router.rs` — ~550 lines)
- **Provider Registry** — 3 built-in providers (DeepSeek, Claude, OpenAI) with model configs
- **Routing Strategies** — CostOptimized, QualityFirst, Failover, LatencyFirst, RoundRobin, Manual
- **Health Tracking** — Provider health status, latency averaging, error rate tracking
- **Routing Decisions** — Auditable decision records with reason, estimated cost, fallback tracking

#### Backend Commands (19 new in lib.rs)
- Multi-Agent: `agent_list`, `agent_save`, `agent_delete`, `agent_stats`, `agent_route_task`, `agent_create_task`, `agent_list_tasks`, `agent_complete_task`, `agent_create_workflow`, `agent_list_workflows`, `agent_advance_workflow`, `agent_delete_workflow`
- Provider Router: `router_list_providers`, `router_save_provider`, `router_delete_provider`, `router_get_config`, `router_save_config`, `router_route`, `router_stats`

#### Frontend (`AgentPanel.tsx` — ~530 lines, 5-tab UI)
- **Agents Tab** — Agent card grid with capabilities and token limits
- **Workflows Tab** — Create from templates, view step pipeline with status
- **Tasks Tab** — Task list with agent assignment, priority, status
- **Providers Tab** — Provider cards with model pricing, toggle enable/disable
- **Router Tab** — Strategy config, live route testing, stats + provider health

### Build Status
- `cargo check` — 0 errors
- `npx tsc --noEmit` — 0 errors
- `npx vite build` — 60 modules, clean

---

## File Inventory

### Backend (src-tauri/src/)
| File | Phase | Purpose |
|------|-------|---------|
| `claude_events.rs` | 1 | Stream-JSON parsing + AppEvent enum |
| `claude_process.rs` | 1 | Process spawning + async streaming |
| `event_bus.rs` | 1 | Broadcast channel + event history |
| `session_manager.rs` | 1+4 | Session lifecycle + snapshots + replay + heartbeat |
| `approval_manager.rs` | 1 | Tool risk classification |
| `memory.rs` | 1 | Memory read/write/tree |
| `second_brain.rs` | 5 | Summaries, decisions, semantic index, retrieval |
| `visual_memory.rs` | 6 | Graph data models, auto-generation, persistence |
| `token_optimizer.rs` | 7 | Token budgeting, rolling summaries, caching, chunking |
| `multi_agent.rs` | 8 | Agent registry, task routing, workflow orchestration |
| `provider_router.rs` | 8 | Provider registry, model routing, failover strategies |
| `lib.rs` | 1-8 | Tauri commands + app entry |

### Frontend (src/)
| File | Phase | Purpose |
|------|-------|---------|
| `types.ts` | 2+4+5+6+7+8 | Shared types, events, timeline, session, brain, graphs, optimizer, agents, router |
| `hooks/useEventStore.ts` | 2+4 | Centralized reducer state + replay |
| `App.tsx` | 2-8 | Main app wiring |
| `components/timeline/TimelineView.tsx` | 2-3 | Scrollable timeline |
| `components/timeline/TimelineEntry.tsx` | 2-3 | Polymorphic entry renderer |
| `components/timeline/MessageBubble.tsx` | 2 | Markdown renderer |
| `components/tools/ToolCard.tsx` | 2-3 | Tool execution card |
| `components/tools/ToolDetailPanel.tsx` | 3 | Full tool inspection modal |
| `components/approvals/ApprovalModal.tsx` | 2 | Approval dialog |
| `components/approvals/FileDiffModal.tsx` | 2-3 | Diff viewer + syntax highlighting |
| `components/sessions/SessionSidebar.tsx` | 2+4 | Session history + restore |
| `components/memory/BrainPanel.tsx` | 5 | Second Brain UI (search, decisions, summaries) |
| `components/graphs/GraphPanel.tsx` | 6 | Visual Memory panel (5-tab graph navigation) |
| `components/graphs/ForceGraph.tsx` | 6 | Force-directed graph SVG renderer |
| `components/graphs/DAGView.tsx` | 6 | Directed acyclic graph layout renderer |
| `components/graphs/SessionTimelineView.tsx` | 6 | Session event timeline with drill-down |
| `components/graphs/NodeDetail.tsx` | 6 | Node metadata detail panel |
| `components/optimizer/TokenPanel.tsx` | 7 | Token optimizer UI (budget, cache, rolling, context preview) |
| `components/agents/AgentPanel.tsx` | 8 | Multi-agent workflows + provider routing UI |
| `components/Dashboard.tsx` | 2 | Metrics + analytics |
| `components/Toast.tsx` | 2 | Notifications |
| `components/InputBar.tsx` | 2 | Slash command input |
| `index.css` | 2-8 | All CSS (~4900 lines) |
