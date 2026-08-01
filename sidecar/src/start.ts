/**
 * Ollopa sidecar — Phase 3: Quick Mode.
 *
 * Protocol (additions over Phases 1–2):
 *   inbound  { kind: 'chat:send', mode: 'quick', text, taskId }
 *   inbound  { kind: 'tool_output', taskId, toolName, output, kind }
 *
 *   outbound { kind: 'agent_thought',  taskId, message, agent: 'implementation' }
 *   outbound { kind: 'tool_call',      taskId, toolName, toolArgs }
 *   outbound { kind: 'task_final_diff',taskId, diff }
 *   outbound { kind: 'task_error',     taskId, error }
 *   outbound { kind: 'task_complete',  taskId }
 *
 * Lifecycle:
 *   1. Pick a random free port, print `PORT=<n>\n` on stdout.
 *   2. Accept WebSocket connections.
 *   3. For each `chat:send { mode: 'quick' }`, fire-and-forget the
 *      Implementation agent. Per-task tool_output replies are awaited
 *      via a shared ToolAwaiter.
 *   4. Graceful shutdown on SIGTERM / SIGINT.
 */
import { createServer, Server } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
// In packaged builds the sidecar is one esbuild bundle at
// extension/dist/sidecar.js with native deps (`better-sqlite3`) marked
// external. NODE_PATH must point at a directory containing
// `better-sqlite3/` before any import that transitively requires it.
// The extension host sets this env var to extension/dist/node_modules
// (where copy-dist stages the native dep) at spawn time — see
// extension/src/sidecarManager.ts. Keep this above every other import.
import * as path from 'node:path';
const _nm = path.join(__dirname, 'node_modules');
if (!process.env.NODE_PATH || !process.env.NODE_PATH.split(path.delimiter).includes(_nm)) {
  process.env.NODE_PATH = process.env.NODE_PATH
    ? `${_nm}${path.delimiter}${process.env.NODE_PATH}`
    : _nm;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('module').Module._initPaths();
}
import { loadCredentials, hasSupabase } from './credentials';
import { initSupabase } from './memory/supabaseClient';
import { initLocalCache } from './memory/localCache';
import { retrieveMemory } from './memory/memoryService';
import { runQuickMode, type AgentEvent } from './agents/implementation';
import { chatCompletion, type ChatMessage } from './llm/chatClient.js';
import { ToolAwaiter, type ToolOutputPayload } from './agents/toolAwaiter';
import { pingOmniRoute } from './llm/providerRouter';
import { setProviderOverride } from './llm/chatClient.js';
import { LLM_MODEL } from './llm/llmConfig';
import { runCommand as runSlashCommand } from './plugins/commands.js';
import { loadAllFromMarket, startWatcher, stopWatcher, registerBuiltIn, closeAllMcp, setRegistry } from './plugins/loader.js';
import { BUILTIN_PLUGINS } from './plugins/builtin.js';
import { startRefineryTimer, stopRefineryTimer } from './memory/refinery.js';
import { runSync, startSyncTimer, stopSyncTimer } from './memory/syncService.js';
import { registerTask, unregisterTask, abortTask } from './concurrency.js';
import { friendlyError } from './agents/friendlyErrors.js';
import { loadPrivacyConfig } from './privacy/privacy.js';
import { appendAudit, redactSecrets } from './audit/auditLog.js';
import {
  runTaskMode,
  type ApprovalDecision,
  type Contract,
  type TaskEvent,
  type NodeCtx,
} from './agents/taskModeGraph';

const HOST = '127.0.0.1';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv: Server = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('Could not determine port'));
      }
    });
  });
}

function isEchoRequest(p: unknown): p is { kind: 'echo'; text: string } {
  return !!p && typeof p === 'object'
    && (p as any).kind === 'echo'
    && typeof (p as any).text === 'string';
}

interface MemoryQueryRequest {
  kind: 'memory_query';
  query: string;
  scope: string;
  agent: string;
  taskId: string;
}

function isMemoryQueryRequest(p: unknown): p is MemoryQueryRequest {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return o.kind === 'memory_query'
    && typeof o.query === 'string'
    && typeof o.scope === 'string'
    && typeof o.agent === 'string'
    && typeof o.taskId === 'string';
}

interface QuickStartRequest {
  kind: 'chat:send';
  mode: 'quick';
  text: string;
  taskId: string;
  /** Absolute path to the temp workspace for this task. */
  tempWorkspace?: string;
}

function isQuickStart(p: unknown): p is QuickStartRequest {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return o.kind === 'chat:send' && o.mode === 'quick'
    && typeof o.text === 'string' && typeof o.taskId === 'string';
}

interface CommandRequest {
  kind: 'chat:command';
  command: string;
  args: string;
  taskId: string;
  tempWorkspace?: string;
}

function isCommandRequest(p: unknown): p is CommandRequest {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return o.kind === 'chat:command'
    && typeof o.command === 'string'
    && typeof o.taskId === 'string';
}

interface ToolOutputRequest {
  kind: 'tool_output';
  taskId: string;
  toolName: string;
  output: string;
  kind_kind: 'terminal' | 'diff' | 'file' | 'error';
}

function isToolOutput(p: unknown): p is ToolOutputRequest {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return o.kind === 'tool_output'
    && typeof o.taskId === 'string'
    && typeof o.toolName === 'string'
    && typeof o.output === 'string'
    && typeof o.kind_kind === 'string';
}

interface ListCommandsRequest { kind: 'list_commands' }
function isListCommands(p: unknown): p is ListCommandsRequest {
  return !!p && typeof p === 'object' && (p as any).kind === 'list_commands';
}

interface InstallPluginRequest { kind: 'install_plugin'; spec: string }
function isInstallPlugin(p: unknown): p is InstallPluginRequest {
  return !!p && typeof p === 'object' && (p as any).kind === 'install_plugin' && typeof (p as any).spec === 'string';
}

interface UninstallPluginRequest { kind: 'uninstall_plugin'; name: string }
function isUninstallPlugin(p: unknown): p is UninstallPluginRequest {
  return !!p && typeof p === 'object' && (p as any).kind === 'uninstall_plugin' && typeof (p as any).name === 'string';
}

interface ListInstalledPluginsRequest { kind: 'list_installed_plugins' }
function isListInstalledPlugins(p: unknown): p is ListInstalledPluginsRequest {
  return !!p && typeof p === 'object' && (p as any).kind === 'list_installed_plugins';
}

// --- Phase 7: skill export/import ---

interface ExportSkillRequest { kind: 'export_skill'; name: string }
function isExportSkill(p: unknown): p is ExportSkillRequest {
  return !!p && typeof p === 'object' && (p as any).kind === 'export_skill' && typeof (p as any).name === 'string';
}

interface ImportSkillRequest { kind: 'import_skill'; json: string; path?: string }
function isImportSkill(p: unknown): p is ImportSkillRequest {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (o.kind !== 'import_skill') return false;
  return typeof o.json === 'string' || typeof o.path === 'string';
}

// --- Phase 7: list loaded skills (for the export UI) ---

interface ListSkillsRequest { kind: 'list_skills' }
function isListSkills(p: unknown): p is ListSkillsRequest {
  return !!p && typeof p === 'object' && (p as any).kind === 'list_skills';
}

// --- Phase 4: list providers (for the model picker UI) ---

interface ListProvidersRequest { kind: 'list_providers' }
function isListProviders(p: unknown): p is ListProvidersRequest {
  return !!p && typeof p === 'object' && (p as any).kind === 'list_providers';
}

interface TaskStartRequest {
  kind: 'chat:send';
  mode: 'task';
  text: string;
  taskId: string;
  tempWorkspace?: string;
}

function isTaskStart(p: unknown): p is TaskStartRequest {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return o.kind === 'chat:send' && o.mode === 'task'
    && typeof o.text === 'string' && typeof o.taskId === 'string';
}

interface PlanDecisionRequest {
  kind: 'plan_decision';
  taskId: string;
  decision: 'approve' | 'reject';
  comment?: string;
}

function isPlanDecision(p: unknown): p is PlanDecisionRequest {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return o.kind === 'plan_decision'
    && typeof o.taskId === 'string'
    && (o.decision === 'approve' || o.decision === 'reject');
}

interface TaskCancelRequest { kind: 'task_cancel'; taskId: string; }
function isTaskCancel(p: unknown): p is TaskCancelRequest {
  return !!p && typeof p === 'object' && (p as any).kind === 'task_cancel' && typeof (p as any).taskId === 'string';
}

// --- Phase 2B: inline explain/refactor ---

interface InlineRequest {
  kind: 'inline_request';
  /** Stable id the extension uses to correlate the reply. */
  taskId: string;
  mode: 'explain' | 'refactor';
  /** The selected source text (small — usually <2 KB). */
  selection: string;
  /** Optional language hint, e.g. "typescript". */
  language?: string;
  /** Optional extra user instruction, e.g. "in 2 sentences". */
  instruction?: string;
}
function isInlineRequest(p: unknown): p is InlineRequest {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return o.kind === 'inline_request'
    && typeof o.taskId === 'string'
    && (o.mode === 'explain' || o.mode === 'refactor')
    && typeof o.selection === 'string';
}

// --- Phase 4: provider override ---

interface ProviderOverrideRequest {
  kind: 'provider_override';
  taskId: string;
  /** Provider name from directProviders[].name. Empty string clears. */
  provider?: string;
}
function isProviderOverride(p: unknown): p is ProviderOverrideRequest {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (o.kind !== 'provider_override' || typeof o.taskId !== 'string') return false;
  return o.provider === undefined || typeof o.provider === 'string';
}

/**
 * Per-task graph metadata. We keep the last `ctx` and the last emitted
 * contract so that a `plan_decision` arriving later can resume the run
 * without the host having to re-send the full task text.
 */
interface TaskHandle {
  input: {
    taskId: string;
    userTask: string;
    workspaceRoot: string;
    tempWorkspace: string | null;
  };
  ctx: NodeCtx;
}
const taskHandles = new Map<string, TaskHandle>();

function startWsServer(port: number, awaiter: ToolAwaiter, workspaceRoot: string): WebSocketServer {
  const wss = new WebSocketServer({ host: HOST, port });

  wss.on('connection', (ws: WebSocket) => {
    // Phase 6: announce privacy state to the renderer so the banner
    // reflects current settings without a roundtrip.
    try {
      const cfg = loadPrivacyConfig();
      ws.send(JSON.stringify({ kind: 'privacy_status', localOnly: cfg.localOnly, redactSecrets: cfg.redactSecrets }));
    } catch { /* ignore */ }
    ws.on('message', async (data) => {
      let payload: unknown;
      try { payload = JSON.parse(data.toString('utf8')); }
      catch { payload = { raw: data.toString('utf8') }; }

      if (isEchoRequest(payload)) {
        ws.send(JSON.stringify({ kind: 'echo', text: payload.text }));
        return;
      }
      if (isMemoryQueryRequest(payload)) {
        try {
          const { memories, source } = await retrieveMemory({
            query: payload.query,
            scope: payload.scope,
            agent: payload.agent,
            taskId: payload.taskId,
          });
          ws.send(JSON.stringify({ kind: 'memory_result', memories, source }));
        } catch (err) {
          ws.send(JSON.stringify({ kind: 'memory_error', message: (err as Error).message }));
        }
        return;
      }
      if (isToolOutput(payload)) {
        const out: ToolOutputPayload = {
          toolName: payload.toolName,
          output: payload.output,
          kind: payload.kind_kind,
        };
        const resolved = awaiter.resolve(payload.taskId, out);
        if (!resolved) {
          // No pending tool — could be a stale reply. Log and ignore.
          console.warn(`[sidecar] tool_output with no pending task: ${payload.taskId}`);
        }
        return;
      }
      if (isQuickStart(payload)) {
        // Fire-and-forget. The agent will stream events back over `ws`.
        const send = (event: AgentEvent) => {
          try { ws.send(JSON.stringify(event)); }
          catch (err) {
            console.warn(`[sidecar] send failed for task ${payload.taskId}:`, (err as Error).message);
          }
        };
        const ctx = {
          taskId: payload.taskId,
          send,
          awaiter,
          tempWorkspace: payload.tempWorkspace ?? null,
        };

        // Decide the backend up-front so the UI can show a chip immediately.
        // The router does the same check on every call — this is purely for
        // the user-facing label.
        void announceBackend(payload.taskId, send).catch(() => { /* best-effort */ });

        registerTask(payload.taskId, 'quick');
        runQuickMode(payload.text, ctx).catch((err) => {
          console.error(`[sidecar] runQuickMode crashed:`, err);
          try {
            const msg = friendlyError(err);
            ws.send(JSON.stringify({ kind: 'task_error', taskId: payload.taskId, error: msg }));
          } catch { /* socket may be closed */ }
        }).finally(() => {
          unregisterTask(payload.taskId);
        });
        return;
      }
      if (isCommandRequest(payload)) {
        const send = (event: AgentEvent) => {
          try { ws.send(JSON.stringify(event)); }
          catch (err) {
            console.warn(`[sidecar] send failed for ${payload.taskId}:`, (err as Error).message);
          }
        };
        void runSlashCommand(payload.command, payload.args ?? '', {
          taskId: payload.taskId,
          send,
          tempWorkspace: payload.tempWorkspace ?? null,
        }).catch((err: Error) => {
          send({ kind: 'task_error', taskId: payload.taskId, error: err.message });
        });
        return;
      }
      if (isListCommands(payload)) {
        const { listCommands } = await import('./plugins/commands.js');
        const cmds = listCommands();
        try { ws.send(JSON.stringify({ kind: 'command_list', commands: cmds })); }
        catch { /* socket closed */ }
        return;
      }
      if (isInstallPlugin(payload)) {
        try {
          const { installPlugin } = await import('./plugins/marketplace.js');
          const result = await installPlugin(payload.spec);
          if (result.ok) {
            // Hot-reload the registry so the new plugin is live immediately.
            const reloaded = await loadAllFromMarket(workspaceRoot);
            setRegistry(reloaded.registry);
            try { ws.send(JSON.stringify({ kind: 'install_result', ok: true, plugin: { name: result.manifest.name, version: result.manifest.version, dir: result.dir } })); }
            catch { /* socket closed */ }
          } else {
            try { ws.send(JSON.stringify({ kind: 'install_result', ok: false, error: result.error })); }
            catch { /* socket closed */ }
          }
        } catch (err) {
          try { ws.send(JSON.stringify({ kind: 'install_result', ok: false, error: (err as Error).message })); }
          catch { /* socket closed */ }
        }
        return;
      }
      if (isUninstallPlugin(payload)) {
        try {
          const { uninstallPlugin } = await import('./plugins/marketplace.js');
          const result = uninstallPlugin(payload.name);
          if (result.ok) {
            const reloaded = await loadAllFromMarket(workspaceRoot);
            setRegistry(reloaded.registry);
          }
          try { ws.send(JSON.stringify({ kind: 'uninstall_result', ok: result.ok, error: result.error })); }
          catch { /* socket closed */ }
        } catch (err) {
          try { ws.send(JSON.stringify({ kind: 'uninstall_result', ok: false, error: (err as Error).message })); }
          catch { /* socket closed */ }
        }
        return;
      }
      if (isListInstalledPlugins(payload)) {
        try {
          const { listInstalledPlugins } = await import('./plugins/marketplace.js');
          const installed = listInstalledPlugins();
          try { ws.send(JSON.stringify({ kind: 'installed_list', plugins: installed })); }
          catch { /* socket closed */ }
        } catch (err) {
          try { ws.send(JSON.stringify({ kind: 'error', message: (err as Error).message })); }
          catch { /* socket closed */ }
        }
        return;
      }
      if (isExportSkill(payload)) {
        try {
          const { exportSkill } = await import('./plugins/skillExport.js');
          const r = exportSkill(payload.name);
          try { ws.send(JSON.stringify(r.ok
            ? { kind: 'export_skill_result', ok: true, name: payload.name, json: r.json }
            : { kind: 'export_skill_result', ok: false, name: payload.name, error: r.error })); }
          catch { /* socket closed */ }
        } catch (err) {
          try { ws.send(JSON.stringify({ kind: 'export_skill_result', ok: false, error: (err as Error).message })); }
          catch { /* socket closed */ }
        }
        return;
      }
      if (isImportSkill(payload)) {
        try {
          const { importSkillBundle, importSkillFile } = await import('./plugins/skillExport.js');
          const r = payload.path ? importSkillFile(payload.path) : importSkillBundle(payload.json);
          try { ws.send(JSON.stringify({ kind: 'import_skill_result', ok: r.ok, error: r.error, path: r.path })); }
          catch { /* socket closed */ }
          // Refresh the plugin registry if it succeeded.
          if (r.ok) {
            try {
              const { loadAllFromMarket } = await import('./plugins/loader.js');
              const reloaded = await loadAllFromMarket(process.env.OLLOPA_WORKSPACE_ROOT?.trim() || process.cwd());
              setRegistry(reloaded.registry);
            } catch { /* best-effort */ }
          }
        } catch (err) {
          try { ws.send(JSON.stringify({ kind: 'import_skill_result', ok: false, error: (err as Error).message })); }
          catch { /* socket closed */ }
        }
        return;
      }
      if (isListSkills(payload)) {
        try {
          const { listSkills } = await import('./plugins/skills.js');
          const list = listSkills();
          try { ws.send(JSON.stringify({ kind: 'skills_list', skills: list })); }
          catch { /* socket closed */ }
        } catch (err) {
          try { ws.send(JSON.stringify({ kind: 'error', message: (err as Error).message })); }
          catch { /* socket closed */ }
        }
        return;
      }
      if (isTaskStart(payload)) {
        const send = (event: AgentEvent | TaskEvent) => {
          try { ws.send(JSON.stringify(event)); }
          catch (err) {
            console.warn(`[sidecar] send failed for task ${payload.taskId}:`, (err as Error).message);
          }
        };
        const ctx: NodeCtx = {
          taskId: payload.taskId,
          send,
          awaiter,
          tempWorkspace: payload.tempWorkspace ?? null,
        };
        const workspaceRoot = process.env.OLLOPA_WORKSPACE_ROOT?.trim() || process.cwd();
        const input = {
          taskId: payload.taskId,
          userTask: payload.text,
          workspaceRoot,
          tempWorkspace: payload.tempWorkspace ?? null,
        };
        taskHandles.set(payload.taskId, { input, ctx });
        registerTask(payload.taskId, 'task');
        try {
          send({ kind: 'task_started', taskId: payload.taskId });
          const final = await runTaskMode(input, ctx, null);
          if (final.finalDiff) {
            send({ kind: 'task_final_diff', taskId: payload.taskId, diff: final.finalDiff });
          }
          send({ kind: 'task_complete', taskId: payload.taskId, status: final.status === 'success' ? 'success' : (final.status === 'cancelled' ? 'cancelled' : 'failed') });
        } catch (err) {
          const e = err as Error & { name?: string };
          // LangGraph raises GraphInterrupt on `interrupt()`. We swallow it —
          // the plan_proposed event was already emitted, and the host will
          // send plan_decision to resume.
          if (e?.name === 'GraphInterrupt' || (e as any)?.lc_error_code === 'graph_interrupt') {
            console.warn(`[sidecar] task ${payload.taskId.slice(0, 8)} paused on approval`);
            return;
          }
          console.error(`[sidecar] runTaskMode crashed:`, err);
          try {
            send({ kind: 'task_error', taskId: payload.taskId, error: friendlyError(err) });
          } catch { /* socket may be closed */ }
        } finally {
          // We keep the handle alive until plan_decision arrives. If the
          // graph never resumed, the host will eventually send task_cancel.
          unregisterTask(payload.taskId);
        }
        return;
      }
      if (isPlanDecision(payload)) {
        const handle = taskHandles.get(payload.taskId);
        if (!handle) {
          console.warn(`[sidecar] plan_decision with no active task: ${payload.taskId}`);
          ws.send(JSON.stringify({ kind: 'error', message: `no active task for plan_decision ${payload.taskId}` }));
          return;
        }
        const send = handle.ctx.send;
        const decision: ApprovalDecision = {
          decision: payload.decision,
          comment: payload.comment,
        };
        try {
          const final = await runTaskMode(handle.input, handle.ctx, decision);
          if (final.finalDiff) {
            send({ kind: 'task_final_diff', taskId: payload.taskId, diff: final.finalDiff });
          }
          send({
            kind: 'task_complete',
            taskId: payload.taskId,
            status: final.status === 'success' ? 'success' : (final.status === 'cancelled' ? 'cancelled' : 'failed'),
          });
        } catch (err) {
          const e = err as Error;
          console.error(`[sidecar] runTaskMode resume crashed:`, err);
          try { send({ kind: 'task_error', taskId: payload.taskId, error: e.message }); } catch { /* socket closed */ }
        } finally {
          taskHandles.delete(payload.taskId);
        }
        return;
      }
      if (isTaskCancel(payload)) {
        const handle = taskHandles.get(payload.taskId);
        if (handle) {
          abortTask(payload.taskId, awaiter);
          handle.ctx.send({ kind: 'task_complete', taskId: payload.taskId, status: 'cancelled' });
          taskHandles.delete(payload.taskId);
        }
        // Also unregister quick-mode tasks that weren't tracked in taskHandles.
        abortTask(payload.taskId, awaiter);
        return;
      }
      if (isInlineRequest(payload)) {
        // Phase 2B: small LLM call, no tools, no temp workspace.
        // Fire-and-await; reply once with `inline_reply`.
        void handleInlineRequest(payload).then((reply) => {
          try { ws.send(JSON.stringify(reply)); } catch { /* socket closed */ }
        }).catch((err: Error) => {
          try { ws.send(JSON.stringify({ kind: 'inline_reply', taskId: payload.taskId, mode: payload.mode, error: err.message })); } catch { /* socket closed */ }
        });
        return;
      }
      if (isProviderOverride(payload)) {
        // Phase 4: pin subsequent LLM calls to a specific provider.
        // Empty string clears the override.
        setProviderOverride(payload.provider);
        try { ws.send(JSON.stringify({ kind: 'provider_override_ack', taskId: payload.taskId, provider: payload.provider ?? '' })); } catch { /* socket closed */ }
        return;
      }
      if (isListProviders(payload)) {
        // Phase 4: enumerate configured providers for the webview picker.
        // Strip apiKey before sending — never leak keys to the renderer.
        const creds = loadCredentials();
        const list = creds.directProviders.map((p) => ({
          name: p.name,
          kind: p.kind ?? 'openai-compatible',
          baseUrl: p.baseUrl,
          enabled: p.enabled,
          hasKey: !!p.apiKey,
          model: p.model ?? '',
        }));
        // Phase 8: include per-pool state for the status chip.
        const { snapshotForUi } = await import('./llm/keyPool.js');
        const keyPools = creds.directProviders
          .filter((p) => p.keys && p.keys.length > 0)
          .map((p) => {
            const snap = snapshotForUi(p.name);
            const activeIdx = snap?.keys.findIndex((k) => k.configured && k.status === 'active') ?? -1;
            const earliest = snap?.keys
              .filter((k) => k.cooldownUntil)
              .reduce((acc: number | undefined, k) => (acc === undefined || (k.cooldownUntil && k.cooldownUntil < acc) ? k.cooldownUntil : acc), undefined);
            return {
              provider: p.name,
              current: activeIdx >= 0 ? activeIdx + 1 : 0,
              total: p.keys!.length,
              cooldownUntil: earliest,
            };
          });
        try { ws.send(JSON.stringify({ kind: 'providers_list', providers: list, fallbackChain: creds.fallbackChain, keyPools })); } catch { /* socket closed */ }
        return;
      }
      ws.send(JSON.stringify({ kind: 'error', message: 'unknown message kind' }));
    });

    ws.on('error', (err) => {
      console.error('[sidecar] ws error:', err.message);
    });
  });

  return wss;
}

/* -------------------------------------------------------------------------- */
/*  Phase 2B — inline explain/refactor                                         */
/* -------------------------------------------------------------------------- */

interface InlineReply {
  kind: 'inline_reply';
  taskId: string;
  mode: 'explain' | 'refactor';
  output: string;
  /** Optional structured edit (for refactor). Not yet consumed. */
  edit?: { old_str: string; new_str: string } | null;
}

/**
 * Phase 6: apply privacy redaction to outbound LLM messages. Mutates in
 * place and audits the byte count.
 */
function applyPrivacy(messages: ChatMessage[]): ChatMessage[] {
  const cfg = loadPrivacyConfig();
  if (!cfg.redactSecrets) return messages;
  let totalBytes = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string' && msg.content.length > 0) {
      const r = redactSecrets(msg.content);
      if (r.redactedCount > 0) {
        msg.content = r.text;
        totalBytes += r.redactedBytes;
      }
    }
  }
  if (totalBytes > 0) {
    void appendAudit({
      kind: 'payload_redacted',
      source: 'chatCompletion',
      redactedBytes: totalBytes,
      detail: `masked ${totalBytes} bytes across ${messages.length} message(s)`,
    });
  }
  return messages;
}

async function handleInlineRequest(req: InlineRequest): Promise<InlineReply> {
  const system = req.mode === 'explain'
    ? 'You are a senior code reviewer. Explain the following code snippet in plain English. ' +
      'Be concise (2-4 sentences) and focus on what it does, not how it is styled.'
    : 'You are a senior code reviewer. Suggest a single concrete refactor for the following code snippet. ' +
      'Return the refactored code wrapped in a single ``` code block ```. Do not add prose.';
  const user = [
    req.language ? `Language: ${req.language}` : '',
    req.instruction ? `Instruction: ${req.instruction}` : '',
    'Selection:',
    '```',
    req.selection.slice(0, 4000),
    '```',
  ].filter(Boolean).join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  applyPrivacy(messages);
  const result = await chatCompletion(messages, []);
  const output = (result.message.content ?? '').trim();
  return { kind: 'inline_reply', taskId: req.taskId, mode: req.mode, output };
}

async function announceBackend(taskId: string, send: (e: AgentEvent) => void): Promise<void> {
  const creds = loadCredentials();
  let backend: { kind: 'omniroute' | 'direct'; provider?: string; model: string } | null = null;
  if (!creds.forceDirect && creds.omnirouteUrl && await pingOmniRoute(creds.omnirouteUrl)) {
    backend = { kind: 'omniroute', model: 'auto' };
  } else {
    const first = creds.directProviders.find((p) => p.enabled && p.apiKey);
    if (first) {
      backend = { kind: 'direct', provider: first.name, model: first.model ?? LLM_MODEL };
    }
  }
  if (!backend) return; // Router will throw a clear error on first call.
  // Cast: `task_backend` is a side-channel event the extension webview knows
  // about. The closed `AgentEvent` union is for the agent loop; this is a UI hint.
  (send as (e: unknown) => void)({ kind: 'task_backend', taskId, backend });
}

async function main(): Promise<void> {
  const creds = loadCredentials();
  if (hasSupabase(creds)) {
    initSupabase(creds.supabaseUrl, creds.supabaseServiceKey);
    console.error('[sidecar] Supabase client initialised');
  } else {
    console.error('[sidecar] No Supabase credentials — memory_query will fall back to local cache');
  }

  initLocalCache();
  console.error('[sidecar] Local cache initialised');

  // Phase 6: kick off the Refinery background timer. Each tick runs the
  // distillation pipeline against any unrefined mistakes.
  startRefineryTimer();
  console.error('[sidecar] Refinery timer started');

  // Phase 7: startup sync (pull recent memories + replay offline queue) +
  // periodic refresh timer. Async; failures don't block startup.
  void runSync()
    .then((r) => {
      if (r.online) {
        console.error(`[sidecar] startup sync: pulled=${r.pulled} replayed=${r.queueReplayed} pruned=${r.pruned}`);
      } else {
        console.error('[sidecar] startup sync: Supabase unreachable — running in offline mode');
      }
    })
    .catch((err) => console.warn('[sidecar] startup sync failed:', err.message));
  startSyncTimer();
  console.error('[sidecar] Sync timer started');

  // Phase 3.6: load plugins from the workspace's .ollopa/plugins and from
  // ~/.ollopa/plugins. The workspace root is taken from
  // OLLOPA_WORKSPACE_ROOT (the extension host sets this), with cwd() as a
  // dev fallback. The watcher hot-reloads on any file change.
  const workspaceRoot = process.env.OLLOPA_WORKSPACE_ROOT?.trim() || process.cwd();
  const loaded = await loadAllFromMarket(workspaceRoot);
  setRegistry(loaded.registry);
  // Register built-in plugins after user plugins so built-ins take precedence
  // when both define the same command name (e.g. `/refine`).
  for (const p of BUILTIN_PLUGINS) registerBuiltIn(p, 'builtin');
  const toolCount = loaded.registry.tools.size;
  const cmdCount = loaded.registry.commands.size;
  const agentCount = loaded.agents.length;
  const skillCount = loaded.skills.length;
  console.error(`[sidecar] plugins: ${toolCount} tool(s), ${cmdCount} command(s), ${agentCount} agent(s), ${skillCount} skill(s) loaded`);
  startWatcher(workspaceRoot, async () => {
    console.error('[sidecar] plugin registry reloaded');
  });

  const awaiter = new ToolAwaiter();
  const port = await findFreePort();
  const wss = startWsServer(port, awaiter, workspaceRoot);
  // Wait for the WS server to actually bind the port before announcing it.
  // WebSocketServer construction is async (net.Server.listen defers); printing
  // PORT= straight after `new WebSocketServer(...)` makes the extension race
  // ahead and connect to a port the OS hasn't accepted on yet (ECONNREFUSED).
  await new Promise<void>((resolve) => wss.on('listening', () => resolve()));
  process.stdout.write(`PORT=${port}\n`);

  // Phase 8: pre-warm the OmniRoute ping so the first LLM call avoids
  // the cold DNS + TLS handshake (~300ms on a fresh process).
  // Skip when direct mode is forced — the user has already committed
  // to bypassing the router.
  if (!creds.forceDirect && creds.omnirouteUrl) {
    void pingOmniRoute(creds.omnirouteUrl).then((up) => {
      console.error(`[sidecar] prewarm OmniRoute (${creds.omnirouteUrl}): ${up ? 'up' : 'down'}`);
    });
  }

  const shutdown = (sig: string) => {
    console.error(`[sidecar] ${sig} received, shutting down`);
    awaiter.rejectAll('sidecar shutting down');
    stopRefineryTimer();
    stopSyncTimer();
    stopWatcher();
    closeAllMcp();
    wss.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[sidecar] fatal:', err);
  process.exit(1);
});
