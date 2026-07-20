/**
 * Offline smoke test for Phase 2.
 *
 * Boots the sidecar with NO Supabase credentials, seeds the local cache with
 * two synthetic memories, sends a `memory_query` over WebSocket, and asserts:
 *   1. The reply is `{ kind: 'memory_result', source: 'cache', ... }`.
 *   2. The closest match by cosine is the one we expect.
 *
 * No network. No real Supabase. Tests the offline path the spec calls out
 * for Phase 8, made concrete now since the wiring is the same.
 */
import { spawn, ChildProcessByStdio } from 'node:child_process';
import { Readable } from 'node:stream';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import WebSocket from 'ws';
import Database from 'better-sqlite3';

const SIDECAR_ENTRY = path.resolve(__dirname, '..', 'dist', 'start.js');

function log(s: string) { console.log(`[test] ${s}`); }

function kill(p: ChildProcessByStdio<null, Readable, Readable> | undefined): void {
  try { p?.kill(); } catch { /* noop */ }
}

function seedCache(): void {
  const home = os.homedir();
  const dir = path.join(home, '.ollopa');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'memory_cache.db');
  // Start clean so the test is reproducible.
  if (existsSync(dbPath)) rmSync(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, title TEXT, content TEXT, scope TEXT, status TEXT,
      source TEXT, quality_score REAL, performance_score REAL, tags TEXT,
      category TEXT, code_block TEXT, use_when TEXT, avoid_when TEXT,
      embedding TEXT, updated_at TEXT
    );
  `);

  // Two memories, distinguishable by a single-bit difference in their
  // embeddings (e.g. index 0 = 1.0 vs 0.0). A query that has index 0 = 1.0
  // should be closer to the "match" row.
  const matchEmb = new Array(1536).fill(0); matchEmb[0] = 1.0;
  const otherEmb = new Array(1536).fill(0); otherEmb[1] = 1.0;

  const stmt = db.prepare(`INSERT INTO memories
    (id, title, content, scope, status, source, quality_score, performance_score, tags, category, code_block, use_when, avoid_when, embedding, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  stmt.run('match-1', 'Match Memory', 'this is the one we want', 'backend', 'Trusted', 'SEED', 0.9, 0.5, '["express","health"]', 'pattern', null, '["http"]', '[]', JSON.stringify(matchEmb), new Date().toISOString());
  stmt.run('other-1', 'Other Memory', 'unrelated', 'backend', 'Trusted', 'SEED', 0.5, 0.5, '["misc"]', 'pattern', null, '[]', '[]', JSON.stringify(otherEmb), new Date().toISOString());
  db.close();
  log(`cache seeded at ${dbPath}`);
}

async function waitForPort(proc: ChildProcessByStdio<null, Readable, Readable>): Promise<number> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const m = /PORT=(\d+)/.exec(buf);
      if (m) {
        proc.stdout?.off('data', onData);
        resolve(Number(m[1]));
      }
    };
    proc.stdout?.on('data', onData);
    const t = setTimeout(() => {
      proc.stdout?.off('data', onData);
      reject(new Error('timeout waiting for PORT= line'));
    }, 10_000);
    proc.on('exit', () => {
      clearTimeout(t);
      reject(new Error('sidecar exited before printing PORT='));
    });
  });
}

async function run(): Promise<void> {
  seedCache();

  // Make sure no leaked env from the host causes a Supabase call.
  const env = { ...process.env, OLLOPA_SIDECAR: '1' };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_KEY;
  delete env.OPENROUTER_API_KEY;

  log('spawning sidecar (no creds)…');
  const proc = spawn(process.execPath, [SIDECAR_ENTRY], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ChildProcessByStdio<null, Readable, Readable>;

  proc.stderr?.on('data', (b) => process.stderr.write(`  [sidecar] ${b}`));

  let procRef: ChildProcessByStdio<null, Readable, Readable> | undefined = proc;
  const cleanup = () => kill(procRef);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  const port = await waitForPort(proc);
  log(`sidecar on port ${port}`);

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (e) => reject(e));
  });
  log('ws connected');

  // Ask with a query that has embedding index 0 = 1.0 — should match 'match-1'.
  // We can't actually call the OpenRouter embedding endpoint (no key in test),
  // but `retrieveFromCache` with `prefetchedEmbedding=undefined` just returns
  // rows in cache-order; we need to test the *ranking* path, which means we
  // need a query_embedding of length 1536. The sidecar will try the OpenRouter
  // call and fail, then fall back to cache with prefetchedEmbedding=undefined.
  // The fallback path returns an unranked slice. To test the ranker we have
  // to call searchLocal directly — but that's a unit test, not a WS roundtrip.
  //
  // For the integration test, we just assert that the WS roundtrip returns
  // the expected `source: 'cache'` and the seeded row is in the result.
  const reply = await new Promise<{ kind: string; source?: string; memories?: any[]; message?: string }>((resolve, reject) => {
    ws.once('message', (d) => {
      try { resolve(JSON.parse(d.toString('utf8'))); }
      catch (e) { reject(e); }
    });
    ws.send(JSON.stringify({
      kind: 'memory_query',
      query: 'Express health endpoint',
      scope: 'backend',
      agent: 'test',
      taskId: 'phase2-smoke',
    }));
    setTimeout(() => reject(new Error('reply timeout')), 5000);
  });
  ws.close();
  cleanup();

  log(`reply: ${JSON.stringify(reply).slice(0, 200)}`);

  if (reply.kind !== 'memory_result') {
    throw new Error(`expected kind=memory_result, got ${reply.kind}: ${reply.message ?? ''}`);
  }
  if (reply.source !== 'cache') {
    throw new Error(`expected source=cache, got ${reply.source}`);
  }
  if (!Array.isArray(reply.memories) || reply.memories.length < 2) {
    throw new Error(`expected ≥2 cached memories, got ${reply.memories?.length}`);
  }
  const ids = reply.memories.map((m: any) => m.id).sort();
  if (!ids.includes('match-1') || !ids.includes('other-1')) {
    throw new Error(`expected both seeded ids, got: ${ids.join(',')}`);
  }
  log('✅ offline path works: source=cache, both seeded rows present');

  // Direct unit-style check of the cosine ranker via better-sqlite3.
  // We import the compiled JS module and call searchLocal with a custom
  // embedding to confirm ranking is correct.
  const localCache = require(path.resolve(__dirname, '..', 'dist', 'memory', 'localCache.js'));
  localCache.initLocalCache();
  const matchQuery = new Array(1536).fill(0); matchQuery[0] = 1.0;
  const ranked = localCache.searchLocal(matchQuery, 'backend', 5);
  if (ranked[0]?.id !== 'match-1') {
    throw new Error(`expected match-1 first, got ${ranked[0]?.id}`);
  }
  log('✅ cosine ranker: match-1 ranked first as expected');

  procRef = undefined;
  process.exit(0);
}

run().catch((err) => {
  console.error('[test] FAILED:', err);
  process.exit(1);
});
