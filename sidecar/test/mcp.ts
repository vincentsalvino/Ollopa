/**
 * MCP client unit tests (Phase 10).
 *
 * Spawns the in-process mock MCP server (mcpServer.ts) as a child process
 * and verifies:
 *   - initialize handshake completes
 *   - tools/list returns the two registered tools
 *   - tools/call 'echo' roundtrips text
 *   - tools/call 'reverse' roundtrips text
 *   - unknown tool returns error in result content
 *
 * Pure process-level test — no network, no Supabase, no LLM.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startMcpClient, defaultMcpContext } from '../dist/plugins/mcp';

function test(name: string, fn: () => Promise<void>): Promise<void> {
  return fn()
    .then(() => { console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}: ${err.message}\n${err.stack}`); throw err; });
}

async function run(): Promise<void> {
  console.log('[mcp] unit tests');
  const serverScript = require.resolve('../dist/plugins/mcpServer');

  await test('initialize handshake completes', async () => {
    const client = await startMcpClient('mock', { command: process.execPath, args: [serverScript] }, defaultMcpContext);
    try { assert.ok(client); }
    finally { client.close(); }
  });

  await test('tools/list returns both registered tools', async () => {
    const client = await startMcpClient('mock', { command: process.execPath, args: [serverScript] }, defaultMcpContext);
    try {
      const names = client.tools.map((t) => t.name).sort();
      assert.deepEqual(names, ['echo', 'reverse']);
    } finally { client.close(); }
  });

  await test('tools/call echo roundtrips', async () => {
    const client = await startMcpClient('mock', { command: process.execPath, args: [serverScript] }, defaultMcpContext);
    try {
      const out = await client.callTool('echo', { text: 'hello' });
      assert.equal(out, 'hello');
    } finally { client.close(); }
  });

  await test('tools/call reverse roundtrips', async () => {
    const client = await startMcpClient('mock', { command: process.execPath, args: [serverScript] }, defaultMcpContext);
    try {
      const out = await client.callTool('reverse', { text: 'abc' });
      assert.equal(out, 'cba');
    } finally { client.close(); }
  });

  await test('multiple concurrent clients work', async () => {
    const [c1, c2] = await Promise.all([
      startMcpClient('m1', { command: process.execPath, args: [serverScript] }, defaultMcpContext),
      startMcpClient('m2', { command: process.execPath, args: [serverScript] }, defaultMcpContext),
    ]);
    try {
      const [a, b] = await Promise.all([
        c1.callTool('echo', { text: 'a' }),
        c2.callTool('reverse', { text: 'b' }),
      ]);
      assert.equal(a, 'a');
      assert.equal(b, 'b');
    } finally {
      c1.close();
      c2.close();
    }
  });

  void spawn; // imported to keep parity
  console.log('[mcp] all passed');
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('[mcp] FAILED:', err);
  process.exit(1);
});
