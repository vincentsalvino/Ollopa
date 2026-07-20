/**
 * Memory retrieval service.
 *
 * The live `match_memories` RPC exists in the database but the underlying
 * `memories.embedding` column is `text` (stringified JSON), not a `vector`
 * type, so the `<=>` operator on the function body produces zero results
 * for any reasonable query. Rather than rewrite the RPC, we do retrieval
 * client-side here:
 *   1. Embed the query (OpenRouter text-embedding-3-small, 1536-dim).
 *   2. Pull candidate rows from `memories` (filtered by scope + status).
 *   3. Cosine-rank in JS and return the top N.
 *   4. Best-effort write to local cache + retrieval_log.
 *
 * If Supabase is unreachable at any point, fall back to the local SQLite
 * cache. The cache only contains rows we've previously retrieved, so it
 * may be incomplete; that's an accepted limitation of the offline mode.
 */
import { getSupabase, hasSupabase } from './supabaseClient';
import { getEmbedding, EMBEDDING_DIM } from './embedding';
import {
  initLocalCache,
  upsertMemories,
  searchLocal,
  type CachedMemory,
} from './localCache';
import { logRetrieval } from './retrievalLog';

export interface RetrievedMemory {
  id: string;
  title: string;
  content: string;
  scope: string;
  status: string;
  source: string;
  quality_score: number | null;
  performance_score: number | null;
  tags: string[];
  category: string | null;
  code_block: string | null;
  use_when: string[];
  avoid_when: string[];
  similarity: number;
}

export interface RetrieveParams {
  query: string;
  scope: string;
  agent: string;
  taskId: string;
  limit?: number;
}

export interface RetrieveResult {
  memories: RetrievedMemory[];
  source: 'cloud' | 'cache';
}

const DEFAULT_LIMIT = 5;
const FETCH_LIMIT = 50; // cap on candidate rows pulled from Supabase per query

export async function retrieveMemory(params: RetrieveParams): Promise<RetrieveResult> {
  const limit = params.limit ?? DEFAULT_LIMIT;

  if (!hasSupabase()) {
    return retrieveFromCache(params.query, params.scope, limit);
  }

  let embedding: number[];
  try {
    embedding = await getEmbedding(params.query);
  } catch (err) {
    console.warn('[memory] embedding failed, falling back to cache:', (err as Error).message);
    return retrieveFromCache(params.query, params.scope, limit);
  }

  try {
    const supabase = getSupabase();
    // Pull a candidate set. We only need id, scope, content, and embedding
    // (the rest of the columns come along for free and let us show the user
    // a rich result without a second roundtrip).
    const { data, error } = await supabase
      .from('memories')
      .select('id, title, content, scope, status, source, quality_score, performance_score, tags, category, code_block, use_when, avoid_when, embedding, updated_at')
      .in('scope', [params.scope, 'general'])
      .in('status', ['Candidate', 'Elevated', 'Trusted'])
      .limit(FETCH_LIMIT);

    if (error) throw error;

    const rows = (data ?? []) as MemoryRow[];
    const ranked = rankByCosine(rows, embedding, limit);

    // Best-effort: refresh local cache with what we just retrieved.
    try {
      upsertMemories(rows.map((r) => toCached(r)));
    } catch (err) {
      console.warn('[memory] cache write failed:', (err as Error).message);
    }

    // Best-effort: log retrievals.
    for (const m of ranked) {
      void logRetrieval(m.id, params.query, params.taskId || null, params.agent || null, true);
    }

    return { memories: ranked, source: 'cloud' };
  } catch (err) {
    console.warn('[memory] Supabase unreachable, falling back to cache:', (err as Error).message);
    return retrieveFromCache(params.query, params.scope, limit, embedding);
  }
}

function retrieveFromCache(
  query: string,
  scope: string,
  limit: number,
  prefetchedEmbedding?: number[],
): RetrieveResult {
  // If we have an embedding already, use it. Otherwise we can only return
  // an unranked slice. The cache is best-effort, so this is acceptable.
  const cached = searchLocal(prefetchedEmbedding ?? new Array(EMBEDDING_DIM).fill(0), scope, limit);
  const memories: RetrievedMemory[] = cached.map((m) => ({
    id: m.id,
    title: m.title,
    content: m.content,
    scope: m.scope,
    status: m.status,
    source: m.source,
    quality_score: m.quality_score,
    performance_score: m.performance_score,
    tags: m.tags,
    category: m.category,
    code_block: m.code_block,
    use_when: m.use_when,
    avoid_when: m.avoid_when,
    similarity: 0,
  }));
  return { memories, source: 'cache' };
}

interface MemoryRow {
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

function toCached(r: MemoryRow): CachedMemory {
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

function rankByCosine(rows: MemoryRow[], queryEmbedding: number[], limit: number): RetrievedMemory[] {
  const scored: Array<{ m: RetrievedMemory; score: number }> = [];
  for (const r of rows) {
    const emb = parseEmbedding(r.embedding);
    if (!emb || emb.length !== queryEmbedding.length) continue;
    const score = cosine(queryEmbedding, emb);
    scored.push({ m: rowToRetrieved(r), score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.m);
}

function rowToRetrieved(r: MemoryRow): RetrievedMemory {
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
    similarity: 0,
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Re-export so the sidecar start.ts only imports from this file.
export { initLocalCache };
