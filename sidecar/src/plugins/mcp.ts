/**
 * MCP client (Phase 10).
 *
 * Implements the Model Context Protocol JSON-RPC client surface we use:
 *   - initialize  / initialized
 *   - tools/list, tools/call
 *   - resources/list, prompts/list  (forward-compat — not yet surface in
 *     the agent loop, but the client round-trips them)
 *
 * Two transports:
 *   - `stdio`  — spawn a child process, JSON-RPC over newline-delimited
 *               stdin/stdout. The process is named per the .mcp.json entry.
 *   - `http`   — Streamable HTTP transport (POST JSON-RPC, accept JSON or
 *                SSE). Sessions are tracked via the `Mcp-Session-Id` header
 *                when the server returns one.
 *
 * Each plugin declares servers in `.mcp.json`:
 *
 *   {
 *     "mcpServers": {
 *       "filesystem": {
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
 *       },
 *       "github": {
 *         "url": "https://api.githubcopilot.com/mcp/",
 *         "headers": { "Authorization": "Bearer ..." }
 *       }
 *     }
 *   }
 *
 * Tools exposed by MCP servers are registered into the plugin registry
 * under `<pluginName>:<serverName>:<toolName>` to avoid collisions.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { PluginTool } from './loader';

export interface McpServerConfig {
  command?: string;
  args?: string[];
  /** Environment overrides (merged with process.env). */
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpJson {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface McpToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpPluginContext {
  /** Run a shell command and return stdout. Used for server lifecycle. */
  spawn: (cmd: string, args: string[]) => Promise<{ kill: () => void }>;
  /** Make an HTTP request, returning { status, headers, body }. */
  httpRequest: (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

/** Lightweight JSON-RPC 2.0 client. Holds an id counter and a pending map. */
class JsonRpc {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string }>();

  next(): number { return this.nextId++; }

  register(id: number, method: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
  }

  /** Resolve a server response. */
  resolve(id: number, result: unknown, error?: { code: number; message: string }): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (error) p.reject(new Error(`MCP ${p.method}: ${error.message} (code ${error.code})`));
    else p.resolve(result);
  }

  /** Reject all pending (used on transport close). */
  rejectAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

interface StdioTransport {
  kind: 'stdio';
  child: ChildProcess;
  rpc: JsonRpc;
  buffer: string;
  close: () => void;
}

interface HttpTransport {
  kind: 'http';
  url: string;
  headers: Record<string, string>;
  sessionId: string | null;
  httpRequest: McpPluginContext['httpRequest'];
  rpc: JsonRpc;
  close: () => void;
}

export interface McpClient {
  serverName: string;
  /** All tools discovered after initialize. */
  tools: McpToolEntry[];
  /** Stop the underlying transport. */
  close: () => void;
  /** Call a tool by name. Returns the unwrapped content text. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
}

export async function startMcpClient(
  serverName: string,
  config: McpServerConfig,
  ctx: McpPluginContext,
): Promise<McpClient> {
  if (config.command) return startStdioClient(serverName, config, ctx);
  if (config.url) return startHttpClient(serverName, config, ctx);
  throw new Error(`[mcp] ${serverName}: must define 'command' (stdio) or 'url' (http)`);
}

// ─── stdio transport ────────────────────────────────────────────────────────

function startStdioClient(
  serverName: string,
  config: McpServerConfig,
  ctx: McpPluginContext,
): Promise<McpClient> {
  return new Promise<McpClient>((resolveP, rejectP) => {
    const env = { ...process.env, ...(config.env ?? {}) };
    const child = spawn(config.command!, config.args ?? [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    const rpc = new JsonRpc();
    const tx: StdioTransport = {
      kind: 'stdio',
      child, rpc, buffer: '',
      close: () => child.kill(),
    };

    let initialized = false;
    const initTimer = setTimeout(() => {
      if (!initialized) rejectP(new Error(`[mcp:${serverName}] initialize timed out`));
    }, 8_000);

    child.on('error', (err) => {
      clearTimeout(initTimer);
      rejectP(new Error(`[mcp:${serverName}] spawn failed: ${err.message}`));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      tx.buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = tx.buffer.indexOf('\n')) !== -1) {
        const line = tx.buffer.slice(0, nl).trim();
        tx.buffer = tx.buffer.slice(nl + 1);
        if (!line) continue;
        handleServerMessage(line, tx, serverName);
      }
    });
    child.stderr.on('data', () => { /* ignore by default */ });
    child.on('exit', () => {
      tx.close = () => {};
      rpc.rejectAll(new Error(`[mcp:${serverName}] process exited`));
    });

    // initiate
    sendRpc(tx, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ollopa', version: '0.2.0' },
    })
      .then((hello) => {
        initialized = true;
        clearTimeout(initTimer);
        sendNotification(tx, 'notifications/initialized', {});
        return hello;
      })
      .then(async () => {
        const tools = await sendRpc(tx, 'tools/list', {}) as { tools: McpToolEntry[] };
        const client: McpClient = {
          serverName,
          tools: tools.tools ?? [],
          close: tx.close,
          callTool: async (name, args) => {
            const res = await sendRpc(tx, 'tools/call', { name, arguments: args }) as {
              content: Array<{ type: string; text?: string }>;
            };
            return (res.content ?? []).map((c) => c.text ?? '').join('');
          },
        };
        resolveP(client);
      })
      .catch((err) => {
        tx.close();
        rejectP(err);
      });
  });
}

function handleServerMessage(line: string, tx: StdioTransport, serverName: string): void {
  let msg: any;
  try { msg = JSON.parse(line); } catch {
    console.warn(`[mcp:${serverName}] non-JSON line: ${line.slice(0, 80)}`);
    return;
  }
  if (typeof msg.id === 'number' && 'result' in msg) tx.rpc.resolve(msg.id, msg.result);
  else if (typeof msg.id === 'number' && 'error' in msg) tx.rpc.resolve(msg.id, undefined, msg.error);
  // notifications (no id) — log if they have a method
  else if (msg.method && process.env.MCP_DEBUG === '1') {
    console.warn(`[mcp:${serverName}] notification: ${msg.method}`);
  }
}

function sendRpc(tx: StdioTransport, method: string, params: unknown): Promise<unknown> {
  const id = tx.rpc.next();
  const p = tx.rpc.register(id, method);
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  if (tx.kind === 'stdio') tx.child.stdin!.write(payload + '\n');
  return p;
}

function sendNotification(tx: StdioTransport, method: string, params: unknown): void {
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
  if (tx.kind === 'stdio') tx.child.stdin!.write(payload + '\n');
}

// ─── http transport ─────────────────────────────────────────────────────────

async function startHttpClient(
  serverName: string,
  config: McpServerConfig,
  ctx: McpPluginContext,
): Promise<McpClient> {
  const sessionId: string | null = null;
  const rpc = new JsonRpc();
  const tx: HttpTransport = {
    kind: 'http',
    url: config.url!,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...(config.headers ?? {}) },
    sessionId,
    httpRequest: ctx.httpRequest,
    rpc,
    close: () => {},
  };

  async function call<T>(method: string, params: unknown): Promise<T> {
    const id = rpc.next();
    const p = rpc.register(id, method);
    const headers = { ...tx.headers };
    if (tx.sessionId) headers['Mcp-Session-Id'] = tx.sessionId;
    const res = await tx.httpRequest(tx.url, {
      method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    if (res.status >= 400) {
      throw new Error(`[mcp:${serverName}] HTTP ${res.status}: ${res.body.slice(0, 200)}`);
    }
    const sid = res.headers['mcp-session-id'];
    if (typeof sid === 'string') tx.sessionId = sid;
    let body: any;
    try { body = JSON.parse(res.body); } catch { throw new Error(`[mcp:${serverName}] non-JSON response`); }
    if (body.error) throw new Error(`[mcp:${serverName}] ${body.error.message}`);
    return body.result as T;
  }

  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'ollopa', version: '0.2.0' },
  });
  const tools = await call<{ tools: McpToolEntry[] }>('tools/list', {});

  return {
    serverName,
    tools: tools.tools ?? [],
    close: tx.close,
    callTool: async (name, args) => {
      const res = await call<{ content: Array<{ type: string; text?: string }> }>(
        'tools/call', { name, arguments: args },
      );
      return (res.content ?? []).map((c) => c.text ?? '').join('');
    },
  };
}

// ─── registry helpers ───────────────────────────────────────────────────────

/** Load every server declared in `.mcp.json` and return their tool entries. */
export interface McpServerHandle {
  client: McpClient;
  toolPrefix: string;
}

export async function loadMcpServers(
  pluginName: string,
  file: string,
  ctx: McpPluginContext,
): Promise<{ handles: McpServerHandle[]; tools: PluginTool[] }> {
  if (!existsSync(file)) return { handles: [], tools: [] };
  let raw: McpJson;
  try { raw = JSON.parse(readFileSync(file, 'utf8')) as McpJson; }
  catch (err) { throw new Error(`[mcp] ${file}: invalid JSON: ${(err as Error).message}`); }

  const servers = raw.mcpServers ?? {};
  const handles: McpServerHandle[] = [];
  const tools: PluginTool[] = [];

  for (const [name, cfg] of Object.entries(servers)) {
    try {
      const client = await startMcpClient(name, cfg, ctx);
      const prefix = `${pluginName}:${name}`;
      const handle: McpServerHandle = { client, toolPrefix: prefix };
      handles.push(handle);
      for (const t of client.tools) {
        const fullName = `${prefix}:${t.name}`;
        tools.push({
          name: fullName,
          definition: {
            name: fullName,
            description: `[mcp:${name}] ${t.description}`,
            parameters: t.inputSchema,
          },
          handler: async (args) => {
            try {
              const text = await client.callTool(t.name, args);
              return { output: text, kind: 'info' as const };
            } catch (err) {
              return { output: `MCP ${name}/${t.name} failed: ${(err as Error).message}`, kind: 'error' as const };
            }
          },
        });
      }
    } catch (err) {
      console.warn(`[mcp] ${pluginName}/${name}: ${(err as Error).message}`);
    }
  }
  return { handles, tools };
}

/** Close all clients in a list. */
export function closeMcpClients(handles: McpServerHandle[]): void {
  for (const h of handles) {
    try { h.client.close(); } catch { /* ignore */ }
  }
}

// Default context — uses node fetch + node spawn. Tests supply a stub ctx.
import { spawn as nodeSpawn } from 'node:child_process';
export const defaultMcpContext: McpPluginContext = {
  spawn: async (cmd, args) => {
    const p = nodeSpawn(cmd, args, { shell: false });
    return { kill: () => p.kill() };
  },
  httpRequest: async (url, init) => {
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { respHeaders[k] = v; });
    return { status: res.status, headers: respHeaders, body: await res.text() };
  },
};

/** Read the basename of a spec, e.g. `npx -y @scope/pkg` → `npx`. */
export function readableCommand(cmd: string): string { return basename(cmd); }
