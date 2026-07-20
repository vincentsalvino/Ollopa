/**
 * Ollopa sidecar — Phase 2: WebSocket echo + memory_query.
 *
 * Protocol (Phase 2):
 *   inbound  { kind: 'echo',         text: string }
 *   inbound  { kind: 'memory_query', query: string, scope: string, agent: string, taskId: string }
 *
 *   outbound { kind: 'echo',         text: string }
 *   outbound { kind: 'memory_result', memories: RetrievedMemory[], source: 'cloud' | 'cache' }
 *   outbound { kind: 'memory_error',  message: string }
 *
 * Lifecycle:
 *   1. Pick a random free port.
 *   2. Print `PORT=<n>\n` on stdout (the extension host reads this to connect).
 *   3. Accept WebSocket connections.
 *   4. Graceful shutdown on SIGTERM / SIGINT.
 *
 * Credentials come from env (set by the extension host from SecretStorage,
 * or loaded from sidecar/.env when run standalone).
 */
import { createServer, Server } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { loadCredentials, hasSupabase } from './credentials';
import { initSupabase } from './memory/supabaseClient';
import { initLocalCache } from './memory/localCache';
import { retrieveMemory } from './memory/memoryService';

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

function startWsServer(port: number): WebSocketServer {
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
      ws.send(JSON.stringify({ kind: 'error', message: 'unknown message kind' }));
    });

    ws.on('error', (err) => {
      console.error('[sidecar] ws error:', err.message);
    });
  });

  return wss;
}

async function main(): Promise<void> {
  // 1. Credentials → Supabase client (best-effort).
  const creds = loadCredentials();
  if (hasSupabase(creds)) {
    initSupabase(creds.supabaseUrl, creds.supabaseServiceKey);
    console.error('[sidecar] Supabase client initialised');
  } else {
    console.error('[sidecar] No Supabase credentials — memory_query will fall back to local cache');
  }

  // 2. Local cache is always available so offline path is real.
  initLocalCache();
  console.error('[sidecar] Local cache initialised');

  // 3. WS server.
  const port = await findFreePort();
  const wss = startWsServer(port);
  process.stdout.write(`PORT=${port}\n`);

  const shutdown = (sig: string) => {
    console.error(`[sidecar] ${sig} received, shutting down`);
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
