import { ChildProcessByStdio, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import WebSocket from 'ws';

export type SidecarEvent =
  | { type: 'status'; status: 'ready' | 'closed' | 'error'; message?: string }
  | { type: 'message'; from: 'sidecar'; payload: unknown };

type Listener = (e: SidecarEvent) => void;

/**
 * Spawns and supervises the Node.js sidecar process.
 *
 * Boot contract:
 *   1. Sidecar picks a random free port and prints `PORT=<n>\n` on stdout.
 *   2. Sidecar opens a WebSocket server on that port.
 *   3. We connect, then forward messages to listeners (the webview).
 *
 * Entry-point resolution: prefers compiled `sidecar/dist/start.js`; falls
 * back to `sidecar/src/start.ts` via `tsx` (dev). Throws clearly if neither
 * is available so the failure mode is obvious, not a silent hang.
 */
export class SidecarManager {
  private proc: ChildProcessByStdio<null, Readable, Readable> | undefined;
  private ws: WebSocket | undefined;
  private port: number | undefined;
  private listeners = new Set<Listener>();
  private ready = false;
  private bootResolver: (() => void) | null = null;
  private bootRejecter: ((err: Error) => void) | null = null;
  private readonly extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isReady(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN;
  }

  send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Sidecar not connected');
    }
    this.ws.send(JSON.stringify(payload));
  }

  async start(): Promise<void> {
    if (this.proc) return;
    this.spawn();
    // Wait until WS is open or we time out.
    await new Promise<void>((resolve, reject) => {
      this.bootResolver = resolve;
      this.bootRejecter = reject;
      setTimeout(() => {
        if (!this.ready) reject(new Error('Sidecar boot timed out (no PORT= line or WS did not open)'));
      }, 10_000);
    });
  }

  private spawn(): void {
    const distEntry = path.join(this.extensionPath, 'sidecar', 'dist', 'start.js');
    const srcEntry = path.join(this.extensionPath, 'sidecar', 'src', 'start.ts');

    let bin: string;
    let args: string[];
    if (existsSync(distEntry)) {
      bin = process.execPath;
      args = [distEntry];
    } else if (existsSync(srcEntry)) {
      // Dev: run TS via tsx (installed at workspace root).
      bin = process.execPath;
      args = [path.join(this.extensionPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), srcEntry];
      if (!existsSync(args[0])) {
        throw new Error(
          `Sidecar source found but tsx is not installed. Run \`npm i -D tsx\` at the workspace root, or run \`npm run build:sidecar\`.`,
        );
      }
    } else {
      throw new Error('No sidecar entry found. Expected sidecar/dist/start.js or sidecar/src/start.ts.');
    }

    const proc = spawn(bin, args, {
      env: { ...process.env, OLLOPA_SIDECAR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as ChildProcessByStdio<null, Readable, Readable>;
    this.proc = proc;

    let stdoutBuf = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      if (!this.port) {
        const m = /PORT=(\d+)/.exec(stdoutBuf);
        if (m) {
          this.port = Number(m[1]);
          this.connect();
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      // Surface to host console; do not pop VS Code notifications for every line.
      console.error(`[ollopa sidecar] ${chunk.toString('utf8').trim()}`);
    });

    proc.on('exit', (code) => {
      this.ready = false;
      this.ws?.close();
      this.ws = undefined;
      this.proc = undefined;
      this.emit({ type: 'status', status: 'closed', message: `exit ${code ?? 'null'}` });
    });
  }

  private connect(): void {
    if (!this.port) return;
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    this.ws = ws;

    ws.on('open', () => {
      this.ready = true;
      this.emit({ type: 'status', status: 'ready' });
      this.bootResolver?.();
      this.bootResolver = null;
      this.bootRejecter = null;
    });
    ws.on('message', (data) => {
      let payload: unknown;
      try { payload = JSON.parse(data.toString('utf8')); }
      catch { payload = { raw: data.toString('utf8') }; }
      this.emit({ type: 'message', from: 'sidecar', payload });
    });
    ws.on('close', () => {
      this.ready = false;
      this.emit({ type: 'status', status: 'closed' });
    });
    ws.on('error', (err) => {
      const e = { type: 'status' as const, status: 'error' as const, message: err.message };
      this.emit(e);
      this.bootRejecter?.(new Error(err.message));
      this.bootResolver = null;
      this.bootRejecter = null;
    });
  }

  private emit(e: SidecarEvent): void {
    for (const l of this.listeners) l(e);
  }

  dispose(): void {
    this.ws?.close();
    this.proc?.kill();
    this.proc = undefined;
    this.ws = undefined;
  }
}
