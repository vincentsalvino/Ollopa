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

## Phase 9 — Competitive Feature Parity

**Status: COMPLETE**

### Goals
- Close critical UX gaps vs ChatGPT Desktop, Ollopa, Cursor, etc.
- Streaming display, markdown rendering, message actions, file upload, search, model selector, keyboard shortcuts

### What Was Built

#### Critical (Red) — Users Expect These
- **Streaming display** — Tokens appear in real-time as the API streams them. `StreamingChunk` events emitted per-token from backend, accumulated in frontend reducer, rendered via `StreamingBubble` component with blinking cursor
- **Full markdown rendering** — Headings (h1-h6), lists (ordered/unordered), tables, blockquotes, horizontal rules, links, images, bold, italic, strikethrough, inline code all rendered properly in `MessageBubble.tsx`
- **Copy button on messages** — Every message bubble shows copy/edit/regenerate buttons on hover
- **File/image upload** — Attach files via button or drag-and-drop. File contents sent inline with message. Attached files preview with remove buttons
- **Search in conversations** — Full-text search across all saved conversations via `search_conversations` backend command. Results show session ID, role, and snippet with context

#### Important (Yellow) — Differentiators
- **Model selector in UI** — Dropdown in toolbar to switch between models (DeepSeek, Claude, GPT-4o, etc.) mid-conversation via `set_model` backend command
- **Stop/cancel generation** — Stop button in input bar and inline during streaming. Uses `CancellationToken` in backend to abort API request mid-stream. Partial text preserved with "[Generation stopped]" marker
- **Message editing** — Edit button on user messages opens inline editor. Save & Resend re-sends the edited message
- **Response regeneration** — Retry button on assistant messages re-sends the last user message to get a different response
- **Export conversations** — Export as Markdown or JSON via toolbar dropdown. Downloads file directly
- **Keyboard shortcuts** — Ctrl+N (new chat), Ctrl+Shift+S (search), Ctrl+Shift+E (export), Ctrl+, (system prompt), Ctrl+Shift+M (model selector), Escape (close modals)
- **System prompt customization** — Modal dialog to set custom instructions. Persisted in API client via `set_system_prompt` / `get_system_prompt` commands

#### Nice to Have (Green)
- **Syntax highlighting** — Keyword-based highlighting for 12+ languages (JS, TS, Python, Rust, Go, Java, CSS, HTML, JSON, Bash, SQL + aliases). Custom highlighter with keyword/type/builtin/string/comment/number token classes
- **Dark/light theme persistence** — Theme saved to localStorage and restored on app restart

### Backend Changes

#### New AppEvent Variants (claude_events.rs)
- `StreamingChunk { text, model }` — Emitted per-token during streaming
- `GenerationStopped { partial_text, model }` — Emitted when user cancels generation

#### New API Client Features (api_client.rs)
- `CancellationToken` — Tokio-based cancellation for in-flight API requests
- `cancel_generation()` — Cancel current streaming request
- `set_system_prompt()` / `system_prompt()` — Custom system prompt management
- `set_model()` / `current_model()` — Runtime model switching
- `edit_message_at()` — Edit and truncate conversation history
- `get_messages()` — Export conversation history
- `search_conversations()` — Full-text search across saved conversations
- `ConversationSearchResult` — Search result struct with session_id, snippet, score

#### New Backend Commands (lib.rs — 9 new)
- `stop_generation` — Cancel in-progress API streaming
- `set_system_prompt` / `get_system_prompt` — System prompt CRUD
- `set_model` / `get_current_model` — Model switching
- `edit_message` — Edit conversation message at index
- `export_conversation` — Export as markdown or JSON
- `search_conversations` — Search across saved conversations

#### Dependencies
- `tokio-util = "0.7"` — For `CancellationToken`

### Frontend Changes

#### Updated Files
- **`types.ts`** — Added `StreamingChunkEvent`, `GenerationStoppedEvent`, `ConversationSearchResult`, `isStreaming`/`streamingText` to `EventStoreState`
- **`useEventStore.ts`** — New `streaming_chunk` and `generation_stopped` event handlers, `STOP_STREAMING` action, `stopStreaming` dispatch
- **`MessageBubble.tsx`** — Complete rewrite: full markdown parser (code blocks, headings, lists, tables, blockquotes, links, images), syntax highlighting (12+ languages), copy/edit/regenerate buttons, streaming bubble component
- **`TimelineView.tsx`** — Streaming display with real-time text, stop generation button, edit/regenerate callback passthrough
- **`TimelineEntry.tsx`** — Edit/regenerate callback props passed to MessageBubble
- **`InputBar.tsx`** — File upload (button + drag-and-drop), attached files preview, stop generation button during streaming
- **`App.tsx`** — Model selector dropdown, search overlay, export menu, system prompt modal, keyboard shortcuts, theme persistence via localStorage, file upload handler, stop generation handler, message edit/regenerate handlers
- **`index.css`** — ~600 lines of new styles for streaming cursor, message actions, markdown elements, syntax highlighting, model selector, search panel, export menu, system prompt modal, file attachments, stop button

### Success Criteria
- [x] Streaming display shows tokens appearing in real-time
- [x] Markdown rendering handles headings, lists, tables, blockquotes, links, images
- [x] Copy button available on every message
- [x] Files can be attached via button or drag-and-drop
- [x] Conversations searchable across sessions
- [x] Model switchable via dropdown without restart
- [x] Generation can be stopped mid-stream
- [x] User messages editable with re-send
- [x] Assistant responses regeneratable
- [x] Conversations exportable as Markdown or JSON
- [x] Keyboard shortcuts for all major actions
- [x] System prompt customizable via UI
- [x] Code blocks have language-specific syntax highlighting
- [x] Theme preference persists across restarts

### Build Status
- `npx tsc --noEmit` — 0 errors
- `npx vite build` — 60 modules, clean

---

## Phase 10 — OpenRouter/Hermes/OpenClaw + Prompt Transformer + Web Search

**Status: COMPLETE**

### Goals
- Add OpenRouter and Nous Research as new providers with Hermes 3 and OpenClaw models
- Add specialized agents (Hermes Reasoner, OpenClaw Coder, Hermes Analyst)
- Build a prompt transformer/structuring system with auto-enhance
- Build a web search feature with auto-trigger
- Claude Code remains the default engine; new providers are additional options

### What Was Built

#### Backend: `prompt_transformer.rs` (new)
- Intent detection engine (keyword-based mode classification)
- 5 transform modes: AutoEnhance, CodeTask, Analysis, Creative, Debug, Raw
- Built-in prompt templates for each mode
- Custom template management (save/delete/list)
- Language detection from prompt context
- Web search trigger detection
- Settings persistence (enabled by default)

#### Backend: `web_search.rs` (new)
- Multi-provider search engine (DuckDuckGo, Tavily, SearXNG)
- DuckDuckGo instant answer API integration (no API key needed)
- Tavily API integration (optional API key)
- SearXNG instance support (configurable URL)
- Search result formatting for LLM context injection
- Response caching to disk
- Auto-trigger detection based on prompt keywords
- Settings persistence (enabled by default)

#### Backend: `provider_router.rs` (updated)
- Added `OpenRouter` and `NousResearch` to ProviderType enum
- OpenRouter provider with 5 models:
  - Hermes 3 405B (nousresearch/hermes-3-llama-3.1-405b)
  - Hermes 3 70B (nousresearch/hermes-3-llama-3.1-70b)
  - OpenChat 3.6 8B (openchat/openchat-3.6-8b)
  - Llama 3.1 405B (meta-llama/llama-3.1-405b-instruct)
  - Mistral Large (mistralai/mistral-large-2411)
- Nous Research direct provider with Hermes 3 70B

#### Backend: `multi_agent.rs` (updated)
- Hermes Reasoner agent — deep reasoning, chain-of-thought, problem decomposition
- OpenClaw Coder agent — fast code generation, code completion
- Hermes Analyst agent — data analysis, summarization, research

#### Backend: `api_client.rs` (updated)
- OpenRouter-specific HTTP headers (HTTP-Referer, X-Title) for OpenRouter API compliance

#### Backend: `lib.rs` (updated)
- 12 new Tauri commands for prompt transformer and web search

#### Frontend: `App.tsx` (updated)
- Grouped model selector dropdown (by provider)
- Prompt transformer toggle + settings
- Web search toggle + auto-trigger integration
- Transform preview panel
- Web search results indicator bar
- Enhanced send pipeline: raw prompt → transform → web search → send

#### Frontend: `InputBar.tsx` (updated)
- Preview button (eye icon) for transform preview
- Debounced preview on input change
- New props for transform integration

#### Frontend: `types.ts` (updated)
- TransformMode, TransformSettings, PromptTemplate, TransformResult types
- SearchProvider, WebSearchSettings, WebSearchResult, WebSearchResponse types
- Updated ProviderType with OpenRouter + NousResearch

#### Frontend: `index.css` (updated)
- Grouped model dropdown styling
- Enhance toggle (golden glow when active)
- Web search toggle (blue glow when active + spinner)
- Web search results bar
- Transform preview bar with mode badges
- Preview button styling

### Success Criteria
- [x] OpenRouter and Nous Research providers registered with model configs
- [x] Hermes 3 (405B, 70B) and OpenChat 3.6 models available in dropdown
- [x] 3 new specialized agents (Hermes Reasoner, OpenClaw Coder, Hermes Analyst)
- [x] Prompt transformer with 5 modes and auto-detection
- [x] Custom prompt template support (save/edit/delete)
- [x] Web search with DuckDuckGo (free), Tavily, SearXNG support
- [x] Web search auto-triggers on relevant prompts
- [x] Transform + search pipeline integrated into message send flow
- [x] Both features toggleable and ON by default
- [x] Settings persist across sessions

### Build Status
- `npx tsc --noEmit` — 0 errors
- `npx vite build` — clean

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
| `provider_router.rs` | 8+10 | Provider registry, model routing, failover strategies, OpenRouter/Nous |
| `prompt_transformer.rs` | 10 | Prompt auto-enhancement, intent detection, templates |
| `web_search.rs` | 10 | Web search integration (DuckDuckGo/Tavily/SearXNG) |
| `lib.rs` | 1-10 | Tauri commands + app entry |

### Frontend (src/)
| File | Phase | Purpose |
|------|-------|---------|
| `types.ts` | 2+4+5+6+7+8+10 | Shared types, events, timeline, session, brain, graphs, optimizer, agents, router, transformer, search |
| `hooks/useEventStore.ts` | 2+4 | Centralized reducer state + replay |
| `App.tsx` | 2-10 | Main app wiring |
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
| `components/InputBar.tsx` | 2+10 | Slash command input + transform preview |
| `index.css` | 2-10 | All CSS (~5800 lines) |
| `components/ErrorBoundary.tsx` | 11 | React error boundary with retry |
| `vite-env.d.ts` | 11 | Asset module type declarations |

---

## Phase 11 — Stabilization Roadmap (All 6 Phases)

**Status: COMPLETE**

### Overview
This phase implements the AI Workspace Stabilization Roadmap: a foundation-first execution plan focused on making the workspace feel excellent before adding more AI complexity. All 6 stabilization priority phases were completed in a single pass.

---

### Phase 11.1 — Core Runtime Stabilization

**Status: COMPLETE**

#### What Was Done

- [x] **Malformed event recovery** — `parse_stream_line()` in `ollopa_events.rs` now attempts to recover from trailing garbage after valid JSON by finding the closing brace boundary
- [x] **JSON boundary detection** — Added `find_json_end()` function that properly handles nested objects, string escapes, and brace depth tracking
- [x] **Stream idle timeout** — API client now aborts after 60 seconds of no data from the provider, emitting a recoverable error event
- [x] **Consecutive error resilience** — Stream processing tolerates up to 5 transient chunk errors before aborting, rather than failing on the first error
- [x] **Event deduplication (backend)** — EventBus now fingerprints events and skips identical events within a 50ms window (streaming chunks are exempt)
- [x] **Event history cleanup** — `clear_history()` now also clears the deduplication fingerprint buffer

#### Files Modified
- `src-tauri/src/ollopa_events.rs` — Malformed JSON recovery + `find_json_end()`
- `src-tauri/src/api_client.rs` — Stream timeout, consecutive error handling
- `src-tauri/src/event_bus.rs` — Event deduplication with fingerprinting

---

### Phase 11.2 — Frontend Stability + UX Hardening

**Status: COMPLETE**

#### What Was Done

- [x] **React ErrorBoundary** — Created `ErrorBoundary.tsx` component that catches rendering crashes, displays a fallback UI with retry button, and logs errors to console
- [x] **App-level error boundary** — Wrapped the root `<App />` in `<ErrorBoundary>` in `main.tsx`
- [x] **Per-entry error boundaries** — Each timeline entry in `TimelineView.tsx` is wrapped in its own `<ErrorBoundary>`, preventing a single broken entry from crashing the entire timeline
- [x] **Event deduplication (frontend)** — Added `isDuplicate()` guard in the `useEventStore` reducer that skips identical non-streaming events within a 100ms window
- [x] **Timeline virtualization** — Long sessions (>200 entries) only render the most recent 200 entries with a "Show N older entries" button to load all
- [x] **TypeScript asset declarations** — Created `vite-env.d.ts` with module declarations for `.png`, `.jpg`, `.svg`, `.wav` files, fixing the 3 TypeScript compilation errors

#### Files Created
- `src/components/ErrorBoundary.tsx`
- `src/vite-env.d.ts`

#### Files Modified
- `src/main.tsx` — ErrorBoundary wrapper
- `src/hooks/useEventStore.ts` — Event deduplication + `useMemo` for derived state
- `src/components/timeline/TimelineView.tsx` — Virtualization + per-entry error boundaries + `memo(TimelineEntry)`
- `src/index.css` — Error boundary + virtualization notice CSS

---

### Phase 11.3 — Session System Hardening

**Status: COMPLETE**

#### What Was Done

- [x] **Monotonic event timestamps** — `append_event_to_snapshot()` now enforces strictly increasing timestamps (each event is at least 1ms after the previous), preventing out-of-order events during replay
- [x] **Atomic snapshot writes** — All snapshot mutations (event append, heartbeat update, session finalize) now write to a `.json.tmp` file first, then rename to the target path, preventing corruption from interrupted writes
- [x] **Crash recovery hardening** — The startup `mark_crashed_sessions()` already detects stale Active sessions (>60s heartbeat age) and marks them as Crashed, providing automatic crash detection

#### Files Modified
- `src-tauri/src/session_manager.rs` — Atomic writes + monotonic timestamps in `append_event_to_snapshot()`, `update_heartbeat()`, `finalize_session()`

---

### Phase 11.4 — Token + Context Stabilization

**Status: COMPLETE**

#### What Was Done

- [x] **Duplicate content prevention** — `build_optimized_context()` in `token_optimizer.rs` now tracks content fingerprints (normalized lowercase hash) and skips duplicate entries across decisions, rolling summaries, individual summaries, and search results
- [x] **Content-aware deduplication** — Normalizes whitespace before hashing to catch near-duplicate content from different sources

#### Files Modified
- `src-tauri/src/token_optimizer.rs` — Content fingerprinting + dedup in context builder

---

### Phase 11.5 — Performance Optimization

**Status: COMPLETE**

#### What Was Done

- [x] **React.memo on ToolCard** — Prevents unnecessary re-renders of tool cards when parent state changes
- [x] **React.memo on MessageBubble** — Prevents unnecessary re-renders of message bubbles during streaming
- [x] **React.memo on TimelineEntry** — `MemoizedTimelineEntry` wrapper in `TimelineView.tsx`
- [x] **useMemo for derived state** — `toolEntries`, `runningTools`, and `stats` in `useEventStore` are now memoized instead of recomputed on every render
- [x] **Fixed avgDuration calculation** — Previous code could produce NaN when no tools had duration_ms; now uses `completedTools.length` as denominator

#### Files Modified
- `src/components/tools/ToolCard.tsx` — `memo()` wrapper
- `src/components/timeline/MessageBubble.tsx` — `memo()` wrapper
- `src/components/timeline/TimelineView.tsx` — `MemoizedTimelineEntry`
- `src/hooks/useEventStore.ts` — `useMemo` for derived data

---

### Phase 11.6 — Visual UX Polish

**Status: COMPLETE**

#### What Was Done

- [x] **Tool card border radius** — Updated from `2px` to `6px` for a smoother look
- [x] **Tool card hover shadow** — Added subtle `box-shadow` on hover for depth
- [x] **Session item border radius** — Updated from `2px` to `6px`
- [x] **Session item hover effect** — Combined hover with shadow for better interactivity feedback
- [x] **Timeline entry transitions** — Added `opacity 0.15s` transition for smoother entry appearance
- [x] **Timeline entry spacing** — Added `margin-top: 2px` between consecutive entries for visual clarity
- [x] **Content overflow** — Added `min-width: 0` and `word-break: break-word` to `.tl-content` for proper text wrapping
- [x] **Error boundary styling** — Full error recovery UI with icon, message, and retry button
- [x] **Virtualization notice styling** — Clean button for loading older timeline entries

#### Files Modified
- `src/index.css` — Tool card, session item, timeline, error boundary, virtualization styles

---

### Build Verification

After all stabilization changes:

```
npx tsc --noEmit  -> 0 errors
npx vite build    -> 91 modules transformed, clean build in ~1.5s
```

### Summary of Changes Across All Stabilization Phases

| Category | Change | Impact |
|----------|--------|--------|
| Stream recovery | Malformed JSON recovery + idle timeout | Survives provider failures |
| Error resilience | Consecutive error tolerance (5) | Handles transient network issues |
| Event integrity | Backend + frontend deduplication | Prevents duplicate events |
| Crash safety | Atomic snapshot writes | Prevents data corruption |
| Event ordering | Monotonic timestamps | Deterministic replay |
| UI stability | ErrorBoundary (app + per-entry) | Crash isolation |
| Performance | Timeline virtualization (200 entries) | Handles long sessions |
| Performance | React.memo on heavy components | Reduced re-renders |
| Performance | useMemo for derived computations | Avoids unnecessary work |
| Token efficiency | Context deduplication | Prevents redundant context injection |
| Visual polish | Rounded corners, shadows, transitions | Premium feel |

---

## Post-Stabilization Upgrade — Advanced Systems Expansion

### Upgrade Phase A — Second-Brain Evolution

**Status: COMPLETE**

#### What Was Built
- [x] TF-IDF based embedding vectors (`EmbeddingVector` struct) for semantic similarity
- [x] Cosine similarity search engine (`semantic_search`) with recency boost
- [x] Vocabulary builder from indexed content (`build_vocabulary`)
- [x] TF-IDF vector computation per document (`compute_tfidf`)
- [x] Decision query engine with relevance ranking (`query_decisions`)
- [x] Related decision detection via tag overlap
- [x] Knowledge snapshot system (`KnowledgeSnapshot`) with layered compression
- [x] Three knowledge layers: decisions, summaries, architecture
- [x] Full-layer snapshots combining all three
- [x] Hot file detection from session history
- [x] Architecture pattern extraction from decisions and file frequency
- [x] Enhanced brain stats (`EnhancedBrainStats`) with embedding/snapshot counts
- [x] Semantic coverage tracking across index entries
- [x] Persistent snapshot storage in `~/.ollopa/workspace-brain/snapshots/`
- [x] Persistent embedding storage in `~/.ollopa/workspace-brain/embeddings/`
- [x] 6 new Tauri commands: `brain_build_embeddings`, `brain_semantic_search`, `brain_query_decisions`, `brain_build_snapshot`, `brain_list_snapshots`, `brain_enhanced_stats`
- [x] Frontend types: `SimilarityResult`, `KnowledgeSnapshot`, `DecisionQueryResult`, `EnhancedBrainStats`

---

### Upgrade Phase B — Visual Intelligence Systems

**Status: COMPLETE**

#### What Was Built
- [x] Memory graph builder (`build_memory_graph`) — concept nodes, co-occurrence edges, cluster detection
- [x] Concept extraction from recurring tags across summaries and decisions
- [x] Co-occurrence edge detection between concepts
- [x] Debugging cluster detection (tags containing debug/fix/error/bug)
- [x] Architecture cluster detection (tags containing arch/design/refactor/migration)
- [x] Lazy/progressive graph loading (`build_lazy_graph`) — BFS from root with depth/node limits
- [x] Supports relationship, architecture, and memory graph types
- [x] Enhanced visual stats (`EnhancedVisualStats`) with memory graph metrics
- [x] 3 new Tauri commands: `visual_build_memory_graph`, `visual_build_lazy_graph`, `visual_enhanced_stats`
- [x] Frontend types: `EnhancedVisualStats`

---

### Upgrade Phase C — Intelligent Orchestration

**Status: COMPLETE**

#### What Was Built
- [x] Task type detection from prompt text (`detect_task_type`) — 10 task types
- [x] Keyword pattern matching for: debugging, code generation, analysis, search, refactoring, documentation, architecture, testing, quick questions
- [x] Smart routing (`smart_route`) — task-aware provider/model selection
- [x] Quality tier mapping: high (debugging/architecture), medium (refactoring/testing), low (search/docs)
- [x] Budget-aware execution check (`check_budget`) with cost estimation
- [x] Latency-aware routing (`route_by_latency`) — picks fastest healthy provider
- [x] Workflow routing templates (`get_workflow_routes`) — 7 predefined step-action routes
- [x] Enhanced router stats (`EnhancedRouterStats`) with task distribution and budget status
- [x] Health-aware filtering (excludes down providers)
- [x] 6 new Tauri commands: `router_smart_route`, `router_detect_task_type`, `router_check_budget`, `router_route_by_latency`, `router_workflow_routes`, `router_enhanced_stats`
- [x] Frontend types: `TaskTypeLabel`, `TaskRouteRecommendation`, `BudgetCheck`, `WorkflowRoute`, `EnhancedRouterStats`

---

### Upgrade Phase D — Lightweight Multi-Agent Systems

**Status: COMPLETE**

#### What Was Built
- [x] Scoped delegation system (`Delegation` struct) — bounded subtasks with depth tracking
- [x] Delegation limits enforcement (max per task, max recursion depth)
- [x] Delegation completion with summary results
- [x] Agent memory isolation (`AgentMemory`) — per-agent context with token budgets
- [x] FIFO eviction when agent memory exceeds token limit
- [x] Agent memory clear operation
- [x] Agent execution summarization (`AgentSummary`) — findings, recommendations, metrics
- [x] Safety configuration (`SafetyConfig`) — recursion limits, retry ceilings, budget ceilings, inactivity timeout, concurrent agent limits
- [x] Workflow safety check (`check_workflow_safety`) — circular dependency detection, concurrent agent limits, delegation depth validation
- [x] Enhanced agent stats (`EnhancedAgentStats`) — delegation counts, memory usage, safety config
- [x] Persistent storage: `~/.ollopa/workspace-brain/agents/delegations/`, `memory/`, `safety.json`
- [x] 11 new Tauri commands: `agent_create_delegation`, `agent_complete_delegation`, `agent_list_delegations`, `agent_get_memory`, `agent_add_context`, `agent_clear_memory`, `agent_summarize`, `agent_safety_config`, `agent_save_safety_config`, `agent_check_safety`, `agent_enhanced_stats`
- [x] Frontend types: `Delegation`, `AgentMemory`, `AgentSummary`, `SafetyConfig`, `SafetyCheckResult`, `EnhancedAgentStats`

---

### Upgrade Phase E — Workspace Intelligence

**Status: COMPLETE**

#### What Was Built
- [x] Comprehensive repo mapping (`build_repo_map`) — module scanning, dependency detection, boundary identification
- [x] Module info extraction: file counts, line counts, primary language, inter-module dependencies
- [x] Import analysis for TypeScript/JavaScript (from statements) and Rust (use/mod)
- [x] Architectural boundary detection: Frontend, Backend, Configuration layers
- [x] Hot file detection from session modification history
- [x] Change impact analysis (`predict_change_impact`) — co-modification tracking, module mapping, risk classification
- [x] Regression risk detection (test files, config files)
- [x] Architectural drift detection (`detect_drift`) — coupling analysis, boundary violations, oversized modules
- [x] Health score computation with weighted violation scoring
- [x] Workflow pattern recognition (`detect_workflow_patterns`) — debugging flows, repeated edits, common tools
- [x] Full workspace intelligence report (`get_workspace_intelligence`) combining all analyses
- [x] Persistent repo map storage in `~/.ollopa/workspace-brain/intelligence/`
- [x] 5 new Tauri commands: `workspace_build_map`, `workspace_predict_impact`, `workspace_detect_drift`, `workspace_detect_patterns`, `workspace_intelligence`
- [x] Frontend types: `ModuleInfo`, `ArchBoundary`, `HotFile`, `RepoMap`, `ChangeImpact`, `DriftViolation`, `DriftReport`, `WorkflowPatternInfo`, `WorkspaceIntelligence`
- [x] WorkspacePanel component with 5 tabs: Overview, Modules, Drift, Patterns, Impact

---

### Upgrade Phase F — Predictive Workflows

**Status: COMPLETE**

#### What Was Built
- [x] Predictive suggestion engine (`generate_suggestions`) — related files, relevant decisions, regression risks, workflow patterns
- [x] Smart context assembly (`assemble_smart_context`) — combines brain search, decisions, semantic search, drift analysis, workflow hints
- [x] Workflow recommendation engine (`recommend_workflows`) — testing, debugging, architecture review, implementation strategies
- [x] Confidence scoring for suggestions and recommendations
- [x] Full predictive analysis (`get_predictive_analysis`) combining all three systems
- [x] New Rust module: `predictive.rs`
- [x] 4 new Tauri commands: `predictive_suggestions`, `predictive_smart_context`, `predictive_recommendations`, `predictive_analysis`
- [x] Frontend types: `PredictiveSuggestion`, `SmartContext`, `WorkflowRecommendation`, `PredictiveAnalysis`
- [x] PredictivePanel component with input fields and 3 tabs: Suggestions, Context, Workflows

---

### Integration Summary

| Phase | Backend Changes | New Commands | Frontend Types | Components |
|-------|----------------|--------------|----------------|------------|
| A — Second-Brain Evolution | `second_brain.rs` extended | 6 | 4 | — |
| B — Visual Intelligence | `visual_memory.rs` extended | 3 | 1 | — |
| C — Intelligent Orchestration | `provider_router.rs` extended | 6 | 5 | — |
| D — Multi-Agent Systems | `multi_agent.rs` extended | 11 | 6 | — |
| E — Workspace Intelligence | `repo_intelligence.rs` extended | 5 | 9 | WorkspacePanel |
| F — Predictive Workflows | New `predictive.rs` module | 4 | 4 | PredictivePanel |
| **Total** | **6 modules modified/created** | **35 new commands** | **29 new types** | **2 new panels** |
