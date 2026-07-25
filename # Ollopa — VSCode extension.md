# Ollopa — AI Coding Platform for VS Code

## Blueprint & System Design

> **Tagline:** *Code once. Remember forever. Improve autonomously.*
> **Target:** A VS Code extension that provides a chat‑centric, multi‑agent AI coding assistant with a persistent, self‑improving memory.

---

## 1. Core Principles

* **Local‑first, cloud‑augmented:** All agent logic, tool execution, and file editing happen locally. Only the knowledge base (memories) is synced to the cloud (Supabase).
* **Chat‑centric interface:** A dedicated side‑panel webview hosts the entire interaction—message stream, tool calls, diffs, and approvals—seamlessly integrated into the VS Code workbench.
* **Memory that improves:** Every mistake is captured, distilled, and stored. The system learns your codebase's conventions and anti‑patterns over time.
* **Safe by design:** Contract‑driven development, isolated file workspaces, whitelisted shell commands, and deterministic security checks (semgrep) prevent agents from causing harm.
* **Engineering principles embedded:** KISS, DRY, YAGNI, SOLID, Boy Scout Rule, Fail‑Fast, and other principles are embedded in agent prompts, contract templates, tool execution, and the review audit — not just documented, but enforced at every layer.
* **Lightweight stack:** One Node.js sidecar process (orchestrator + memory client + refinery), VS Code extension host, React webview. No external services except Supabase.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VS Code Window                              │
│                                                                     │
│  ┌──────────┐   ┌────────────────────────┐   ┌───────────────────┐  │
│  │ Activity │   │      Editor Area        │   │  Ollopa Panel     │  │
│  │ Bar      │   │   (normal code files)   │   │  (Webview)        │  │
│  │ (Ollopa  │   │                        │   │                   │  │
│  │  icon)   │   │                        │   │ ┌───────────────┐ │  │
│  └──────────┘   └────────────────────────┘   │ │  Chat Panel   │ │  │
│                                                │ │ (center)      │ │  │
│  ┌──────────────────────┐                     │ └───────────────┘ │  │
│  │  Left Sidebar        │                     │ ┌───────────────┐ │  │
│  │  · Agent Status      │                     │ │  Tool Cards   │ │  │
│  │  · Knowledge Filters │                     │ │  (expandable) │ │  │
│  └──────────────────────┘                     │ └───────────────┘ │  │
│                                               │ ┌───────────────┐ │  │
│                                               │ │  Right Panel  │ │  │
│                                               │ │  · Context    │ │  │
│                                               │ │  · Memory     │ │  │
│                                               │ └───────────────┘ │  │
│                                               └───────────────────┘  │
└────────────────────────────────────────────┬────────────────────────┘
                                             │ VS Code API
                                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Extension Host (Node.js)                      │
│  · Manages webview lifecycle                                        │
│  · Spawns and supervises sidecar process                            │
│  · Bridges WebSocket between webview <-> sidecar                    │
│  · Applies file edits via WorkspaceEdit                             │
│  · Reads secrets from SecretStorage                                 │
│  · Executes whitelisted shell commands in terminal                  │
└────────────────────────────────────────────┬────────────────────────┘
                                             │ fork() + WebSocket
                                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Sidecar Process (Node.js)                        │
│  · LangGraph.js orchestrator (agent state machine for Task Mode)    │
│  · Direct Supabase client (scoped credentials)                      │
│  · Local SQLite cache for offline memory                            │
│  · Refinery (distillation pipeline) – runs on timer or after task   │
│  · WebSocket server: streams events to extension host               │
│  · Internal task management (multiple concurrent runs)              │
└────────────────────────────────────────────┬────────────────────────┘
                                             │ HTTPS (only for Supabase)
                                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Supabase (Cloud)                              │
│  · memories table (pgvector, full‑text search, hybrid RPC)         │
│  · raw_ingest_queue                                                 │
│  · refinery_runs, pending_reviews                                   │
│  · RLS + scoped database role                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Details

### 3.1 Extension Host (`extension/src/`)

**Responsibilities:**
- **Lifecycle:** Activates when VS Code starts, deactivates on shutdown, kills sidecar process.
- **Sidecar spawner:** Forks `sidecar/start.js` as a child process, passes a random available port and Supabase credentials (from `SecretStorage`) via environment variables.
- **WebSocket bridge:** Connects to the sidecar's WebSocket server. Relays messages between webview and sidecar, translating webview `postMessage` to WebSocket frames and vice versa.
- **Command execution:** Intercepts tool calls that require VS Code integration:
  - `search_replace` → `WorkspaceEdit` to apply changes to the temporary workspace folder.
  - `execute_safe_bash` → spawns command in a dedicated VS Code Terminal, captures output, and enforces whitelist before execution.
  - `check_git_diff` → uses VS Code's built‑in Git extension API to get diff for the temp workspace.
  - `secure_read_file` → reads from the temp workspace via `vscode.workspace.fs`.
- **Diagnostics:** Feeds lint output (`run_lint`) into VS Code's Problems panel.
- **UI integration:** Creates left sidebar view (`Agent Status`), status bar item, and the Ollopa webview panel.

**Key files:**
- `extension.ts` – activation entry
- `sidecarManager.ts` – spawn/manage sidecar process
- `webviewProvider.ts` – creates and manages the chat webview panel
- `toolBridge.ts` – translates sidecar tool requests to VS Code API calls
- `commandWhitelist.ts` – defines allowed commands/args/patterns

### 3.2 Webview UI (`webview/`)

A React application (built with Vite) that is loaded into the webview panel. It uses `@vscode/webview-ui-toolkit` for native look & feel.

**Layout:**
- **Left sidebar (collapsible):** Agent status (current task, pulse icon), knowledge category filters, mini graph (optional).
- **Center – Chat stream:** Message cards for each agent turn. Cards contain:
  - Agent name, timestamp, thought/explanation.
  - Expandable tool call sections with:
    - Input parameters.
    - Output (terminal, file diff with syntax highlighting).
  - Inline diff viewer: toggle between unified diff and final file view.
  - "Apply" / "Reject" buttons for Quick Mode edits.
- **Right sidebar:** Context files, current `.contract.json`, retrieved memories used.

**Key components:**
- `MessageCard` – renders agent message, tool calls, diffs.
- `PlanApprovalModal` – overlay with approve/reject/comment for Task Mode.
- `ChatInput` – multiline input with model selector and mode toggle (Quick/Task).
- `useWebSocket` hook – maintains connection to extension host (via `acquireVsCodeApi`), receives streamed events.
- `useSidecarState` – manages agent status, tool output, task progress.

**Streaming protocol (WebSocket → webview):**
- `agent_thought` { agent, message, timestamp }
- `tool_call` { agent, toolName, args, taskId }
- `tool_output_chunk` { taskId, chunk (text/diff) }
- `tool_output_complete` { taskId, summary }
- `task_final_diff` { taskId, diff }
- `task_complete` { taskId, status (PASS/FAIL), message }
- `plan_proposed` { taskId, contract, planText }
- `error` { taskId, message }

### 3.3 Sidecar Orchestrator (`sidecar/`)

A standalone Node.js process that runs the AI agent logic.

**Stack:** TypeScript, LangGraph.js (Task Mode), OpenAI-compatible client (OmniRoute or direct providers), Supabase JS client, `better-sqlite3` (for local cache), `ws` (WebSocket server).

**Startup:**
1. Reads env vars (`OLLOPA_PORT`, `SUPABASE_*`, `OLLOPA_OMNIROUTE_URL`, etc.).
2. Connects to Supabase; initializes local SQLite cache.
3. Starts WebSocket server on the assigned port.
4. Loads plugins from `.ollopa/plugins/` directories.
5. Emits `ready` status to extension host.

**Agent orchestration:**
- **Quick Mode:** A simple LLM tool‑using loop (while‑loop with `ToolAwaiter` promise queue). Single Implementation agent with principles‑aware system prompt. No LangGraph needed — linear execution is sufficient.
- **Task Mode (Phase 4):** A LangGraph `StateGraph` that orchestrates the full pipeline:
  - Nodes: `architect` → `humanApproval` → `router` → `worker` → `review`
  - Conditional edges for HITL (approve/reject/replan) and retry (PASS/FAIL, max 3 cycles)
  - Shared `TaskState` carrying contract, messages, workspace path, retry count, and captured mistakes.

**Internal modules:**
- `server.ts` – WebSocket message handler, task lifecycle.
- `agents/` – system prompts (with embedded engineering principles), function definitions for each agent.
- `agents/taskModeGraph.ts` – LangGraph state machine for Task Mode (Phase 4).
- `tools/` – tool definitions (schemas in sidecar; execution proxied to extension host via WebSocket).
- `memory/` – Supabase client, hybrid search, local SQLite cache, offline fallback.
- `refinery/` – distillation pipeline (triggered manually or on a timer).
- `plugins/` – plugin loader, command registry, tool registry, hook system (Phase 3.6).

### 3.4 Memory System

**Unified `memories` table (Supabase):**
- Columns: `id`, `title`, `content` (2‑sentence distillation), `scope`, `status`, `source` (SEED/REFINERY), `quality_score`, `performance_score`, `agent`, `tags`, `category`, `code_block`, `use_when`, `avoid_when`, `embedding` (1536‑d stored as text), timestamps.
- Client‑side hybrid search: SELECT candidate set, parse stringified embeddings, cosine‑rank in JS. (The `match_memories` RPC exists but is unused due to embedding column type mismatch.)

**Local SQLite cache (`~/.ollopa/memory_cache.db`):**
- Mirrors the most recently used and highest‑scored memories from Supabase.
- Synchronized on retrieval; offline fallback with cosine ranking on cached embeddings.

**Ingestion & Refinery:**
- Mistake & Repair captures fail data → writes to `raw_ingest_queue` via Supabase (or local queue if offline).
- The Refinery runs manually or on a timer; distills mistakes into 2‑sentence Candidate memories with deduplication.

### 3.5 Tool Definitions

Tools are defined in the sidecar with JSON Schema for the LLM, but their execution is proxied to the extension host.

| Tool | Description | Execution |
|------|-------------|-----------|
| `search_replace` | Replace old_str with new_str in a file (exact match) | Extension host applies edit to temp workspace, returns diff |
| `read_file` | Read a file's contents (excluding .env, secrets) | Extension host reads from temp workspace |
| `execute_safe_bash` | Run a whitelisted shell command (30s timeout) | Extension host validates whitelist, runs in temp workspace, returns stdout/stderr |
| `run_lint` | Run linter on changed files | Extension host runs project linter |
| `check_git_diff` | Show current uncommitted changes | Extension host uses Git API on temp workspace |
| `semgrep_scan` | Run semgrep on changed files (used by Review) | Extension host executes `npx semgrep --config auto <files>` |
| `retrieve_memory` | Semantic search in knowledge base | Sidecar internal — uses memory service directly |
| `define_contract` | Creates `.contract.json` in temp workspace | Sidecar produces JSON; extension host writes file |

All file‑modifying tools operate on a **temporary workspace** (a copy of the project folder created when a task starts).

### 3.6 Agent Team

| Agent | Scope | Temp | Role | Principles Enforced | Tools |
|-------|-------|------|------|---------------------|-------|
| **Architect** (Task Mode) | architecture | 0.0 | Plans, delegates, writes contract. Never generates code. | KISS, YAGNI, SRP, SoC, Composition over Inheritance | `retrieve_memory`, `define_contract`, `read_file` (config files only) |
| **Frontend** | frontend | 0.05 | Senior UI engineer. Banned: purple gradients, glassmorphism, centered heroes. | KISS, DRY, Boy Scout Rule, POLA | `search_replace`, `read_file`, `execute_safe_bash`, `run_lint` |
| **Backend** | backend | 0.0 | Senior backend. SQL injection prevention, proper error handling. | DRY, Fail‑Fast, Idempotency, KISS | `search_replace`, `read_file`, `execute_safe_bash`, `run_lint` |
| **Implementation** | general | 0.0 | Code executor. Follows specs exactly; no redesign. | KISS, DRY, YAGNI, Boy Scout Rule, Fail‑Fast | `search_replace`, `read_file`, `execute_safe_bash`, `run_lint` |
| **Review** | architecture | 0.0 | Read‑only auditor. Validates contract, runs semgrep, audits principles. | All principles (audit checklist) | `check_git_diff`, `semgrep_scan`, `retrieve_memory` (type RULE), `validate_contract` |

---

## 4. Engineering Principles Integration

Principles are not just documented — they are embedded and enforced at multiple layers:

| Layer | Mechanism | Principles Covered |
|-------|-----------|-------------------|
| **System prompts** | Each agent receives a "principles card" in its system message with role‑specific guidance | KISS, DRY, YAGNI, Boy Scout Rule, Fail‑Fast, POLA, SRP, SoC |
| **Architect contract** | Contract template enforces SRP (each change = one responsibility) and SoC (files grouped by concern) | SRP, SoC, High Cohesion, Low Coupling |
| **Worker tool execution** | Before `search_replace`, lightweight checks: if edit duplicates existing logic → warning (DRY); if it adds unnecessary abstraction → warning (KISS). Soft warnings, not hard blocks. | DRY, KISS, YAGNI |
| **Review audit** | Review agent explicitly checks: "Does the diff violate any principle?" Uses a checklist derived from the principles. Calls `retrieve_memory` for security/architecture rules. | All principles — structured PASS/FAIL per principle |
| **Mistake & Repair** | When a FAIL occurs, the violated principle (if identified) is captured alongside the bad diff and feedback, enriching the knowledge base with principle‑attributed lessons. | Specific principle attribution |

**Example — Implementation agent principles card:**
```
Principles you must follow:
- KISS: The simplest possible implementation. Favor clarity over cleverness.
- DRY: Reuse existing utilities, types, and patterns from the codebase.
- YAGNI: Implement only what the task asks. No speculative features.
- Boy Scout Rule: Leave the code slightly better than you found it.
- Fail-Fast: Validate inputs early. Use early returns to stop execution on bad assumptions.
```

**Example — Review agent principles audit checklist:**
```
Audit checklist:
- KISS: Is the implementation the simplest possible? Flag over-engineered abstractions.
- DRY: Does the change duplicate existing logic? Check the codebase for similar patterns.
- YAGNI: Does the change add code not required by the contract? Flag dead code, unused imports.
- SRP: Does each file/module touched have one clear responsibility?
- Fail-Fast: Are inputs validated? Missing error checks?
- Security: Hardcoded secrets, SQL injection, unsafe eval? (Block via semgrep.)
Return PASS only if no critical violations. Minor style issues are warnings, not failures.
```

---

## 5. Data Flows

### 5.1 Quick Mode (Phase 3 — Shipped)

```
UserInput → ImplementationAgent (with tool loop) → final diff → user accept/reject
```
- Single agent with principles‑aware system prompt.
- No planning, no contract, no review.
- Safety: temp workspace, bash whitelist.

### 5.2 Task Mode (Phase 4 — LangGraph)

```
UserTask
   │
   ▼
Architect (planning + contract)
   │
   ├──[plan_proposed]──► HITL wait (user approve/reject/comment)
   │                          │
   │                          ├─[reject w/ comment]→ Architect (revise, max 2 loops)
   │                          └─[approve]→ Router
   │
   ▼
Router (selects Frontend | Backend | Implementation based on task + contract)
   │
   ▼
Worker (tool‑using loop, role‑specific prompt)
   │
   ▼
Review (audit: contract hash, semgrep, principles check, diff scope)
   │
   ├──[PASS]──► Success (capture lessons, present final diff, user apply)
   │
   └──[FAIL]──► check retry count
                    ├──[< 3 retries]──► Worker (with review feedback injected)
                    └──[≥ 3 retries]──► Final Fail (capture mistake w/ principle attribution, present error)
```

The entire Task Mode flow is a LangGraph `StateGraph` with:
- **Nodes:** `architectNode`, `humanApprovalNode` (uses LangGraph `interrupt()`), `routerNode`, `workerNode`, `reviewNode`
- **State:** `TaskState { messages, contract, retryCount, feedback, workspaceRoot, taskId, status, finalDiff, violatedPrinciples }`
- **Conditional edges:** Approval (approve → router, reject → architect), Retry (PASS → end, FAIL → check retry count)

### 5.3 Mistake & Repair Capture

Only on FAIL after Review:
1. Sidecar stores a record in `raw_ingest_queue` with:
   - `task_id`, `bad_diff`, `review_feedback`, `corrected_diff` (if retry succeeds), `violated_principles`, `timestamp`.
2. The Refinery distills this into a principle‑attributed memory and stores it in Supabase.
3. The new memory becomes available for future tasks, tagged with the violated principle.

### 5.4 Offline Flow

- If Supabase is unreachable, memory retrieval uses local SQLite cache.
- Mistake & Repair records are queued in a local SQLite table (`offline_ingest`).
- When connection resumes, sidecar syncs queued records to Supabase, triggers refinery, and pulls updated memories.

---

## 6. Security Model

- **Credentials:** Supabase keys stored in VS Code `SecretStorage` (never on disk).
- **File isolation:** All agent edits happen in a temp directory copied from the workspace. Real files touched only after user approval.
- **Command whitelist:** `execute_safe_bash` validates against a JSON config with allowed commands, banned patterns, and 30s timeout.
- **Secrets protection:** `read_file` blocks access to `.env`, `*.pem`, `*secret*`, `credentials.*`.
- **Contract enforcement:** `validate_contract` hashes the final diff and compares with the contract; touching unlisted files → FAIL.
- **Semgrep integration:** Review agent runs semgrep on changed files; critical findings → FAIL.

---

## 7. UI/UX Design (Webview)

**Three‑column layout:**
- **Left sidebar (240px, collapsible):** Agent status list (per active task), quick filters for memory categories.
- **Center – Chat (flex):** Scrollable message list, color‑coded message cards, collapsible tool calls with diff highlighting, input area with mode toggle (Quick/Task) and model selector.
- **Right sidebar (260px, collapsible):** Context files, Git changes, retrieved memories.

**HITL Approval Modal:**
- Full‑screen overlay in webview showing plan summary, contract details, changed files.
- Buttons: "Approve", "Reject & comment", "Cancel task".
- Powered by LangGraph `interrupt()` — graph pauses until user decision.

**Diff Viewer:**
- Inline unified diff with syntax highlighting (`diff` library + custom React component).
- Toggle between unified diff and final file view.

---

## 8. Build Phases & Milestones

### Phase 1: Scaffold & Sidecar Bridge ✅
- [x] Initialize VS Code extension project with webview panel.
- [x] Create React webview with basic chat layout.
- [x] Implement sidecar spawner (fork) with WebSocket connection.
- [x] Establish two‑way communication: extension host ↔ webview ↔ sidecar.
- **Milestone:** User can type a message in chat and see an echo reply from the sidecar.

### Phase 2: Memory Core ✅
- [x] Set up Supabase project with `memories` table schema and RLS.
- [x] Store Supabase credentials in VS Code `SecretStorage`.
- [x] Implement sidecar Supabase client and client‑side hybrid search.
- [x] Create local SQLite cache and sync logic.
- [x] Implement memory retrieval with offline fallback.
- **Milestone:** Sidecar can retrieve relevant patterns for a query from cloud or local cache.

### Phase 3: Quick Mode Agent ✅
- [x] Define Implementation agent system prompt with tool loop.
- [x] Implement tool definitions (search_replace, read_file, execute_safe_bash, run_lint, check_git_diff) as WebSocket proxies.
- [x] Implement temp workspace creation in extension host.
- [x] Wire tool execution: extension host applies edits to temp workspace and returns output.
- [x] Stream agent thoughts and tool calls to webview; render `MessageCard` with diff.
- [x] Build accept/reject UI for final diff; apply to real workspace on accept.
- **Milestone:** User can give a simple task and see the diff applied after approval.

### Phase 3.5: OmniRoute Integration + Paid Provider Fallback ✅
- [x] Ping OmniRoute on startup, show connection status in UI.
- [x] Route chat completions through OmniRoute by default (model `auto`).
- [x] Toggle between OmniRoute and direct providers in chat UI.
- [x] Auto-fallback to direct providers (DeepSeek, OpenRouter, Mimo, etc.) when OmniRoute is down.
- [x] Store direct provider API keys in SecretStorage.
- **Milestone:** Ollopa uses OmniRoute's 290+ providers, with fallback to user's cheap paid keys.

### Phase 3.6: Skills & Plugins Ecosystem ✅
- [x] Plugin loader: scan `.ollopa/plugins/` directories, `require()` and validate.
- [x] Registries: tools, slash commands, hooks, providers.
- [x] Hot reload via `fs.watch` with 200ms debounce.
- [x] Plugin tools merged into agent function definitions; routed to plugin executors.
- [x] Slash commands (`/commit`, `/deploy`, etc.) available in chat with autocomplete.
- [x] Example plugins shipped: format-on-save, commit-message, groq-provider, omniroute-mcp-bridge.
- **Milestone:** User can create a `.ollopa/plugins/hello.js` file and use `/hello` immediately.

---

### Phase 4: LangGraph Task Mode with Embedded Principles (3–4 weeks) 🔄

**Merges old Phase 4 (Planning & Contract) + Phase 5 (Review & Retry) into a single LangGraph‑orchestrated pipeline with engineering principles embedded at every layer.**

#### 4.1 — Engineering Principles System
- [ ] Define the "principles card" for each agent role (Architect, Frontend, Backend, Implementation, Review).
- [ ] Update all agent system prompts to include the principles card.
- [ ] Update the Quick Mode Implementation agent prompt with the principles card (enhancement to Phase 3).
- [ ] Create the Review agent's principles audit checklist (KISS, DRY, YAGNI, SRP, Fail‑Fast, Security).
- [ ] Add principle‑attribution fields to Mistake & Repair capture (`violated_principles` array).

#### 4.2 — LangGraph State Machine
- [ ] Install `@langchain/langgraph` in the sidecar workspace.
- [ ] Define `TaskState` type: `{ messages, contract, retryCount, feedback, workspaceRoot, taskId, status, finalDiff, violatedPrinciples }`.
- [ ] Create `sidecar/src/agents/taskModeGraph.ts` with the full `StateGraph`:
  - `architectNode` — calls LLM (Architect persona with principles card), retrieves memories, outputs `.contract.json`.
  - `humanApprovalNode` — calls LangGraph `interrupt()` to pause execution; emits `plan_proposed` over WebSocket; resumes when extension host sends `plan_decision`.
  - `routerNode` — analyzes task + contract, returns `next: 'frontend' | 'backend' | 'implementation'`.
  - `workerNode` — runs tool‑using loop for the assigned role (reuses Quick Mode pattern but with role‑specific principles card).
  - `reviewNode` — runs review checks (contract hash, semgrep, principles audit), outputs `reviewResult: 'PASS' | 'FAIL'` with structured feedback and violated principles.

#### 4.3 — HITL Approval Protocol
- [ ] Extend WebSocket protocol: `plan_proposed { taskId, contract, planText, agent: 'architect' }`.
- [ ] Add `plan_decision { taskId, decision: 'approve' | 'reject', comment?: string }` inbound message.
- [ ] Webview `PlanApprovalModal` renders contract details, changed files list, and Approve/Reject/Comment buttons.
- [ ] On reject with comment, LangGraph routes back to `architectNode` with the comment as feedback (max 2 replans).

#### 4.4 — Review & Retry Loop
- [ ] Review agent calls `validate_contract` (hash comparison), `semgrep_scan`, `check_git_diff`, and `retrieve_memory` (type RULE).
- [ ] Review agent runs the principles audit checklist and outputs which principles passed/failed.
- [ ] On PASS: graph ends, `task_final_diff` emitted, user can apply changes.
- [ ] On FAIL: feedback injected into worker context; graph routes back to `workerNode`.
- [ ] Circuit breaker: max 3 retries; after final fail, Mistake & Repair capture triggers with principle attribution.

#### 4.5 — LangGraph Integration with Sidecar
- [ ] Wire the LangGraph graph into `sidecar/src/start.ts` — on `chat:send { mode: 'task' }`, create a new graph run.
- [ ] Graph runs share the existing WebSocket event bus for `tool_call`/`tool_output`, `agent_thought`, `task_final_diff`.
- [ ] LangGraph `interrupt()` awaits the `plan_decision` message from the extension host before resuming.
- [ ] Support concurrent graph runs (LangGraph natively supports multiple executions with different `config`).

#### 4.6 — Plugin Integration with Task Mode
- [ ] Plugin tools are available to all agent nodes (Architect, Worker, Review) via the merged tool registry.
- [ ] Plugin hooks (`onBeforeTool`, `onAfterTool`) fire for tool calls made by any agent node.
- [ ] Plugin slash commands remain available alongside Task Mode chat.

**Milestone:** A complex task like "Add pagination to the user list endpoint" triggers the full Architect → Approval → Worker → Review → Retry pipeline, with principles enforced at every step. The system catches contract violations, security issues, and principle breaches, retries up to 3 times, and captures mistakes with principle attribution for future learning.

---

### Phase 5: Safety & Sandboxing (1 week) 📋
*(Renumbered from old Phase 6)*
- [ ] Implement command whitelist in extension host with timeout and pattern bans (partially done in Phase 3).
- [ ] Enforce secret file blocking in `read_file` (partially done in Phase 3).
- [ ] Ensure temp workspace is always used; prevent direct edits to real workspace by agents.
- [ ] Integrate semgrep into review workflow (integrated in Phase 4 — verify completeness).
- **Milestone:** Agent cannot run dangerous commands or access .env files.

### Phase 6: Refinery & Self‑Improvement (2 weeks) 📋
*(Renumbered from old Phase 7)*
- [ ] Implement `raw_ingest_queue` insertion for Mistake & Repair (with principle attribution).
- [ ] Build distillation pipeline (Refinery) – run manually via command or on interval.
- [ ] Use GPT‑4o‑mini (or local Ollama) to distill mistakes into memories.
- [ ] Update memory lifecycle (Candidate → Elevated → Trusted).
- **Milestone:** After a failed task is retried, a new principle‑attributed memory appears in the knowledge base.

### Phase 7: Offline & Caching (1 week) 📋
*(Renumbered from old Phase 8)*
- [ ] Local SQLite cache for memories; sync on startup and timer.
- [ ] Offline ingestion queue for Mistake & Repair.
- [ ] Detection of online/offline state; graceful fallback.
- **Milestone:** Disable internet; the agent still retrieves relevant patterns from local cache.

### Phase 8: Multi‑Task & UI Polish (2 weeks) 📋
*(Renumbered from old Phase 9)*
- [ ] Support concurrent tasks (multiple tabs/chat sessions) with separate taskIds.
- [ ] Agent status sidebar shows per‑task progress.
- [ ] Task cancellation: sidecar kills LangGraph run, extension host deletes temp workspace.
- [ ] Tool output summarisation (if >1500 tokens, compress).
- [ ] Token budget enforcement (80% context window).
- [ ] Error handling: friendly messages instead of raw stack traces.
- **Milestone:** User can run two independent tasks simultaneously.

### Phase 9: Packaging & Documentation (1 week) 📋
*(Renumbered from old Phase 10)*
- [ ] Configure `vsce` package for extension.
- [ ] Write README, quick‑start guide, demo script.
- [ ] Record demo video showcasing Quick Mode, Task Mode with LangGraph, principles enforcement, plugin ecosystem.
- [ ] Publish to VS Code Marketplace (optional).
- **Milestone:** Extension installable from VSIX file, fully documented.

**Total estimated: ~15–17 weeks** for a fully polished, job‑ready portfolio project.

---

## 9. Phase Summary

| Phase | Status | Done | Total |
|-------|--------|------|-------|
| Phase 1: Scaffold & Sidecar Bridge | ✅ Complete | 5/5 | 5 |
| Phase 2: Memory Core | ✅ Complete | 5/5 | 5 |
| Phase 3: Quick Mode Agent | ✅ Complete | 6/6 | 6 |
| Phase 3.5: OmniRoute Integration | ✅ Complete | 10/11 | 11 |
| Phase 3.6: Skills & Plugins | ✅ Complete | 15/16 | 16 |
| Phase 4: LangGraph Task Mode + Principles | 🔄 In Progress | 0/19 | 19 |
| Phase 5: Safety & Sandboxing | 📋 Not Started | 0/4 | 4 |
| Phase 6: Refinery & Self‑Improvement | 📋 Not Started | 0/4 | 4 |
| Phase 7: Offline & Caching | 📋 Not Started | 0/4 | 4 |
| Phase 8: Multi‑Task & UI Polish | 📋 Not Started | 0/6 | 6 |
| Phase 9: Packaging & Documentation | 📋 Not Started | 0/4 | 4 |
| **Total** | | **41/84** | **84** |

---

## 10. Technical Stack

| Layer | Technology |
|-------|-----------|
| Extension host | TypeScript, VS Code Extension API |
| Webview UI | React 18, TypeScript, Vite, `@vscode/webview-ui-toolkit` |
| Sidecar orchestrator | Node.js 20+, LangGraph.js (Task Mode), OpenAI‑compatible client (OmniRoute), `ws` |
| Memory DB (cloud) | Supabase (PostgreSQL + pgvector) |
| Local cache | `better-sqlite3` |
| Credentials storage | VS Code `SecretStorage` |
| Diff display | `diff` npm package + custom React component |
| Linting/Security | semgrep, ESLint (project‑specific) |
| Plugin system | Node.js `require()`, `fs.watch` hot reload |
| Build/packaging | webpack, vsce |

---

*End of blueprint.*