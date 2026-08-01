/**
 * Tiny in-process MCP stdio server for tests.
 *
 * Spawned by the MCP client test; speaks JSON-RPC 2.0 over stdin/stdout.
 * Replies to initialize / tools/list / tools/call with canned responses.
 */
import { readFileSync, writeFileSync } from 'node:fs';

function readStdin(): Promise<string> {
  return new Promise<string>((resolveP) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) {
          try { handleMessage(JSON.parse(line)); }
          catch (err) { /* ignore */ void err; }
        }
      }
    });
    // Keep process alive — test kills us.
    void readFileSync;
    void writeFileSync;
  });
}

function reply(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function handleMessage(msg: { id?: number; method?: string; params?: unknown }): void {
  if (typeof msg.id !== 'number') return; // ignore notifications
  switch (msg.method) {
    case 'initialize':
      reply({
        jsonrpc: '2.0', id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'mock-mcp', version: '0.0.1' },
          capabilities: { tools: {} },
        },
      });
      return;
    case 'notifications/initialized':
      // No reply for notifications.
      return;
    case 'tools/list':
      reply({
        jsonrpc: '2.0', id: msg.id,
        result: { tools: [
          { name: 'echo', description: 'Echoes its input', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
          { name: 'reverse', description: 'Reverses its input', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
        ] },
      });
      return;
    case 'tools/call': {
      const params = msg.params as { name: string; arguments: Record<string, unknown> };
      let out = '';
      if (params.name === 'echo') out = String(params.arguments.text ?? '');
      else if (params.name === 'reverse') out = String(params.arguments.text ?? '').split('').reverse().join('');
      else out = `unknown tool: ${params.name}`;
      reply({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: out }] } });
      return;
    }
    default:
      reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method: ${msg.method}` } });
  }
}

readStdin();
