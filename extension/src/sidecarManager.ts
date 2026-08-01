import { ChildProcessByStdio, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import WebSocket from 'ws';
import * as vscode from 'vscode';
import type { ProviderConfig, SidecarCredentials } from './secrets';
import { serialiseDirectProviders } from './secrets';

// Single shared output channel for all sidecar diagnostics. Surfacing
// process stderr + lifecycle events here lets the user see *why* the
// panel is stuck on "connecting" without trawling VS Code's logs.
const sidecarLog = vscode.window.createOutputChannel('Ollopa Sidecar');

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
 *
 * Credentials: passed as environment variables. If `null`, the sidecar boots
 * in echo-only mode and the webview is told the sidecar is not yet ready
 * for memory queries. The user is expected to run `Ollopa: Configure`.
 */
export class SidecarManager {
  private proc: ChildProcessByStdio<null, Readable, Readable> | undefined;
  private ws: WebSocket | undefined;
  private port: number | undefined;
  private listeners = new Set<Listener>();
  private ready = false;
  private bootResolver: (() => void) | null = null;
  private bootRejecter: ((err: Error) => void) | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private armWsTimer: (() => void) | null = null;
  private readonly extensionPath: string;
  private readonly credentials: SidecarCredentials | null;
  private readonly providerConfig: ProviderConfig | null;

  constructor(extensionPath: string, credentials: SidecarCredentials | null, providerConfig: ProviderConfig | null = null) {
    this.extensionPath = extensionPath;
    this.credentials = credentials;
    this.providerConfig = providerConfig;
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

  /** Convenience for sending a tool_output reply back to the sidecar. */
  sendToolOutput(taskId: string, toolName: string, output: string, kind: 'terminal' | 'diff' | 'file' | 'error'): void {
    // The sidecar protocol uses `kind_kind` to avoid colliding with the
    // outer `kind: 'tool_output'` discriminator.
    this.send({ kind: 'tool_output', taskId, toolName, output, kind_kind: kind });
  }

  async start(): Promise<void> {
    if (this.proc) return;
    sidecarLog.appendLine('[start] SidecarManager.start() invoked');
    this.spawn();
    try {
      await new Promise<void>((resolve, reject) => {
        this.bootResolver = resolve;
        this.bootRejecter = reject;
        // Two-phase timeout: 30s for the sidecar to print PORT= (heavy
        // boot — Supabase sync, plugin discovery, OmniRoute prewarm can
        // take >10s on a cold start), then 5s for the WS handshake once
        // the port is known. Both timers get cancelled on success/error.
        const armPortTimer = () => {
          this.bootTimer = setTimeout(() => {
            if (!this.ready) {
              const msg = 'Sidecar boot timed out (no PORT= line within 30s)';
              sidecarLog.appendLine(`[timeout] ${msg}`);
              sidecarLog.show(true);
              reject(new Error(msg));
            }
          }, 30_000);
        };
        const armWsTimer = () => {
          if (this.bootTimer) clearTimeout(this.bootTimer);
          this.bootTimer = setTimeout(() => {
            if (!this.ready) {
              const msg = 'Sidecar WS handshake timed out (no open within 5s of PORT=)';
              sidecarLog.appendLine(`[timeout] ${msg}`);
              sidecarLog.show(true);
              reject(new Error(msg));
            }
          }, 5_000);
        };
        this.armWsTimer = armWsTimer;
        armPortTimer();
      });
    } catch (err) {
      sidecarLog.show(true);
      throw err;
    } finally {
      if (this.bootTimer) {
        clearTimeout(this.bootTimer);
        this.bootTimer = null;
      }
      this.armWsTimer = null;
    }
  }

  private spawn(): void {
    // Production: esbuild bundle produced by `npm run bundle:sidecar`. A
    // single self-contained CJS file with every JS dep inlined.
    const bundleEntry = path.join(this.extensionPath, 'dist', 'sidecar.js');
    // Dev fallback: TSC output for incremental iteration. Runs via tsx so
    // ESM imports of sidecar source files still resolve.
    const devEntry = path.join(this.extensionPath, 'sidecar', 'src', 'start.ts');
    // Legacy: sidecar/dist/start.js from the old `npm run build:sidecar`
    // (TSC emit before bundling existed). Still honoured for a release so
    // anyone with a stale build doesn't get a "no entry" error.
    const legacyEntry = path.join(this.extensionPath, 'sidecar', 'dist', 'start.js');

    let bin: string;
    let args: string[];
    if (existsSync(bundleEntry)) {
      bin = process.execPath;
      args = [bundleEntry];
    } else if (existsSync(legacyEntry)) {
      bin = process.execPath;
      args = [legacyEntry];
    } else if (existsSync(devEntry)) {
      bin = process.execPath;
      args = [path.join(this.extensionPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), devEntry];
      if (!existsSync(args[0])) {
        throw new Error(
          `Sidecar source found but tsx is not installed. Run \`npm i -D tsx\` at the workspace root, or run \`npm run bundle:sidecar\`.`,
        );
      }
    } else {
      throw new Error('No sidecar entry found. Run `npm run build:extension` first.');
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OLLOPA_SIDECAR: '1',
      // process.execPath inside the VS Code extension host is Electron's
      // Code.exe — without this flag it would try to open a window instead
      // of running our CJS bundle as Node. Setting ELECTRON_RUN_AS_NODE=1
      // tells Electron to behave as a plain Node runtime for this child.
      ELECTRON_RUN_AS_NODE: '1',
    };
    // Tell the sidecar where to find externalised native deps
    // (better-sqlite3). The sidecar's start.ts re-applies this through
    // Module._initPaths() on its side, but pre-seeding the env means the
    // sidecar's process.env.NODE_PATH already matches before any
    // require() fires.
    const sidecarNodeModules = path.join(this.extensionPath, 'dist', 'node_modules');
    if (existsSync(sidecarNodeModules)) {
      env.NODE_PATH = process.env.NODE_PATH
        ? `${sidecarNodeModules}${path.delimiter}${process.env.NODE_PATH}`
        : sidecarNodeModules;
    }
    // Workspace root is the source of the project plugin dir. The sidecar
    // also uses it as a fallback for plugin loading when no task is running.
    const wsRoot = vscode.workspace.getConfiguration('ollopa').get<string>('workspaceRoot');
    if (wsRoot && wsRoot.trim().length > 0) {
      env.OLLOPA_WORKSPACE_ROOT = wsRoot.trim();
    } else {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) env.OLLOPA_WORKSPACE_ROOT = folder.uri.fsPath;
    }
    if (this.credentials) {
      env.SUPABASE_URL = this.credentials.supabaseUrl;
      env.SUPABASE_SERVICE_KEY = this.credentials.supabaseServiceKey;
      if (this.credentials.openRouterKey) {
        env.OPENROUTER_API_KEY = this.credentials.openRouterKey;
      }
    }
    if (this.providerConfig) {
      if (this.providerConfig.omnirouteUrl) {
        env.OLLOPA_OMNIROUTE_URL = this.providerConfig.omnirouteUrl;
      }
      if (this.providerConfig.forceDirect) {
        env.OLLOPA_FORCE_DIRECT = '1';
      }
      env.OLLOPA_DIRECT_PROVIDERS = serialiseDirectProviders(this.providerConfig.directProviders);
      if (this.providerConfig.keyPoolDefaults) {
        env.OLLOPA_KEYPOOL_DEFAULTS = JSON.stringify(this.providerConfig.keyPoolDefaults);
      }
    }
    // Phase 3: forward web settings to the sidecar env.
    const cfg = vscode.workspace.getConfiguration('ollopa');
    // Phase 4: fallback chain
    const fallbackChain = cfg.get<string[]>('fallbackChain');
    if (Array.isArray(fallbackChain) && fallbackChain.length > 0) {
      env.OLLOPA_FALLBACK_CHAIN = fallbackChain.join(',');
    }
    const searchBackend = cfg.get<string>('searchBackend');
    if (searchBackend && searchBackend.trim().length > 0) {
      env.OLLOPA_SEARCH_BACKEND = searchBackend.trim();
    }
    const allowedDomains = cfg.get<string[]>('web.allowedDomains');
    if (Array.isArray(allowedDomains) && allowedDomains.length > 0) {
      env.WEB_ALLOWED_DOMAINS = allowedDomains.join(',');
    }
    // Phase 5: forbidden license list for license_check tool.
    const forbidden = cfg.get<string[]>('licenseCheck.forbidden');
    if (Array.isArray(forbidden) && forbidden.length > 0) {
      env.OLLOPA_FORBIDDEN_LICENSES = forbidden.join(',');
    }
    // Phase 6: privacy flags.
    if (cfg.get<boolean>('privacy.localOnly') === true) {
      env.OLLOPA_LOCAL_ONLY = '1';
    }
    if (cfg.get<boolean>('privacy.redactSecrets') === false) {
      env.OLLOPA_REDACT_SECRETS = '0';
    }

    const proc = spawn(bin, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as ChildProcessByStdio<null, Readable, Readable>;
    this.proc = proc;
    sidecarLog.appendLine(`[spawn] bin=${bin} args=${JSON.stringify(args)} cwd=${proc.spawnargs ? 'inherit' : '?'}`);
    sidecarLog.appendLine(`[spawn] pid=${proc.pid} ELECTRON_RUN_AS_NODE=${env.ELECTRON_RUN_AS_NODE ?? 'unset'} NODE_PATH=${env.NODE_PATH ?? 'unset'}`);

    let stdoutBuf = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      sidecarLog.append(`[stdout] ${chunk.toString('utf8').trimEnd()}`);
      if (!this.port) {
        const m = /PORT=(\d+)/.exec(stdoutBuf);
        if (m) {
          this.port = Number(m[1]);
          sidecarLog.appendLine(`[parse] sidecar listening on ${this.port}`);
          // Swap boot timer from "wait for PORT=" to "wait for WS open".
          this.armWsTimer?.();
          this.connect();
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trimEnd();
      sidecarLog.appendLine(`[stderr] ${text}`);
    });

    proc.on('error', (err) => {
      sidecarLog.appendLine(`[spawn-error] ${err.message}`);
    });

    proc.on('exit', (code, signal) => {
      sidecarLog.appendLine(`[exit] code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.ready = false;
      this.ws?.close();
      this.ws = undefined;
      this.proc = undefined;
      this.emit({ type: 'status', status: 'closed', message: `exit ${code ?? 'null'}` });
    });
  }

  private connect(): void {
    if (!this.port) return;
    sidecarLog.appendLine(`[ws] connecting to ws://127.0.0.1:${this.port}`);
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    this.ws = ws;

    ws.on('open', () => {
      sidecarLog.appendLine('[ws] open');
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
      sidecarLog.appendLine(`[ws-error] ${err.message}`);
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
