/**
 * Sync service — Phase 7.
 *
 * Owns the bidirectional bridge between the local SQLite cache and the
 * Supabase cloud tables. Runs on startup, on a periodic timer, and when
 * the reachability state flips from offline → online.
 *
 * Responsibilities:
 *   1. **Startup pull**: fetch all rows modified in the last 30 days
 *      from `memories` and upsert them into the local cache.
 *   2. **Reachability check**: lightweight `SELECT 1` against `memories`.
 *      Cached for 60s to avoid hammering on every request.
 *   3. **Periodic refresh**: every 10 min, re-run the pull + the offline
 *      queue replay.
 *   4. **Queue replay**: any local-only mistakes (delivery='queued') get
 *      re-uploaded to `raw_ingest_queue` so the cloud has the full record.
 *   5. **Cache cap**: prune oldest rows when over CACHE_MAX_ROWS.
 *
 * All operations are best-effort. Failures are logged but never throw
 * out of the timer — they just wait for the next tick.
 */
import { getSupabase, hasSupabase } from './supabaseClient';
import {
  initLocalCache,
  upsertMemories,
  listMemoriesUpdatedSince,
  pruneOldest,
  countMemories,
  getLocalCache,
  type CachedMemory,
} from './localCache';
import type { CapturedMistake } from './mistakeCapture';

export const SYNC_INTERVAL_MS = 10 * 60_000;       // 10 min
export const REACHABILITY_CACHE_MS = 60_000;       // 60s
export const CACHE_MAX_ROWS = 5_000;
export const STARTUP_LOOKBACK_DAYS = 30;

interface MemoryCloudRow {
  id: string;
  title: string | null;
  content: string | null;
  scope: string | null;
  status: string | null;
  source: string | null;
  quality_score: number | null;
  performance_score: number | null;
  tags: string[] | null;
  category: string | null;
  code_block: string | null;
  use_when: string[] | null;
  avoid_when: string[] | null;
  embedding: string | number[] | null;
  updated_at: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Reachability                                                              */
/* -------------------------------------------------------------------------- */

let lastReachabilityCheck = 0;
let lastReachabilityState = false;

/**
 * Cheap reachability probe. Cached for `REACHABILITY_CACHE_MS`. Returns
 * false if Supabase was never initialised (no credentials) or if the
 * probe fails. The probe itself is a 1-row select against `memories`.
 */
export async function isSupabaseReachable(force = false): Promise<boolean> {
  if (!hasSupabase()) return false;
  const now = Date.now();
  if (!force && now - lastReachabilityCheck < REACHABILITY_CACHE_MS) {
    return lastReachabilityState;
  }
  lastReachabilityCheck = now;
  try {
    const { error } = await getSupabase()
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    lastReachabilityState = !error;
    return lastReachabilityState;
  } catch {
    lastReachabilityState = false;
    return false;
  }
}

/** Invalidate the reachability cache — called when we know state changed. */
export function invalidateReachability(): void {
  lastReachabilityCheck = 0;
  lastReachabilityState = false;
}

/* -------------------------------------------------------------------------- */
/*  Sync                                                                      */
/* -------------------------------------------------------------------------- */

export interface SyncResult {
  startedAt: number;
  finishedAt: number;
  pulled: number;
  queueReplayed: number;
  pruned: number;
  online: boolean;
  errors: string[];
}

/**
 * Run one sync cycle. Safe to call concurrently — the local cache writes
 * are serialised by better-sqlite3.
 */
export async function runSync(): Promise<SyncResult> {
  const startedAt = Date.now();
  const errors: string[] = [];
  let pulled = 0;
  let queueReplayed = 0;
  let pruned = 0;

  const online = await isSupabaseReachable(true);
  if (!online) {
    return { startedAt, finishedAt: Date.now(), pulled, queueReplayed, pruned, online: false, errors };
  }

  // 1. Pull recent memories.
  try {
    pulled = await pullRecentMemories();
  } catch (err) {
    errors.push(`pull: ${(err as Error).message}`);
    // Pull failed → mark offline for the next caller.
    invalidateReachability();
  }

  // 2. Replay any locally-queued mistakes that never made it to cloud.
  try {
    queueReplayed = await replayOfflineMistakes();
  } catch (err) {
    errors.push(`replay: ${(err as Error).message}`);
  }

  // 3. Cap cache size.
  try { pruned = pruneOldest(CACHE_MAX_ROWS); }
  catch (err) { errors.push(`prune: ${(err as Error).message}`); }

  const finishedAt = Date.now();
  const summary = { startedAt, finishedAt, pulled, queueReplayed, pruned, online, errors };
  console.log(`[sync] ${JSON.stringify(summary)}`);
  return summary;
}

async function pullRecentMemories(): Promise<number> {
  const sinceIso = new Date(Date.now() - STARTUP_LOOKBACK_DAYS * 86_400_000).toISOString();
  const lastLocal = listMemoriesUpdatedSince('1970-01-01');
  const lastLocalIso = lastLocal.length
    ? lastLocal.map((m) => m.updated_at).sort().slice(-1)[0]
    : sinceIso;
  const fetchSince = lastLocalIso > sinceIso ? lastLocalIso : sinceIso;

  const { data, error } = await getSupabase()
    .from('memories')
    .select('id, title, content, scope, status, source, quality_score, performance_score, tags, category, code_block, use_when, avoid_when, embedding, updated_at')
    .in('status', ['Candidate', 'Elevated', 'Trusted'])
    .gt('updated_at', fetchSince)
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MemoryCloudRow[];
  if (rows.length === 0) return 0;

  const cached: CachedMemory[] = rows.map(toCached);
  upsertMemories(cached);
  return rows.length;
}

function toCached(r: MemoryCloudRow): CachedMemory {
  return {
    id: r.id,
    title: r.title ?? '',
    content: r.content ?? '',
    scope: r.scope ?? 'general',
    status: r.status ?? 'Candidate',
    source: r.source ?? 'SEED',
    quality_score: r.quality_score,
    performance_score: r.performance_score,
    tags: r.tags ?? [],
    category: r.category,
    code_block: r.code_block,
    use_when: r.use_when ?? [],
    avoid_when: r.avoid_when ?? [],
    embedding: parseEmbedding(r.embedding),
    updated_at: r.updated_at ?? new Date().toISOString(),
  };
}

function parseEmbedding(raw: string | number[] | null): number[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/* -------------------------------------------------------------------------- */
/*  Offline mistake queue replay                                              */
/* -------------------------------------------------------------------------- */

/**
 * Re-upload any locally-captured mistakes that never made it to the cloud
 * `raw_ingest_queue`. Idempotent: if the cloud already has the row (same
 * primary key), the duplicate insert is silently ignored via ON CONFLICT
 * semantics — but Supabase JS doesn't expose that. We instead pre-check
 * with a select-by-id; if missing, insert.
 */
async function replayOfflineMistakes(): Promise<number> {
  const cache = getLocalCache();
  const all = cache.listMistakes();
  const queued = all.filter((m) => m.delivery === 'queued');
  if (queued.length === 0) return 0;

  let replayed = 0;
  for (const m of queued) {
    try {
      const { data: existing } = await getSupabase()
        .from('raw_ingest_queue')
        .select('id')
        .eq('id', m.id)
        .maybeSingle();
      if (existing) continue;
      const { error } = await getSupabase().from('raw_ingest_queue').insert({
        id: m.id,
        task_id: m.taskId,
        task_text: m.task,
        bad_diff: m.badDiff,
        review_feedback: m.reviewFeedback,
        violated_principles: m.violatedPrinciples,
        retry_count: m.retryCount,
        captured_at: new Date(m.timestamp).toISOString(),
      });
      if (error) {
        console.warn(`[sync] replay failed for ${m.id}: ${error.message}`);
        continue;
      }
      replayed++;
    } catch (err) {
      console.warn(`[sync] replay threw for ${m.id}: ${(err as Error).message}`);
    }
  }
  return replayed;
}

/* -------------------------------------------------------------------------- */
/*  Periodic timer                                                            */
/* -------------------------------------------------------------------------- */

let timer: NodeJS.Timeout | null = null;

export function startSyncTimer(intervalMs = SYNC_INTERVAL_MS): void {
  if (timer) return;
  const tick = async () => {
    try { await runSync(); }
    catch (err) { console.warn('[sync] tick failed:', (err as Error).message); }
  };
  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopSyncTimer(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/* -------------------------------------------------------------------------- */
/*  Convenience re-exports                                                    */
/* -------------------------------------------------------------------------- */

export { initLocalCache, countMemories };
export type { CapturedMistake };