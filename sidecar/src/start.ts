/**
 * Ollopa sidecar — Phase 1: WebSocket echo server.
 *
 * Protocol (Phase 1):
 *   inbound  { kind: 'echo', text: string }
 *   outbound { kind: 'echo', text: string }
 *
 * Lifecycle:
 *   1. Pick a random free port.
 *   2. Print `PORT=<n>\n` on stdout (the extension host reads this to connect).
 *   3. Accept WebSocket connections; echo messages back.
 *   4. Graceful shutdown on SIGTERM / SIGINT.
 */
import { createServer, Server, Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';

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

function startWsServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ host: HOST, port });
  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (data) => {
      let payload: unknown;
      try { payload = JSON.parse(data.toString('utf8')); }
      catch { payload = { raw: data.toString('utf8') }; }

      // Phase 1 handler: echo.
      if (isEchoRequest(payload)) {
        ws.send(JSON.stringify({ kind: 'echo', text: payload.text }));
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

function isEchoRequest(p: unknown): p is { kind: 'echo'; text: string } {
  return !!p && typeof p === 'object'
    && (p as any).kind === 'echo'
    && typeof (p as any).text === 'string';
}

async function main(): Promise<void> {
  const port = await findFreePort();
  const wss = startWsServer(port);
  // Print the port line so the extension host can connect.
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
