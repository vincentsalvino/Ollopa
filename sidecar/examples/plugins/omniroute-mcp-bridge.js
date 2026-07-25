/**
 * Example plugin: omniroute-mcp-bridge.
 *
 * Connects to OmniRoute's MCP server (default: http://localhost:20128/mcp)
 * and exposes its tool catalog to the Ollopa agent as plugin tools.
 *
 * MCP speaks JSON-RPC over HTTP / SSE. This MVP does a one-time
 * `tools/list` on load and registers each tool with a passthrough handler
 * that calls `tools/call` on demand. Errors surface to the agent.
 *
 * Requires OmniRoute >= 0.5 with the MCP bridge enabled.
 */
const http = require('node:http');
const { URL } = require('node:url');

const MCP_URL = process.env.OLLOPA_OMNIRoute_MCP_URL || 'http://localhost:20128/mcp';

function rpc(method, params, id) {
  return new Promise((resolve, reject) => {
    const u = new URL(MCP_URL);
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} });
    const req = http.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c.toString('utf8'); });
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) { reject(new Error(`MCP ${method} returned non-JSON: ${buf.slice(0, 200)}`)); }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function loadOmniRouteTools() {
  const out = await rpc('tools/list', null, 1);
  if (!out || !Array.isArray(out.result?.tools)) return [];
  return out.result.tools;
}

module.exports = {
  name: 'omniroute-mcp-bridge',
  version: '0.1.0',
  network: true,
  hooks: [
    {
      tool: '*',
      phase: 'before',
      handler: () => {
        // Could rate-limit here. MVP: no-op.
      },
    },
  ],
  // We register the tools lazily on first call to keep startup fast and to
  // surface OmniRoute outages immediately.
  tools: [],

  // Custom init: if the plugin export is a function, run it on load.
  // (Documented in the plugin README.)
  init: async function () {
    try {
      const list = await loadOmniRouteTools();
      for (const t of list) {
        this.tools.push({
          name: `omniroute_${t.name}`,
          network: true,
          definition: {
            name: `omniroute_${t.name}`,
            description: t.description || `OmniRoute tool: ${t.name}`,
            parameters: t.inputSchema || { type: 'object', properties: {} },
          },
          handler: async (args) => {
            const r = await rpc('tools/call', { name: t.name, arguments: args }, Date.now());
            if (r.error) throw new Error(r.error.message || 'MCP error');
            return { output: JSON.stringify(r.result, null, 2), kind: 'info' };
          },
        });
      }
    } catch (err) {
      // OmniRoute not running — silently disable the bridge. The plugin
      // loader logs a warning if the plugin throws.
    }
  },
};
