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
import { loadCredentials, hasSupabase } from './credentials';
import { initSupabase } from './memory/supabaseClient';
import { initLocalCache } from './memory/localCache';
import { retrieveMemory } from './memory/memoryService';
import { runQuickMode, type AgentEvent } from './agents/implementation';
import { ToolAwaiter, type ToolOutputPayload } from './agents/toolAwaiter';

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
}

function isQuickStart(p: unknown): p is QuickStartRequest {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return o.kind === 'chat:send' && o.mode === 'quick'
    && typeof o.text === 'string' && typeof o.taskId === 'string';
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

function startWsServer(port: number, awaiter: ToolAwaiter): WebSocketServer {
  const wss = new WebSocketServer({ host: HOST, port });

  wss.on('connection', (ws: WebSocket) => {
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
        const ctx = {
          taskId: payload.taskId,
          send: (event: AgentEvent) => {
            try { ws.send(JSON.stringify(event)); }
            catch (err) {
              console.warn(`[sidecar] send failed for task ${payload.taskId}:`, (err as Error).message);
            }
          },
          awaiter,
        };
        runQuickMode(payload.text, ctx).catch((err) => {
          console.error(`[sidecar] runQuickMode crashed:`, err);
          try {
            ws.send(JSON.stringify({ kind: 'task_error', taskId: payload.taskId, error: (err as Error).message }));
          } catch { /* socket may be closed */ }
        });
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

  const awaiter = new ToolAwaiter();
  const port = await findFreePort();
  const wss = startWsServer(port, awaiter);
  process.stdout.write(`PORT=${port}\n`);

  const shutdown = (sig: string) => {
    console.error(`[sidecar] ${sig} received, shutting down`);
    awaiter.rejectAll('sidecar shutting down');
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
