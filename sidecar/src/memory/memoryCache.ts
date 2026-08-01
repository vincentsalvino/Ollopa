/**
 * Phase 8 — short-TTL cache for retrieveMemory.
 *
 * Two layers:
 *   1. Result cache: same (query, scope, agent, limit) → same result for
 *      `DEFAULT_TTL_MS`. Cheap, in-process.
 *   2. In-flight de-dup: same call already running → reuse the same
 *      promise. Avoids hammering Supabase when the worker + reviewer
 *      both ask within the same tick.
 *
 * Ponytail: Map-based, no eviction sweep — entries fall out of the map
 * naturally on TTL miss because we check `Date.now() - ts` on lookup
 * and never re-insert. Old entries stay until next GC.
 *
 * Add: persistent cross-task cache (sqlite) when the in-process map
 * measurably falls short.
 */
import type { RetrieveResult } from './memoryService';

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 256;

interface Entry {
  ts: number;
  promise: Promise<RetrieveResult>;
}

const cache = new Map<string, Entry>();
let maxEntries = DEFAULT_MAX_ENTRIES;

/** Override the TTL + cap (used by tests). */
export function configureCache(opts: { ttlMs?: number; maxEntries?: number }): void {
  if (typeof opts.ttlMs === 'number') cacheTtlMs = opts.ttlMs;
  if (typeof opts.maxEntries === 'number') maxEntries = opts.maxEntries;
  if (maxEntries < 1) maxEntries = 1;
}

let cacheTtlMs = DEFAULT_TTL_MS;

function cacheKey(query: string, scope: string, agent: string, limit: number): string {
  return `${scope}${agent}${limit}${query}`;
}

/**
 * Wrap an async fetch with a TTL cache + in-flight de-dup. The wrapped
 * function should resolve to a RetrieveResult.
 */
export function withCache(
  query: string,
  scope: string,
  agent: string,
  limit: number,
  fetcher: () => Promise<RetrieveResult>,
): Promise<RetrieveResult> {
  const key = cacheKey(query, scope, agent, limit);
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && now - existing.ts < cacheTtlMs) {
    return existing.promise;
  }
  // Drop expired entries before adding more so we don't blow the cap.
  if (cache.size >= maxEntries) {
    for (const [k, v] of cache) {
      if (now - v.ts >= cacheTtlMs) cache.delete(k);
      if (cache.size < maxEntries) break;
    }
  }
  // Final hard cap: drop the oldest entry if still over.
  if (cache.size >= maxEntries) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  const promise = fetcher().catch((err) => {
    // Don't poison the cache with a rejected promise — the caller
    // can retry without waiting for TTL.
    cache.delete(key);
    throw err;
  });
  cache.set(key, { ts: now, promise });
  return promise;
}

/** Test helper: clear the cache. */
export function clearMemoryCache(): void {
  cache.clear();
}

/** Test helper: current size. */
export function memoryCacheSize(): number {
  return cache.size;
}

/** Test helper: get the live TTL. */
export function memoryCacheTtlMs(): number {
  return cacheTtlMs;
}