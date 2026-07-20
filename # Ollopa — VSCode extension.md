# Ollopa — AI Coding Platform for VS Code

## Blueprint & System Design

> **Tagline:** *Code once. Remember forever. Improve autonomously.*
> **Target:** A VS Code extension that provides a chat‑centric, multi‑agent AI coding assistant with a persistent, self‑improving memory.

---

## 1. Core Principles

* **Local‑first, cloud‑augmented:** All agent logic, tool execution, and file editing happen locally. Only the knowledge base (memories) is synced to the cloud (Supabase).
* **Chat‑centric interface:** A dedicated side‑panel webview hosts the entire interaction—message stream, tool calls, diffs, and approvals—seamlessly integrated into the VS Code workbench.
* **Memory that improves:** Every mistake is captured, distilled, and stored. The system learns your codebase’s conventions and anti‑patterns over time.
* **Safe by design:** Contract‑driven development, isolated file workspaces, whitelisted shell commands, and deterministic security checks (semgrep) prevent agents from causing harm.
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
│  · LangGraph.js orchestrator (agent state machine)                  │
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
- **WebSocket bridge:** Connects to the sidecar’s WebSocket server. Relays messages between webview and sidecar, translating webview `postMessage` to WebSocket frames and vice versa.
- **Command execution:** Intercepts tool calls that require VS Code integration:
  - `search_replace` → `WorkspaceEdit` to apply changes to the temporary workspace folder.
  - `execute_safe_bash` → spawns command in a dedicated VS Code Terminal, captures output, and enforces whitelist before execution.
  - `check_git_diff` → uses VS Code’s built‑in Git extension API to get diff for the temp workspace.
  - `secure_read_file` → reads from the temp workspace via `vscode.workspace.fs`.
- **Diagnostics:** Feeds lint output (`run_lint`) into VS Code’s Problems panel.
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
  - “Apply” / “Reject” buttons for Quick Mode edits.
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

A standalone Node.js process (no npm dependencies outside its own folder) that runs the AI agent logic.

**Stack:** TypeScript, LangGraph.js, OpenAI/OpenRouter SDK, Supabase JS client, `better-sqlite3` (for local cache), `ws` (WebSocket server).

**Startup:**
1. Reads `OLLOPA_PORT` and `SUPABASE_*` env vars.
2. Connects to Supabase; initializes local SQLite cache.
3. Starts WebSocket server on the assigned port.
4. Emits `ready` status to extension host.

**Agent Graph:** A LangGraph state machine:
- **Quick Mode path:** User task → Implementation agent (single node) with loop for tool use.
- **Task Mode path:** User task → Architect (plan + contract) → [Frontend | Backend | Implementation] → Review → [retry up to 3 times] → End.

**Internal modules:**
- `server.ts` – WebSocket message handler, task lifecycle.
- `agents/` – system prompts, function definitions for each agent.
- `tools/` – implementations (but actual execution is delegated back to the extension host via the WebSocket bridge – the sidecar sends `tool_call` and the extension host executes it, returning the output). So the sidecar defines tools as “placeholders” that the LangGraph LLM calls, and the sidecar emits `tool_call` events over WS, waits for `tool_output` reply, then continues the graph.
- `memory/` – Supabase client, hybrid search RPC call, local SQLite cache for offline retrieval, sync logic.
- `refinery/` – distillation pipeline (triggered manually or on a timer).

### 3.4 Memory System

**Unified `memories` table (Supabase):**
- Columns: `id`, `title`, `content` (2‑sentence distillation), `scope`, `status`, `source` (SEED/REFINERY), `quality_score`, `performance_score`, `agent`, `tags`, `category`, `code_block`, `use_when`, `avoid_when`, `embedding` (1536‑d), `tsv` (full‑text search vector), timestamps.
- Hybrid search RPC: `match_memories(query_embedding, query_text, scope, limit)` returns top‑N results with a combined score (vector 40%, FTS 25%, tags 20%, performance 10%, quality 5%).

**Local SQLite cache (`~/.ollopa/memory_cache.db`):**
- Mirrors the most recently used and highest‑scored memories from Supabase.
- On first run or after sync, pulls down `Trusted` + `Elevated` + top 100 `Candidate` memories.
- Synchronizes periodically (every 30 min) or manually.
- For offline use, retrieval checks local cache first; only goes to Supabase if online and cache miss.

**Ingestion & Refinery:**
- Mistake & Repair captures fail data → writes to `raw_ingest_queue` via Supabase (or local queue if offline).
- The Refinery (a function in the sidecar) runs:
  - Manually via command “Ollopa: Run Refinery”.
  - On a schedule (e.g., every 30 min if online).
  - Distillation: uses a fast model (GPT‑4o‑mini or local Ollama) to extract 2‑sentence insight, assign scope/tags, score.
  - Deduplication via embedding cosine similarity.
  - Inserts new Candidate memory into Supabase and updates local cache.

### 3.5 Tool Definitions

Tools are defined in the sidecar with JSON Schema for the LLM, but their execution is proxied to the extension host.

| Tool | Description | Sidecar action |
|------|-------------|----------------|
| `search_replace` | Replace old_str with new_str in a file (exact match) | Emits `tool_call` with file path (relative to workspace root), old_str, new_str. Extension host applies edit to temp workspace. |
| `read_file` | Read a file’s contents (excluding .env, secrets) | Emits `tool_call`; extension host reads from temp workspace and returns content. |
| `execute_safe_bash` | Run a whitelisted shell command | Extension host validates command against whitelist, runs in temp workspace directory, returns combined stdout/stderr. |
| `run_lint` | Run linter on changed files | Extension host runs `npx eslint <files>` (or project’s linter), returns output. |
| `check_git_diff` | Show current uncommitted changes in workspace | Extension host uses Git API on temp workspace, returns unified diff. |
| `semgrep_scan` | Run semgrep on changed files (used by Review) | Extension host executes `npx semgrep --config auto <files>`, returns findings. |
| `retrieve_memory` | Semantic search in knowledge base | Sidecar handles this internally using memory service; not proxied. |
| `define_contract` | Creates `.contract.json` in temp workspace | Sidecar produces JSON, sends to extension host to write file. |

All file‑modifying tools operate on a **temporary workspace** (a copy of the project folder created when a task starts) to avoid polluting the real code until the user approves the final diff.

### 3.6 Agent Team

| Agent | Scope | Temp | Key System Prompt Excerpt | Tools |
|-------|-------|------|---------------------------|-------|
| **Architect** (Task Mode) | architecture | 0.0 | Plans approach, delegates to worker, writes contract. Must not generate code directly. | `retrieve_memory`, `define_contract`, `read_file` (limited to config files) |
| **Frontend** | frontend | 0.05 | Senior UI engineer. Uses React/Vue/Svelte patterns. Banned: purple gradients, glassmorphism, centered heroes (project‑configurable). | `search_replace`, `read_file`, `execute_safe_bash`, `run_lint` |
| **Backend** | backend | 0.0 | Senior backend. Enforces SQL injection prevention, proper error handling. | `search_replace`, `read_file`, `execute_safe_bash`, `run_lint` |
| **Implementation** | general | 0.0 | Code executor. Follows specs exactly; does not redesign. | `search_replace`, `read_file`, `execute_safe_bash`, `run_lint` |
| **Review** | architecture | 0.0 | Read‑only auditor. Validates contract hash, checks semgrep, diff scope, and rules from memory. Returns structured PASS/FAIL. | `check_git_diff`, `semgrep_scan`, `retrieve_memory` (type RULE), `validate_contract` (internal function) |

---

## 4. Data Flows

### 4.1 Basic Task Execution (Quick Mode)

1. User types task, toggles Quick mode, presses Enter.
2. Webview sends `{type: 'task', mode: 'quick', task: "Add a health endpoint"}` via `postMessage`.
3. Extension host forwards it over WebSocket to sidecar.
4. Sidecar creates a new `taskId`, copies the workspace to a temp folder (managed by extension host).
5. Sidecar runs LangGraph with the Implementation agent, which may call tools.
6. For each tool call, sidecar emits `tool_call` → extension host executes on temp workspace and replies with `tool_output`.
7. All intermediate steps are streamed to webview (tool cards, diffs).
8. When agent finishes, sidecar emits `task_final_diff` with the diff between original workspace and temp workspace.
9. Webview shows diff; user can accept/reject each file change.
10. Accepting triggers `apply_diff` command: extension host applies the changes to the real workspace and discards the temp copy.

### 4.2 Task Mode (with Contract & Review)

Same steps as above, but:
- Sidecar first runs Architect → produces `.contract.json`.
- `plan_proposed` event sent to webview → user sees approval modal.
- On Approve, sidecar proceeds to worker; on Reject (with optional comment), Architect replans (max 2 times).
- After worker, Review agent validates diff against contract, runs semgrep, and emits PASS/FAIL.
- On FAIL, the error is sent back to worker (with feedback) for retry (max 3 cycles). The full interaction (bad diff, feedback, fix) is captured.

### 4.3 Mistake & Repair Capture

Only on FAIL after Review:
1. Sidecar stores a record in `raw_ingest_queue` with:
   - `task_id`, `bad_diff`, `review_feedback`, `corrected_diff` (if retry succeeds), `timestamp`.
2. The Refinery later distills this into a memory and stores it in Supabase.
3. The new memory becomes available for future tasks.

### 4.4 Offline Flow

- If Supabase is unreachable, memory retrieval uses local SQLite cache.
- Mistake & Repair records are queued in a local SQLite table (`offline_ingest`).
- When connection resumes, sidecar syncs queued records to Supabase, triggers refinery, and pulls updated memories.

---

## 5. Security Model

- **Credentials:** Supabase anon key stored in VS Code `SecretStorage` (never on disk).
- **Database role:** A dedicated Postgres role with only `SELECT`, `INSERT`, `UPDATE` on `memories` and `raw_ingest_queue`. No DROP/DELETE/ALTER. Sensitive operations (promotion to Trusted) use SECURITY DEFINER functions with elevated permissions server‑side.
- **File isolation:** All agent edits happen in a temp directory copied from the workspace. Real files are only touched after user approval.
- **Command whitelist:** `execute_safe_bash` validates against a JSON config:
  ```json
  {
    "allowed_commands": {
      "npm": ["install", "test", "run lint", "run build"],
      "npx": ["eslint", "semgrep"],
      "git": ["status", "diff", "add", "commit"]
    },
    "banned_patterns": ["curl", "wget", "sudo", "rm -rf /", "/etc/"],
    "max_timeout_sec": 30
  }
  ```
- **Secrets protection:** `read_file` blocks access to files matching patterns: `.env`, `*.pem`, `*secret*`, `credentials.*`.
- **Contract enforcement:** `validate_contract` (internal sidecar function) hashes the final diff and compares with the contract; touching unlisted files → FAIL.
- **Semgrep integration:** Review agent runs semgrep on changed files; any critical findings → FAIL.

---

## 6. UI/UX Design (Webview)

**Three‑column layout:**
- **Left sidebar (240px, collapsible):**
  - Agent status list (per active task): pulse dot + label.
  - Quick filters for memory categories.
- **Center – Chat (flex):**
  - Scrollable message list.
  - Each message card is color‑coded by agent.
  - Tool calls are rendered as collapsible accordions with the diff output highlighted.
  - Input area at bottom with mode toggle (Quick/Task), model selector, send button.
- **Right sidebar (260px, collapsible):**
  - Context files tab: list of open files in workspace.
  - Git tab: staged/unstaged changes.
  - Memory tab: list of memories retrieved for current task.

**HITL Approval Modal:**
- Full‑screen overlay in webview showing plan summary, contract details, changed files.
- Buttons: “Approve”, “Reject & comment”, “Cancel task”.

**Diff Viewer:**
- Inline unified diff with syntax highlighting (using `diff` library and a custom React component).
- Toggle to view final file state.

---

## 7. Agent Workflow in Detail

### Quick Mode
```
UserInput → ImplementationAgent (with tools loop) → final diff → user accept/reject
```
- No planning, no contract, no review.
- Agent acts as a senior dev who can make edits and run tests.
- Safety still enforced: temp workspace, bash whitelist, semgrep optional (user can run it manually).

### Task Mode
```
UserInput → Architect (plan + contract) → HITL Approval
    → Router → Worker (Frontend/Backend/Implementation)
        → Review
            ├── PASS → final diff → user apply
            └── FAIL → worker retry (with feedback) up to 3 times
                └── after final FAIL → task fails, error message
```
- On first FAIL, the Mistake & Repair hook captures the interaction for distillation.
- Plan rejection allows one revision cycle.

---

## 8. Mistake & Repair Loop (Technical)

After a Review FAIL (and before retry or final fail):
1. The sidecar collects:
   - `bad_diff`: diff before fix.
   - `feedback`: Review agent’s structured feedback.
   - `corrected_diff`: diff after successful retry (if any), or null if final fail.
2. This is stored in `raw_ingest_queue` with status `PENDING_DISTILL`.
3. The Refinery, on its next run, processes this record:
   - Calls a distillation LLM (GPT‑4o‑mini) with prompt: “Distill the following mistake into a 2‑sentence engineering pattern: …”
   - Checks for duplicates (embedding similarity) before inserting as Candidate memory.
4. Over time, these memories improve agent performance.

---

## 9. Offline & Caching Strategy

- **Memory retrieval:** First checks local SQLite cache (fast). If no match, and online, calls Supabase RPC and caches result.
- **Offline ingestion:** Mistake & Repair records queued in local SQLite, synced when online.
- **Refinery offline:** Refinery requires LLM; can use a locally running Ollama model (configurable) if available, otherwise queues distillation until online.
- **Supabase sync:** On extension activation and every 30 min, pulls updated high‑score memories from Supabase and updates local cache.

---

## 10. Build Phases & Milestones

### Phase 1: Scaffold & Sidecar Bridge (2 weeks)
- [ ] Initialize VS Code extension project with webview panel.
- [ ] Create React webview with basic chat layout (input, message list).
- [ ] Implement sidecar spawner (fork) with WebSocket connection.
- [ ] Establish two‑way communication: extension host ↔ webview ↔ sidecar.
- [ ] Implement `webviewProvider` and `sidecarManager`.
- **Milestone:** User can type a message in chat and see an echo reply from the sidecar.

### Phase 2: Memory Core (1 week)
- [ ] Set up Supabase project with `memories` table schema, RLS, and hybrid search RPC.
- [ ] Store Supabase credentials in VS Code `SecretStorage`.
- [ ] Implement sidecar Supabase client and `match_memories` call.
- [ ] Create local SQLite cache and sync logic.
- [ ] Implement memory retrieval with offline fallback.
- **Milestone:** Sidecar can retrieve relevant patterns for a hardcoded query.

### Phase 3: Quick Mode Agent (3 weeks)
- [ ] Define Implementation agent system prompt and LangGraph state machine (single node with tool loop).
- [ ] Implement tool definitions (search_replace, read_file, execute_safe_bash, run_lint, check_git_diff) as WebSocket proxies.
- [ ] Implement temp workspace creation in extension host (copy folder).
- [ ] Wire tool execution: extension host applies edits to temp workspace, runs bash, etc., and returns output.
- [ ] Stream agent thoughts and tool calls to webview; render `MessageCard` with diff.
- [ ] Build accept/reject UI for final diff; apply to real workspace on accept.
- **Milestone:** User can give a simple task like “rename function foo to bar” and see the diff applied after approval.

### Phase 4: Task Mode – Planning & Contract (2 weeks)
- [ ] Architect agent: prompt, ability to call `define_contract`.
- [ ] Plan approval modal in webview with contract details.
- [ ] Implement plan rejection flow with comment → re‑plan (max 2).
- [ ] Router logic: select Frontend/Backend/Implementation based on task.
- **Milestone:** Complex task triggers a plan that the user must approve before code changes.

### Phase 5: Task Mode – Review & Retry (2 weeks)
- [ ] Review agent: system prompt, `validate_contract` (internal), `check_git_diff`, `semgrep_scan`.
- [ ] Retry loop: on FAIL, inject feedback into worker context, reset temp workspace to pre‑edit state.
- [ ] Circuit breaker: max 3 retries, then task fails.
- [ ] Capture Mistake & Repair on FAIL.
- **Milestone:** The system catches an intentional contract violation, retries, and eventually succeeds or fails gracefully.

### Phase 6: Safety & Sandboxing (1 week)
- [ ] Implement command whitelist in extension host with timeout and pattern bans.
- [ ] Enforce secret file blocking in `read_file`.
- [ ] Ensure temp workspace is always used; prevent direct edits to real workspace by agents.
- [ ] Add semgrep to review workflow.
- **Milestone:** Agent cannot run dangerous commands or access .env files.

### Phase 7: Refinery & Self‑Improvement (2 weeks)
- [ ] Implement `raw_ingest_queue` insertion for Mistake & Repair.
- [ ] Build distillation pipeline (Refinery) – run manually via command or on interval.
- [ ] Use GPT‑4o‑mini (or local Ollama) to distill mistakes into memories.
- [ ] Update memory lifecycle (Candidate → Elevated → Trusted).
- **Milestone:** After a failed task is retried, a new memory appears in the knowledge base.

### Phase 8: Offline & Caching (1 week)
- [ ] Local SQLite cache for memories; sync on startup and timer.
- [ ] Offline ingestion queue for Mistake & Repair.
- [ ] Detection of online/offline state; graceful fallback.
- **Milestone:** Disable internet; the agent still retrieves relevant patterns from local cache.

### Phase 9: Multi‑Task & UI Polish (2 weeks)
- [ ] Support concurrent tasks (multiple tabs/chat sessions) with separate taskIds.
- [ ] Agent status sidebar shows per‑task progress.
- [ ] Task cancellation: sidecar kills LangGraph run, extension host deletes temp workspace.
- [ ] Tool output summarisation (if >1500 tokens, compress).
- [ ] Token budget enforcement (80% context window).
- [ ] Error handling: friendly messages instead of raw stack traces.
- **Milestone:** User can run two independent tasks simultaneously.

### Phase 10: Packaging & Documentation (1 week)
- [ ] Configure `vsce` package for extension.
- [ ] Write README, quick‑start guide, demo script.
- [ ] Record demo video.
- [ ] Publish to VS Code Marketplace (optional).
- **Milestone:** Extension installable from VSIX file, fully documented.

**Total estimated: ~16–18 weeks** (4 months) for a fully polished, job‑ready portfolio project.

---

## 11. Technical Stack

| Layer | Technology |
|-------|-----------|
| Extension host | TypeScript, VS Code Extension API |
| Webview UI | React 18, TypeScript, Vite, `@vscode/webview-ui-toolkit` |
| Sidecar orchestrator | Node.js 20+, LangGraph.js, OpenAI / OpenRouter SDK, `ws` |
| Memory DB (cloud) | Supabase (PostgreSQL + pgvector) |
| Local cache | `better-sqlite3` |
| Credentials storage | VS Code `SecretStorage` |
| Diff display | `diff` npm package + custom React component |
| Linting/Security | semgrep, ESLint (project‑specific) |
| Build/packaging | webpack, vsce |

---

*End of blueprint.*