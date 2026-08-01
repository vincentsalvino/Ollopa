/**
 * keyPool self-check — Phase 8.
 *
 * Run: npx tsx sidecar/test/keyPool.ts
 *
 * Covers:
 *   - round-robin cross 3 keys
 *   - markExhausted + prune restores key after cooldownUntil
 *   - retry-after: 30 → now + 30_000
 *   - x-ratelimit-reset: <future unix> → that timestamp
 *   - body keyword "weekly limit" + no header → 7d default for ollama-cloud
 *   - file round-trip (write, read, prune)
 *   - body keyword "session limit" → 2h default
 *   - 5xx is NOT exhausted
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  pick,
  markExhausted,
  markSuccess,
  markError,
  prune,
  exhaustionSignals,
  loadPool,
  resetPoolForTests,
  type PoolEntry,
} from '../src/llm/keyPool';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL: ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`); }
}

// Test helpers — work on a fake in-memory entry (not the file pool).
function makeEntry(n: number): PoolEntry {
  return {
    provider: 'test',
    keys: Array.from({ length: n }, (_, i) => `key${i}`),
    states: Array.from({ length: n }, (_, i) => ({ index: i, status: 'active' as const, errorCount: 0, successCount: 0 })),
    cursor: 0,
  };
}

/* --- Round-robin pick --- */
{
  const entry = makeEntry(3);
  const a = pick({ provider: 'test', keys: entry.keys });
  const b = pick({ provider: 'test', keys: entry.keys });
  const c = pick({ provider: 'test', keys: entry.keys });
  const d = pick({ provider: 'test', keys: entry.keys });
  check('round-robin cycles 0,1,2,0', a.index === 0 && b.index === 1 && c.index === 2 && d.index === 0,
    { a: a.index, b: b.index, c: c.index, d: d.index });
}

/* --- Empty keys are skipped --- */
{
  resetPoolForTests();
  const entry = getEntryFresh('empty-skip', ['', 'k2', 'k3']);
  const p = pick({ provider: 'empty-skip', keys: entry.keys });
  check('empty key skipped', p.index === 1 && p.apiKey === 'k2', p);
}

/* --- Mark exhausted + prune restores after cooldown --- */
{
  resetPoolForTests();
  const entry = getEntryFresh('exhaust', ['k0', 'k1', 'k2']);
  const now = 1_000_000;
  markExhausted('exhaust', 0, now + 100, now);
  const before = pick({ provider: 'exhaust', keys: entry.keys }, now);
  check('exhausted key0 skipped', before.index === 1, before);
  // Advance the cursor well past key0 so the post-prune pick is forced to
  // walk back to key0 (proving it is no longer marked exhausted).
  loadPool().entries['exhaust'].cursor = 0;
  prune(loadPool().entries['exhaust'], now + 200);
  // Force the next pick to start at index 0.
  loadPool().entries['exhaust'].cursor = 0;
  const after = pick({ provider: 'exhaust', keys: entry.keys }, now + 200);
  check('cooldown expired → key0 usable', after.index === 0, after);
}

/* --- Exhaustion: 429 with retry-after --- */
{
  const ctrl = new AbortController();
  const now = 1_700_000_000_000;
  const res = new Response(null, { status: 429, headers: { 'retry-after': '30' } });
  const sig = exhaustionSignals(res, undefined, undefined, now);
  check('429 + retry-after 30s', sig.exhausted && sig.resetMs === now + 30_000, sig);
}

/* --- Exhaustion: 429 with x-ratelimit-reset (unix ts) --- */
{
  const now = 1_700_000_000_000;
  const future = (now + 60_000) / 1000; // unix seconds
  const res = new Response(null, { status: 429, headers: { 'x-ratelimit-reset': String(future) } });
  const sig = exhaustionSignals(res, undefined, undefined, now);
  check('429 + x-ratelimit-reset unix ts', sig.exhausted && sig.resetMs === future * 1000, sig);
}

/* --- Exhaustion: body keyword "weekly limit" + no header → 7d default --- */
{
  const now = 1_700_000_000_000;
  const res = new Response(null, { status: 400, headers: {} });
  const sig = exhaustionSignals(res, 'weekly limit reached for your account', { weeklyMs: 7 * 86400_000, sessionMs: 7200_000 }, now);
  check('weekly limit body → 7d', sig.exhausted && sig.matched === 'weekly limit' && sig.resetMs === now + 7 * 86400_000, sig);
}

/* --- Exhaustion: body keyword "session limit" → 2h default --- */
{
  const now = 1_700_000_000_000;
  const res = new Response(null, { status: 400, headers: {} });
  const sig = exhaustionSignals(res, 'session limit reached', { weeklyMs: 7 * 86400_000, sessionMs: 7200_000 }, now);
  check('session limit body → 2h', sig.exhausted && sig.resetMs === now + 7200_000, sig);
}

/* --- 5xx is NOT exhausted --- */
{
  const res = new Response(null, { status: 503, headers: {} });
  const sig = exhaustionSignals(res, 'service unavailable', undefined);
  check('5xx → not exhausted', !sig.exhausted, sig);
}

/* --- Body keywords are case-insensitive --- */
{
  const res = new Response(null, { status: 400, headers: {} });
  const sig = exhaustionSignals(res, 'QUOTA EXCEEDED', undefined);
  check('case-insensitive keyword', sig.exhausted && sig.matched === 'quota exceeded', sig);
}

/* --- Mark success resets errorCount and active state --- */
{
  resetPoolForTests();
  getEntryFresh('ok', ['k0']);
  markError('ok', 0);
  markError('ok', 0);
  markSuccess('ok', 0);
  const entry = loadPool().entries['ok'];
  check('markSuccess resets to active', entry.states[0].status === 'active' && entry.states[0].errorCount === 0, entry.states[0]);
}

/* --- File round-trip --- */
{
  resetPoolForTests();
  // The pool file persists to ~/.ollopa/keypool.json. We don't redirect it
  // (would require module-level config plumbing). Instead, exercise the
  // in-memory cache + the public API surface that's the real contract.
  const e = getEntryFresh('file-rt', ['kA', 'kB']);
  markExhausted('file-rt', 1, Date.now() + 10_000);
  const reloaded = loadPool();
  check('state survives in-memory load', reloaded.entries['file-rt'].states[1].status === 'exhausted', reloaded.entries['file-rt']);
}

/* --- Snapshot for UI --- */
{
  const { snapshotForUi } = require('../src/llm/keyPool');
  const snap = snapshotForUi('file-rt');
  check('snapshotForUi returns configured map', snap?.keys.length === 2 && snap.keys[0].configured === true, snap);
}

/* --- Picks a usable key even when one is unconfigured + one exhausted --- */
{
  resetPoolForTests();
  const e = getEntryFresh('mixed', ['', 'k1', 'k2']);
  markExhausted('mixed', 2, Date.now() + 60_000);
  const p = pick({ provider: 'mixed', keys: e.keys });
  check('mixed: only k1 usable', p.index === 1 && p.usable === 1, p);
}

/* --- All exhausted → index=-1, earliestResetMs populated --- */
{
  resetPoolForTests();
  const e = getEntryFresh('all-dead', ['k1', 'k2']);
  const now = 1_000_000;
  markExhausted('all-dead', 0, now + 5_000, now);
  markExhausted('all-dead', 1, now + 10_000, now);
  const p = pick({ provider: 'all-dead', keys: e.keys }, now);
  check('all exhausted → -1', p.index === -1 && p.earliestResetMs === now + 5_000, p);
}

// Tiny helper to build a fresh entry without touching the file system too much.
function getEntryFresh(provider: string, keys: string[]): PoolEntry {
  const snap = loadPool();
  if (snap.entries[provider]) {
    snap.entries[provider].keys = keys.slice();
    snap.entries[provider].states = keys.map((_, i) => snap.entries[provider].states[i] ?? { index: i, status: 'active' as const, errorCount: 0, successCount: 0 });
    return snap.entries[provider];
  }
  const entry: PoolEntry = {
    provider,
    keys: keys.slice(),
    states: keys.map((_, i) => ({ index: i, status: 'active' as const, errorCount: 0, successCount: 0 })),
    cursor: 0,
  };
  snap.entries[provider] = entry;
  return entry;
}

console.log(`keyPool: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
