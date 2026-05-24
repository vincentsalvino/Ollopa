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

**Status: NOT STARTED**

### Goals
- Build persistent workspace intelligence
- Memory summaries, semantic indexing, retrieval

---

## Phase 6 — Visual Memory Systems

**Status: NOT STARTED**

### Goals
- Visualize workspace intelligence
- Relationship graphs, architecture graphs, workflow DAGs

---

## Phase 7 — Token Optimization

**Status: NOT STARTED**

### Goals
- Minimize DeepSeek costs
- Retrieval optimization, rolling summaries, token budgeting

---

## Phase 8 — Future Enhancements (Optional)

**Status: NOT STARTED**

### Goals
- Multi-agent workflows, provider routing, MCP integrations

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
| `lib.rs` | 1-4 | Tauri commands + app entry |

### Frontend (src/)
| File | Phase | Purpose |
|------|-------|---------|
| `types.ts` | 2+4 | Shared types, events, timeline, session |
| `hooks/useEventStore.ts` | 2+4 | Centralized reducer state + replay |
| `App.tsx` | 2-4 | Main app wiring |
| `components/timeline/TimelineView.tsx` | 2-3 | Scrollable timeline |
| `components/timeline/TimelineEntry.tsx` | 2-3 | Polymorphic entry renderer |
| `components/timeline/MessageBubble.tsx` | 2 | Markdown renderer |
| `components/tools/ToolCard.tsx` | 2-3 | Tool execution card |
| `components/tools/ToolDetailPanel.tsx` | 3 | Full tool inspection modal |
| `components/approvals/ApprovalModal.tsx` | 2 | Approval dialog |
| `components/approvals/FileDiffModal.tsx` | 2-3 | Diff viewer + syntax highlighting |
| `components/sessions/SessionSidebar.tsx` | 2+4 | Session history + restore |
| `components/Dashboard.tsx` | 2 | Metrics + analytics |
| `components/Toast.tsx` | 2 | Notifications |
| `components/InputBar.tsx` | 2 | Slash command input |
| `index.css` | 2-4 | All CSS (~2900 lines) |
