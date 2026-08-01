# Ollopa Chimera Enhancement — Phase Checklists

Source: `# Ollopa — VSCode extension.md` (line 615+, "Ollopa Chimera Enhancement Plan")

Status legend: ✅ done · 🟡 partial / shipped minimally · ⬜ not started · 🚫 deferred

---

## Phase 1 — Enhanced Agent Autonomy (4–6 weeks)

Inspired by Claude Code. Goal: handle complex, multi-step tasks autonomously. **Status: ✅ done**

### 1A. Enhanced TaskModeGraph
- [✅] Add `failurePattern` slot to `TaskState` (array of strings, capped at 5)
- [✅] Add `lastErrorKind` annotation to `TaskState` for pattern lookup
- [✅] Pass `failurePattern` and `lastErrorKind` into worker system prompt
- [✅] Architect: when `state.feedback` non-empty, surface prior contract + prompt for changed-steps-only re-emit
- [✅] Architect: add `riskMitigations` field to `Contract` (mapping risk→step index)
- [✅] Router: read `contract.riskMitigations`, skip steps already proven (`executedSteps` + `skipSteps` reducer slots)

### 1B. Autonomous Error Recovery
- [✅] Classify worker errors: 10 `ErrorKind` values
- [✅] Map each error kind → recovery hint appended to worker prompt
- [✅] `bumpRetry` classifies error message and updates `lastErrorKind` + `failurePattern`
- [✅] Review FAIL path classifies feedback (semgrep_critical vs generic)
- [✅] Tool-call error path classifies inline
- [✅] Exponential backoff on worker retry (1s → 2s → 4s, capped at 4s) in `bumpRetry`
- [🚫] On `semgrep_critical` retry, narrow scan scope to the flagged `file:line` — semgrep is review-only (Phase 5A); worker doesn't run it
- [✅] On `lint_fail`, surface the first ESLint error line verbatim in `failurePattern`

### 1C. Extended Tool Usage
- [✅] `move_file` (src, dst, overwrite) — verifies `dst` not secret
- [✅] `batch_search_replace` (edits[]) — atomic, fail-fast on first non-unique
- [✅] `list_files` (pattern) — read-only, returns workspace-relative paths
- [✅] `run_tests` — whitelist `npm test`, `npx jest`, `npx vitest` (5 min timeout)
- [✅] `secrets_scan` — regex sweep for AWS/JWT/GH tokens (cheap pre-check)
- [✅] Registered in `tools/definitions.ts`, `BUILTIN_TOOLS`, `TOOL_NAMES`

### 1D. Files
- [✅] `sidecar/src/agents/taskModeGraph.ts` — state slots, retry hints
- [✅] `sidecar/src/agents/errorClassifier.ts` (new)
- [✅] `sidecar/src/tools/definitions.ts` — 5 new tool schemas
- [✅] `extension/src/toolBridge.ts` — 5 new handlers + register
- [✅] `extension/src/commandWhitelist.ts` — added `npx jest`, `npx vitest`
- [✅] `sidecar/test/errorClassifier.ts` — 21/21 pass

### 1E. Verification
- [✅] Unit test: `classifyError` covers all 10 kinds (21/21)
- [✅] Hint smoke check: every kind has non-empty hint
- [✅] Full project type-check clean (`tsc --noEmit`)
- [✅] All pre-existing sidecar tests still pass
- [🚫] Manual: 5-step task force-fail + semgrep retry — deferred (needs live LLM, no script harness)
- [🚫] Manual: `move_file` on `.env` refused — deferred (needs live extension host)

### 1F. Done When
- [✅] Worker retries with targeted hints, not blind re-runs
- [✅] 5 new tools available to LLM
- [✅] No new external deps, no new boundaries, existing tests still pass

---

## Phase 2 — IDE-Integrated Editing Experience (3–5 weeks)

Inspired by Cursor. Goal: seamless AI editing inside VS Code. **Status: 🟡 partial — 2B done, 2A/2C deferred**

### 2A. Enhanced Tab Completion  🚫
- [🚫] Design `getCompletions(uri, position, prefix)` extension command
- [🚫] Cache last LLM completion per file/position (TTL 5s)
- [🚫] Render ghost text via `vscode.InlineCompletionItem`

### 2B. Inline AI Assistance  ✅
- [✅] `explainSelection` command — sends selected text to sidecar, returns markdown
- [✅] `refactorSelection` command — returns refactored code in code block, applies via `editor.edit`
- [✅] Sidecar request kind `inline_request` + reply `inline_reply`
- [✅] Sidecar handler `handleInlineRequest` — small `chatCompletion` call, no tools
- [✅] 8 KB selection cap, progress notification, side-by-side result doc
- [✅] Registered in `package.json` contributes.menus + keybindings (`ctrl+shift+e`, `ctrl+shift+r`)
- [✅] Wired via `registerInlineCommands` in `extension.ts`

### 2C. Visual Multi-file Editing  🚫
- [🚫] Plan-mode webview already shows diff — add side-by-side toggle
- [🚫] "Edit step" affordance: rewind to a prior worker turn, re-emit from there
- [🚫] `vscode.Diff` editor for any 2 snapshots of the same file

### 2D. Files
- [✅] `extension/src/inlineActions.ts` (new)
- [✅] `sidecar/src/start.ts` — `inline_request` / `inline_reply` kinds + handler
- [✅] `extension/src/extension.ts` — wired `registerInlineCommands`
- [✅] `extension/package.json` — commands, keybindings, editor/context menus
- [🚫] `webview/src/` — side-by-side diff component

### 2E. Done When
- [✅] Explain/refactor commands work from context menu and keybinding
- [🚫] Inline completion appears within 300ms of typing pause
- [🚫] Side-by-side diff renders without layout shift

---

## Phase 3 — Real-time Web Integration (3–4 weeks)

Inspired by Windsurf. Goal: agents can fetch current docs and examples. **Status: ✅ done**

### 3A. Web Search Tool  ✅
- [✅] `web_search` tool — query, returns top-N results (title, url, snippet)
- [✅] Default backend: DuckDuckGo HTML (no API key)
- [✅] Configurable via `ollopa.searchBackend` setting (DuckDuckGo today)
- [✅] Cache results in `memoryService` keyed by query hash (TTL 1 day, `web_cache` table)

### 3B. Documentation Fetching  ✅
- [✅] `fetch_url` tool — GET a URL, strip HTML to text via tiny `htmlToText`, cap at 50KB
- [✅] Cache by URL hash (TTL 1 week)
- [✅] Domain whitelist via `ollopa.web.allowedDomains` (default: MDN, nodejs, devdocs, github, SO, wikipedia)

### 3C. Real-time API Assistance  ✅
- [✅] `lookup_api` tool — given a library name + method, return current docs (via search + top-result fetch)
- [✅] `lookup_example` tool — query `"{lib} {method} example github OR site:stackoverflow.com"`

### 3D. Files
- [✅] `sidecar/src/tools/definitions.ts` — 4 new tools added
- [✅] `sidecar/src/tools/webSearch.ts` (new) — search + fetch + htmlToText
- [✅] `sidecar/src/memory/localCache.ts` — `web_cache` table + `getWebCache`/`putWebCache`/`pruneWebCache`
- [✅] `sidecar/src/agents/taskModeGraph.ts` — `SIDECAR_LOCAL_TOOLS` set + `runSidecarLocalTool` (web tools run sidecar-side, no extension round-trip)
- [✅] `extension/package.json` — `ollopa.searchBackend`, `ollopa.web.allowedDomains`
- [✅] `extension/src/sidecarManager.ts` — env forwarding
- [✅] `sidecar/test/webSearch.ts` — 11/11 pass

### 3E. Done When
- [✅] Network errors do not break the graph — classifyError maps them
- [✅] Cache hit on repeat query returns from `web_cache` (lazy-evict on TTL expiry)
- [🚫] Worker can find current Node `fs.promises` signature — deferred (needs live LLM, no scripted test)

---

## Phase 4 — Enhanced Provider Flexibility (2–3 weeks)

Inspired by Cursor. Goal: per-task LLM selection. **Status: ✅ done (4.5 UI deferred)**

### 4A. Model Selection UI  🚫
- [🚫] Webview panel: dropdown of configured providers × models
- [✅] Sidecar exposes `list_providers` request so the webview can enumerate
- [🚫] Per-task chip in task header — webview React, deferred

### 4B. Provider Abstraction Layer  ✅
- [✅] `sidecar/src/llm/providerRegistry.ts` (new) — `ProviderAdapter` interface + registry
- [✅] Built-ins: `openai-compatible`, `ollama` (anthropic reserved)
- [✅] `chatWithRouter` dispatches via the registry

### 4C. Custom Model Endpoints  ✅
- [✅] Settings: `ollopa.directProviders[]` now includes `kind` field
- [✅] Ollama adapter handles `http://localhost:11434` (no `/v1`) and `http://localhost:11434/v1`
- [✅] SecretStorage for API keys (unchanged)
- [✅] Default `ollama-local` entry in `directProviders`

### 4D. Per-task Override + Fallback Chain  ✅
- [✅] `chatClient.setProviderOverride(name)` — process-global pin
- [✅] Sidecar inbound `provider_override { taskId, provider }` — flips override mid-session
- [✅] `ollopa.fallbackChain` setting — ordered list of provider NAMES tried after primary
- [✅] Empty fallbackChain = use declared `directProviders` order

### 4E. Files
- [✅] `sidecar/src/llm/providerRegistry.ts` (new)
- [✅] `sidecar/src/llm/providerRouter.ts` — registry dispatch + `pickOrder` + `overrideProvider`
- [✅] `sidecar/src/llm/chatClient.ts` — `setProviderOverride` / `getProviderOverride`
- [✅] `sidecar/src/credentials.ts` — `fallbackChain` field
- [✅] `sidecar/src/start.ts` — `provider_override` + `list_providers` inbound kinds
- [✅] `extension/package.json` — `kind` in `directProviders`, `ollopa.fallbackChain`
- [✅] `extension/src/sidecarManager.ts` — `OLLOPA_FALLBACK_CHAIN` env forwarding
- [✅] `extension/src/extension.ts` — config-change hook for `fallbackChain`
- [✅] `sidecar/test/providerRegistry.ts` — 14/14 pass

### 4F. Done When
- [✅] User can switch from OpenAI-compatible to Ollama in one config edit
- [✅] Fallback chain: primary → secondary if primary fails
- [✅] Per-call override short-circuits the chain (one call, one provider)
- [🚫] Per-task chip in the webview — data layer ready, UI deferred

---

## Phase 5 — Enhanced Security Features (2–3 weeks)

Inspired by CodeWhisperer. Goal: proactive security in the loop. **Status: ✅ done (5B diff highlighting deferred)**

### 5A. Integrated Security Scanning
- [✅] `secrets_scan` tool exists (Phase 1 stub — regex sweep, no ML)
- [🚫] `semgrep_scan` remains review-only (expensive; worker doesn't need to run it)
- [✅] `security_scan` node runs after worker, before review — regex sweep over worker snapshots (AWS, GitHub PAT, Slack, JWT, private-key block) → stored in `securityFindings.secrets`

### 5B. Real-time Security Feedback
- [🚫] Diff viewer line highlighting (webview side — deferred)
- [✅] Review FAIL short-circuits on any secret hit, with file:line summary in feedback
- [✅] Retry path inherits the security feedback via existing `reviewFeedback` slot

### 5C. License Compliance
- [✅] `license_check` tool — `npm view` per dep, glob match against forbidden list
- [✅] `ollopa.licenseCheck.forbidden` setting + `OLLOPA_FORBIDDEN_LICENSES` env forwarding
- [✅] Post-worker license scan on `state.workspaceRoot`; forbidden hits → review FAIL
- [✅] LLM can also call `license_check` tool inline via the `SIDECAR_LOCAL_TOOLS` path

### 5D. Files
- [✅] `sidecar/src/tools/licenseCheck.ts` (new) — checkWorkspaceLicenses / formatLicenseResults / isLicenseForbidden / getForbiddenLicenses / matchGlob
- [✅] `sidecar/src/tools/definitions.ts` — `license_check` tool schema
- [✅] `sidecar/src/agents/taskModeGraph.ts` — `security_scan` node + edges + `securityFindings` reducer + `runSidecarLocalTool` extended with `license_check` handler
- [✅] `extension/package.json` — `ollopa.licenseCheck.forbidden` (defaults: AGPL-*, SSPL*, BUSL-*, Commons-Clause)
- [✅] `extension/src/sidecarManager.ts` — forwards `OLLOPA_FORBIDDEN_LICENSES`
- [✅] `sidecar/test/licenseCheck.ts` (new) — 19/19 pass

### 5E. Done When
- [✅] A hard-coded AWS key in a diff is caught before user review (regex sweep fails review, retries worker with feedback)
- [✅] An AGPL dep is reported via `license_check` and fails review when forbidden

---

## Phase 6 — Privacy-First Options (2–3 weeks)

Inspired by Tabnine. Goal: air-gapped operation. **Status: ✅ done (llama.cpp adapter deferred)**

### 6A. Local-only Mode
- [✅] Setting `ollopa.privacy.localOnly: boolean` (default false) — forwarded as `OLLOPA_LOCAL_ONLY` env
- [✅] Sidecar: web tools (`web_search`, `fetch_url`, `lookup_api`, `lookup_example`) refuse + return a blocked message when localOnly is on
- [✅] Sidecar: router skips OmniRoute and any non-Ollama direct provider when localOnly is on
- [✅] Webview: `PrivacyBanner.tsx` shows `Local-only mode — cloud features are disabled` (red variant)
- [✅] Audit log: every refused call appended to `~/.ollopa/audit.log` (override `OLLOPA_AUDIT_LOG`)

### 6B. On-premises Model Support
- [✅] Ollama provider works (Phase 4)
- [🚫] `llama.cpp` adapter — YAGNI today; Ollama + OpenAI-compatible shim covers it
- [🚫] GPU/RAM detection — `ollama ps` from CLI covers this; no in-app call needed
- [✅] `docs/local-llm.md` — setup walkthrough

### 6C. Enhanced Privacy Controls
- [✅] `ollopa.privacy.redactSecrets: boolean` (default true) — mask secrets before sending to LLM
- [✅] `redactSecrets(text)` covers AWS, GitHub PAT, Slack, JWT, private-key block
- [✅] `applyPrivacy()` walks `ChatMessage[]` at every `chatCompletion` call site (worker, architect, review, inline)
- [✅] Audit log records `payload_redacted` with byte count

### 6D. Files
- [✅] `sidecar/src/audit/auditLog.ts` (new) — append-only JSON-lines, redactSecrets, 10MB rotation
- [✅] `sidecar/src/privacy/privacy.ts` (new) — env-driven single source of truth
- [✅] `sidecar/src/agents/taskModeGraph.ts` — localOnly guard in `runSidecarLocalTool`, `applyPrivacy()` at 3 LLM sites
- [✅] `sidecar/src/llm/providerRouter.ts` — localOnly drops non-Ollama providers with audit per skip
- [✅] `sidecar/src/start.ts` — `applyPrivacy()` in inline request handler; emits `privacy_status` on WS connect
- [✅] `extension/package.json` — `ollopa.privacy.localOnly`, `ollopa.privacy.redactSecrets`
- [✅] `extension/src/sidecarManager.ts` — env forwarding
- [✅] `extension/src/webviewProvider.ts` — `privacy_status` Inbound variant + sidecar→webview mapping
- [✅] `webview/src/PrivacyBanner.tsx` (new) — banner component
- [✅] `webview/src/App.tsx` — `privacy` state + `case 'privacy_status'` + render banner
- [✅] `webview/src/styles.css` — `.privacy-banner` + `.privacy-banner--strict`
- [✅] `webview/src/global.d.ts` — `privacy_status` Inbound variant
- [✅] `docs/local-llm.md` (new) — setup walkthrough
- [✅] `sidecar/test/privacy.ts` (new) — 20/20 pass

### 6E. Done When
- [✅] In local-only mode, all network calls are blocked + logged (web tools + cloud providers)
- [✅] Audit log shows redaction working on a sample secret payload (covered in tests)

---

## Phase 7 — Collaboration and Sharing Features (3–4 weeks)

**Status: ✅ done (7A deferred — no marketplace index)**

### 7A. Enhanced Plugin Marketplace
- [🚫] `rating`, `reviewCount`, `downloadCount` — no browse-able marketplace index yet; direct npm/github/git install only. YAGNI without an index to populate.
- [🚫] Marketplace UI sort/filter — same reason
- [🚫] `privateRepos` — no concrete ask; settings schema is in place if needed

### 7B. Team Knowledge Sharing
- [🚫] `team memory` scope — Supabase org concept not yet defined
- [✅] Export skill as `.skill.json` (manifest + content)
- [✅] Import skill via paste (textbox) or `import_skill` RPC; lands under `~/.ollopa/plugins/imported-<name>@0.0.0-imported/`
- [✅] Round-trip: export → import → re-export is lossless

### 7C. Version Control for Plugins
- [✅] Semver enforcement — `manifest.ts` already rejects plugins without valid semver (caught at install)
- [🚫] Auto-changelog — would need git hook wiring + a plugin-authoring convention; not asked for
- [✅] `plugin.lock.json` (`plugins.lock.json`) — written after each install; `marketplaceRoot()` + `loadLockFile()` + `saveLockFile()` in place since Phase 10

### 7D. Files
- [✅] `sidecar/src/plugins/skillExport.ts` (new) — `exportSkill` / `parseBundle` / `importSkillBundle` / `importSkillFile`
- [✅] `sidecar/src/start.ts` — `export_skill` / `import_skill` / `list_skills` inbound kinds + dispatch + WS relaying
- [✅] `extension/src/webviewProvider.ts` — outbound + Inbound union + sidecar→webview mappers
- [✅] `webview/src/global.d.ts` — Inbound + Outbound variants
- [✅] `webview/src/PluginsPanel.tsx` — Skills section with Export buttons + Import textarea + Last exported preview
- [✅] `sidecar/test/collaboration.ts` (new) — 23/23 pass

### 7E. Done When
- [✅] Plugin can be exported (skill), transferred to another machine via the JSON file, imported
- [🚫] Version conflict on import — `imported-<name>@0.0.0-imported` avoids the conflict path; full conflict UI deferred

---

## Phase 8 — Performance and UX Improvements (2–4 weeks)

**Status: 🟡 partial — 8A (memory cache + prewarm), 8B (latency + token totals), 8C (focus keybinding + a11y) shipped; streaming + diff expand deferred**

### 8A. Response Time Optimization
- [✅] Cache `retrieveMemory` results per (query, scope, agent, limit) for 60s via `withCache`
- [✅] In-flight de-dup — concurrent calls share one promise (worker + reviewer no longer hammer Supabase)
- [✅] Rejected fetcher evicts from cache (no poisoning)
- [✅] Max-entries cap drops oldest; expired entries pruned opportunistically on insert
- [✅] Pre-warm OmniRoute ping at WSS startup (logs up/down, lets UI show accurate status on connect)
- [🚫] Stream LLM tokens to webview as they arrive — protocol still batches; SSE/stream rewrite is multi-day, deferred
- [🚫] Pre-warm `chatCompletion` HTTP keep-alive — Node `http.Agent({ keepAlive })` is one-liner but only meaningful once streaming lands; YAGNI for now

### 8B. Enhanced Visual Feedback
- [✅] Per-tool-call latency in the timeline — `startedAt`/`durationMs` plumbed sidecar → extension → webview; chip shows `1.2s` / `240ms`
- [✅] Per-agent running token total — `task_token_total` event emitted before each `chatCompletion`; rendered in task header as `implementation 1240 · reviewer 540`
- [🚫] Click tool call to expand full input/output — render surface is already there (`ToolCallCard` shows args); full diff expand needs a sub-panel, deferred

### 8C. Accessibility and Usability
- [✅] `ollopa.focusPrompt` command + `ctrl+shift+l` keybinding (`cmd+shift+l` on mac) — fires `focus_prompt` event; webview focuses input
- [✅] `:focus-visible` outlines (2px `#6cb6ff`) on buttons/inputs/textarea/select
- [✅] `prefers-reduced-motion` — animations/transitions scrubbed to 0.01ms
- [🚫] Screen-reader-friendly diff narration — needs `aria-live` regions per chunk; deferred
- [🚫] WCAG AA contrast sweep — manual audit pending

### 8D. Files
- [✅] `sidecar/src/memory/memoryCache.ts` (new) — `withCache` / `configureCache` / `clearMemoryCache`
- [✅] `sidecar/src/memory/memoryService.ts` — `retrieveMemory` wraps with cache
- [✅] `sidecar/src/start.ts` — prewarm hook after WSS startup
- [✅] `sidecar/src/agents/taskModeGraph.ts` — `chatCompletionWithStats` emits `task_token_total` before each call (4 sites); `tool_call` carries `startedAt`, `tool_output` carries `durationMs`
- [✅] `extension/src/webviewProvider.ts` — Inbound variants + sidecar→webview mappers + `post()` made public for the focus keybinding
- [✅] `extension/src/extension.ts` — `ollopa.focusPrompt` registered
- [✅] `extension/package.json` — `ollopa.focusPrompt` command + `ctrl+shift+l` keybinding
- [✅] `webview/src/global.d.ts` — Inbound variants for `tool_call.startedAt`, `tool_output.durationMs`, `task_token_total`, `focus_prompt`
- [✅] `webview/src/App.tsx` — `ToolCallCard` duration chip + task header token totals + `inputRef` + `focusPrompt()`
- [✅] `webview/src/styles.css` — `@media (prefers-reduced-motion: reduce)` + `:focus-visible`
- [✅] `sidecar/test/performance.ts` (new) — 9/9 pass (TTL hit/miss, in-flight dedup, key collision, cap eviction, prune, reject-not-cached, clear, configure)

### 8E. Done When
- [✅] Repeated memory queries within 60s served from in-process cache (no Supabase round-trip)
- [✅] Every tool call shows its latency in the webview
- [✅] Every task shows running per-agent token totals
- [🚫] Cold-start to first token < 1.5s — needs streaming + benchmark
- [🚫] Axe scan — manual a11y sweep pending

---

## Cross-Phase

### Verification (every phase)
- [✅] Unit tests for Phase 1 (errorClassifier 21/21)
- [✅] Unit tests for Phase 3 (webSearch 11/11)
- [✅] Unit tests for Phase 4 (providerRegistry 14/14)
- [✅] Unit tests for Phase 8 (keyPool 15/15, performance 9/9)
- [✅] All pre-existing tests still pass (plugins, marketplace, mcp, offline, quickMode, skills, licenseCheck, privacy)
- [✅] Full project type-check clean across all 4 phases
- [🚫] Manual regression on 3 representative tasks — deferred (needs live LLM)
- [🚫] Performance benchmark before/after — deferred (no harness; cache hit/miss already covered in performance.ts)
- [🚫] Security review of any new tool — deferred (out of scope; tools registered via existing policy gate)
- [🚫] Plugin compatibility spot-check (3 random marketplace plugins) — deferred (no marketplace index yet, see Phase 7A)

### Risk Mitigation
- Keep changes additive; never break the existing 6 tools — **verified clean type-check**
- New features gated behind settings where possible
- One phase shipped before the next starts — no big-bang

---

## Summary

| Phase | Topic | Status | Tests | Notes |
|---|---|---|---|---|
| 1 | Enhanced Agent Autonomy | ✅ done | 21/21 | errorClassifier + 5 new tools + riskMitigations + backoff + lint_fail verbatim |
| 2 | IDE-Integrated Editing | 🟡 partial | type-check | 2B (explain/refactor) shipped; 2A/2C deferred |
| 3 | Real-time Web Integration | ✅ done | 11/11 | DDG search + fetch + 4 web tools, sidecar-side |
| 4 | Enhanced Provider Flexibility | ✅ done | 14/14 | Registry + Ollama + per-task override + fallback chain; UI deferred |
| 5 | Enhanced Security | ✅ done | 19/19 | license_check tool + security_scan node (secrets + licenses) gate review |
| 6 | Privacy-First Options | ✅ done | 20/20 | localOnly + redactSecrets + audit log + PrivacyBanner; llama.cpp deferred |
| 7 | Collaboration | ✅ done | 23/23 | skill export/import + semver + lockfile (already in marketplace); ratings deferred |
| 8 | Performance and UX | ✅ done | 9/9 + 15/15 | memory cache + latency chips + token totals + focus keybinding + a11y + keyPool circuit breaker + ollama-cloud preset; streaming + full WCAG + expand deferred |

**Cumulative: 132 unit tests passing, full `tsc --noEmit` clean across sidecar/extension/webview, VSIX built (ollopa-0.1.0.vsix, 266 KB).**
