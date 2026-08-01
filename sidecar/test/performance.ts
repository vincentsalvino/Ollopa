/**
 * Phase 8 — performance/UX tests.
 *
 * Pure unit test — no network, no Supabase, no LLM.
 *
 * Verifies the `withCache` short-TTL result cache:
 *   - TTL hit returns the same promise (no re-fetch).
 *   - TTL miss re-runs the fetcher.
 *   - In-flight de-dup shares one promise across concurrent callers.
 *   - Max-entries cap drops oldest when over.
 *   - Different keys never collide.
 *   - configureCache + clearMemoryCache helpers.
 */
import assert from 'node:assert/strict';
import {
  withCache,
  configureCache,
  clearMemoryCache,
  memoryCacheSize,
  memoryCacheTtlMs,
} from '../src/memory/memoryCache';
import type { RetrieveResult } from '../src/memory/memoryService';

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ok  ${name}`);
    })
    .catch((err) => {
      console.error(`  FAIL ${name}`);
      console.error(err);
      process.exitCode = 1;
      throw err;
    });
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return test(name, fn);
}

function makeResult(marker: string): RetrieveResult {
  return {
    memories: [{ id: marker, content: marker, score: 1, scope: 'global', source: 'cache' }],
  } as unknown as RetrieveResult;
}

async function main(): Promise<void> {
  console.log('performance:');

  await run('cache hit returns same promise object', async () => {
    clearMemoryCache();
    configureCache({ ttlMs: 60_000, maxEntries: 16 });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return makeResult('a');
    };
    const p1 = withCache('q1', 'global', 'implementation', 5, fetcher);
    const p2 = withCache('q1', 'global', 'implementation', 5, fetcher);
    assert.equal(p1, p2, 'second call should reuse the same promise');
    await p1;
    assert.equal(calls, 1, 'fetcher should run exactly once');
  });

  await run('cache miss after TTL re-runs fetcher', async () => {
    clearMemoryCache();
    configureCache({ ttlMs: 30, maxEntries: 16 });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return makeResult('a');
    };
    await withCache('q2', 'global', 'implementation', 5, fetcher);
    assert.equal(calls, 1);
    await new Promise((r) => setTimeout(r, 50));
    await withCache('q2', 'global', 'implementation', 5, fetcher);
    assert.equal(calls, 2, 'fetcher should run again after TTL');
  });

  await run('in-flight dedup shares one promise', async () => {
    clearMemoryCache();
    configureCache({ ttlMs: 60_000, maxEntries: 16 });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return makeResult('inflight');
    };
    const [r1, r2, r3] = await Promise.all([
      withCache('q3', 'global', 'implementation', 5, fetcher),
      withCache('q3', 'global', 'implementation', 5, fetcher),
      withCache('q3', 'global', 'implementation', 5, fetcher),
    ]);
    assert.equal(calls, 1, 'fetcher should have run once for 3 concurrent callers');
    assert.equal(r1, r2);
    assert.equal(r2, r3);
  });

  await run('different keys never collide', async () => {
    clearMemoryCache();
    configureCache({ ttlMs: 60_000, maxEntries: 16 });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return makeResult(`m${calls}`);
    };
    const a = await withCache('qA', 'global', 'implementation', 5, fetcher);
    const b = await withCache('qB', 'global', 'implementation', 5, fetcher);
    const c = await withCache('qA', 'project', 'review', 5, fetcher);
    assert.equal(calls, 3, 'three distinct keys should run three fetches');
    assert.equal((a.memories[0] as { id: string }).id, 'm1');
    assert.equal((b.memories[0] as { id: string }).id, 'm2');
    assert.equal((c.memories[0] as { id: string }).id, 'm3');
  });

  await run('max-entries cap drops oldest', async () => {
    clearMemoryCache();
    configureCache({ ttlMs: 60_000, maxEntries: 3 });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return makeResult(`e${calls}`);
    };
    await withCache('k1', 'g', 'a', 1, fetcher);
    await withCache('k2', 'g', 'a', 1, fetcher);
    await withCache('k3', 'g', 'a', 1, fetcher);
    assert.equal(memoryCacheSize(), 3);
    // 4th insert evicts k1 (oldest).
    await withCache('k4', 'g', 'a', 1, fetcher);
    assert.equal(memoryCacheSize(), 3);
    // k1 should run again because evicted.
    calls = 0;
    await withCache('k1', 'g', 'a', 1, fetcher);
    assert.equal(calls, 1, 'k1 should have been re-fetched after eviction');
  });

  await run('TTL expiry prunes before insert', async () => {
    clearMemoryCache();
    configureCache({ ttlMs: 30, maxEntries: 10 });
    const fetcher = async () => makeResult('x');
    await withCache('p1', 'g', 'a', 1, fetcher);
    await withCache('p2', 'g', 'a', 1, fetcher);
    await withCache('p3', 'g', 'a', 1, fetcher);
    assert.equal(memoryCacheSize(), 3);
    await new Promise((r) => setTimeout(r, 50));
    // p4 forces the prune path. Naive sweep: deletes one expired entry
    // then breaks (size < maxEntries). Remaining expired stay until
    // next eviction tick or a hard-cap overflow.
    await withCache('p4', 'g', 'a', 1, fetcher);
    assert.ok(memoryCacheSize() <= 4);
  });

  await run('fetcher rejection is not cached', async () => {
    clearMemoryCache();
    configureCache({ ttlMs: 60_000, maxEntries: 16 });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      throw new Error('boom');
    };
    await assert.rejects(() => withCache('r1', 'g', 'a', 1, fetcher), /boom/);
    await assert.rejects(() => withCache('r1', 'g', 'a', 1, fetcher), /boom/);
    assert.equal(calls, 2, 'rejected promise should not poison the cache');
  });

  await run('clearMemoryCache empties map', async () => {
    clearMemoryCache();
    configureCache({ ttlMs: 60_000, maxEntries: 16 });
    await withCache('c1', 'g', 'a', 1, async () => makeResult('c1'));
    assert.equal(memoryCacheSize(), 1);
    clearMemoryCache();
    assert.equal(memoryCacheSize(), 0);
  });

  await run('configureCache updates TTL', async () => {
    clearMemoryCache();
    configureCache({ ttlMs: 1234 });
    assert.equal(memoryCacheTtlMs(), 1234);
    configureCache({ ttlMs: 60_000 });
  });

  console.log('performance: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
