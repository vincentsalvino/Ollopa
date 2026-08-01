/**
 * Refinery — Phase 6.
 *
 * Distills captured mistakes into Candidate memories. Runs on demand
 * (via the `/refine` slash command) or on a timer (every 5 min by default).
 *
 * Pipeline:
 *   1. Pull unrefined mistakes from local cache + cloud `raw_ingest_queue`.
 *   2. Group by violated-principle fingerprint (cheap dedupe).
 *   3. Per group, prompt the LLM to produce 2-sentence Candidate memories.
 *   4. Embed each candidate; dedupe against existing memories by cosine.
 *   5. Insert unique candidates as `Candidate` memories (source: REFINERY).
 *   6. Mark source mistakes as refined locally; delete from cloud queue.
 *
 * Lifecycle:
 *   - Retrieval-positive events (a memory appears in top-3 of a successful
 *     task) bump `performance_score`. Crossing thresholds promotes:
 *       performance_score >= ELEVATED_THRESHOLD  →  'Elevated'
 *       performance_score >= TRUSTED_THRESHOLD   →  'Trusted'
 *   - quality_score is set by an explicit review pass (out of scope here).
 *
 * Failures are logged; the timer keeps trying. The Refinery never blocks
 * other agent work.
 */
import { getLocalCache, upsertMemories, type CachedMemory } from './localCache';
import { getSupabase, hasSupabase } from './supabaseClient';
import { getEmbedding } from './embedding';
import { chatCompletion } from '../llm/chatClient';
import type { CapturedMistake } from './mistakeCapture';
import type { PrincipleId } from '../agents/principles';

export const ELEVATED_THRESHOLD = 0.6;
export const TRUSTED_THRESHOLD = 0.8;
export const MIN_QUALITY_FOR_TRUSTED = 0.7;
export const REFINERY_MODEL = 'openai/gpt-4o-mini';
export const REFINERY_INTERVAL_MS = 5 * 60_000; // 5 min
export const DEDUPE_COSINE = 0.92; // memory is "duplicate" if cosine >= this

export interface RefineryRunResult {
  startedAt: number;
  finishedAt: number;
  mistakesSeen: number;
  candidatesGenerated: number;
  candidatesInserted: number;
  duplicatesSkipped: number;
  errors: string[];
}

export interface CandidateMemory {
  title: string;
  content: string;
  scope: 'general' | string;
  principle: PrincipleId | null;
  use_when: string[];
  avoid_when: string[];
  tags: string[];
}

/* -------------------------------------------------------------------------- */
/*  Distillation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Distill a batch of mistakes into Candidate memory objects. Best-effort:
 * if the LLM call fails, returns an empty array so the caller can move on.
 */
async function distillBatch(mistakes: CapturedMistake[]): Promise<CandidateMemory[]> {
  if (mistakes.length === 0) return [];
  const summaries = mistakes.map((m, i) => {
    const principles = m.violatedPrinciples.length ? m.violatedPrinciples.join(', ') : '(none)';
    const feedback = (m.reviewFeedback || '').slice(0, 400);
    return `Mistake ${i + 1}: task="${m.task.slice(0, 200)}" principles=[${principles}] feedback="${feedback}"`;
  });

  const prompt = `You are the Ollopa Refinery. Distill ${mistakes.length} captured mistake(s) into reusable engineering lessons.

Return strict JSON: an object with "candidates" — an array of up to ${Math.min(mistakes.length * 2, 8)} candidate memories.

Each candidate has:
- "title": short imperative (5-10 words)
- "content": exactly 2 sentences, capturing the lesson and the principle
- "scope": "general" or one of ["frontend", "backend", "architecture"]
- "principle": the engineering principle this lesson teaches, or null
- "use_when": array of short trigger phrases
- "avoid_when": array of short anti-trigger phrases
- "tags": array of 2-5 short tags

Mistakes to distill:
${summaries.join('\n')}

JSON only, no commentary.`;

  try {
    const result = await chatCompletion(
      [
        { role: 'system', content: 'You output strict JSON only. No markdown fences.' },
        { role: 'user', content: prompt },
      ],
      [],
    );
    const text = (result.message.content ?? '').trim();
    const parsed = parseCandidateJson(text);
    if (!parsed) return [];
    return parsed;
  } catch (err) {
    console.warn('[refinery] distillation LLM failed:', (err as Error).message);
    return [];
  }
}

function parseCandidateJson(text: string): CandidateMemory[] | null {
  // Tolerate ```json fences and stray prose.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (!Array.isArray(obj?.candidates)) return null;
    const out: CandidateMemory[] = [];
    for (const c of obj.candidates) {
      if (!c || typeof c.title !== 'string' || typeof c.content !== 'string') continue;
      const sentences = c.content.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (sentences.length === 0) continue;
      out.push({
        title: c.title.slice(0, 120),
        content: sentences.slice(0, 2).join(' ').slice(0, 500),
        scope: typeof c.scope === 'string' ? c.scope : 'general',
        principle: typeof c.principle === 'string' ? (c.principle as PrincipleId) : null,
        use_when: Array.isArray(c.use_when) ? c.use_when.filter((s: unknown) => typeof s === 'string').slice(0, 5) : [],
        avoid_when: Array.isArray(c.avoid_when) ? c.avoid_when.filter((s: unknown) => typeof s === 'string').slice(0, 5) : [],
        tags: Array.isArray(c.tags) ? c.tags.filter((s: unknown) => typeof s === 'string').slice(0, 5) : [],
      });
    }
    return out;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Dedup against existing memories                                           */
/* -------------------------------------------------------------------------- */

async function filterDuplicates(
  candidates: CandidateMemory[],
): Promise<{ unique: Array<CandidateMemory & { embedding: number[] }>; dups: number }> {
  if (candidates.length === 0) return { unique: [], dups: 0 };

  // Pull existing memories for cosine dedupe.
  const existing: Array<{ embedding: number[] }> = [];
  if (hasSupabase()) {
    try {
      const { data } = await getSupabase()
        .from('memories')
        .select('embedding')
        .in('status', ['Candidate', 'Elevated', 'Trusted']);
      for (const r of (data ?? []) as Array<{ embedding: string | number[] | null }>) {
        const v = typeof r.embedding === 'string' ? safeParseNumbers(r.embedding) : (r.embedding ?? null);
        if (v) existing.push({ embedding: v });
      }
    } catch (err) {
      console.warn('[refinery] dedupe fetch failed:', (err as Error).message);
    }
  }

  const out: Array<CandidateMemory & { embedding: number[] }> = [];
  let dups = 0;
  for (const c of candidates) {
    let emb: number[];
    try { emb = await getEmbedding(`${c.title}. ${c.content}`); }
    catch { continue; } // skip on embedding failure — better than corrupting the cache.

    const isDup = existing.some((e) => cosine(emb, e.embedding) >= DEDUPE_COSINE) ||
                  out.some((o) => cosine(emb, o.embedding) >= DEDUPE_COSINE);
    if (isDup) { dups++; continue; }
    out.push({ ...c, embedding: emb });
  }
  return { unique: out, dups };
}

function safeParseNumbers(s: string): number[] | null {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/* -------------------------------------------------------------------------- */
/*  Mistake sources                                                           */
/* -------------------------------------------------------------------------- */

interface CloudMistake {
  id: string;
  task_id: string;
  task_text: string;
  bad_diff: string;
  review_feedback: string;
  violated_principles: string[];
  retry_count: number;
  captured_at: string;
}

async function loadMistakes(): Promise<CapturedMistake[]> {
  const out: CapturedMistake[] = [];
  const cache = getLocalCache();
  out.push(...cache.listMistakes({ unrefinedOnly: true }));

  if (hasSupabase()) {
    try {
      const { data, error } = await getSupabase()
        .from('raw_ingest_queue')
        .select('*')
        .is('refined_at', null)
        .limit(100);
      if (!error && Array.isArray(data)) {
        for (const r of data as CloudMistake[]) {
          out.push({
            id: r.id,
            taskId: r.task_id,
            task: r.task_text,
            badDiff: r.bad_diff,
            reviewFeedback: r.review_feedback,
            violatedPrinciples: (Array.isArray(r.violated_principles) ? r.violated_principles : []) as PrincipleId[],
            retryCount: r.retry_count,
            timestamp: Date.parse(r.captured_at) || Date.now(),
            delivery: 'persisted' as const,
          });
        }
      }
    } catch (err) {
      console.warn('[refinery] cloud queue fetch failed:', (err as Error).message);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Persist new memories                                                      */
/* -------------------------------------------------------------------------- */

async function persistCandidates(
  candidates: Array<CandidateMemory & { embedding: number[] }>,
): Promise<number> {
  if (candidates.length === 0) return 0;
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = candidates.map((c) => ({
    id: `refined-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: c.title,
    content: c.content,
    scope: c.scope,
    status: 'Candidate',
    source: 'REFINERY',
    quality_score: 0.5,            // neutral starting score
    performance_score: 0,
    tags: c.tags,
    category: c.principle,
    code_block: null,
    use_when: c.use_when,
    avoid_when: c.avoid_when,
    embedding: JSON.stringify(c.embedding),
    updated_at: now,
  }));

  // Local cache first (always succeeds).
  try {
    const cached: CachedMemory[] = rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      content: r.content as string,
      scope: r.scope as string,
      status: r.status as string,
      source: r.source as string,
      quality_score: r.quality_score as number,
      performance_score: r.performance_score as number,
      tags: r.tags as string[],
      category: r.category as string | null,
      code_block: null,
      use_when: r.use_when as string[],
      avoid_when: r.avoid_when as string[],
      embedding: JSON.parse(r.embedding as string),
      updated_at: r.updated_at as string,
    }));
    upsertMemories(cached);
  } catch (err) {
    console.warn('[refinery] local cache insert failed:', (err as Error).message);
  }

  // Cloud write.
  if (hasSupabase()) {
    try {
      const { error } = await getSupabase().from('memories').insert(rows);
      if (error) {
        console.warn('[refinery] cloud insert failed:', error.message);
      }
    } catch (err) {
      console.warn('[refinery] cloud insert threw:', (err as Error).message);
    }
  }
  return rows.length;
}

async function markRefined(mistakeIds: string[]): Promise<void> {
  if (mistakeIds.length === 0) return;
  const cache = getLocalCache();
  for (const id of mistakeIds) {
    try { cache.markMistakeRefined(id); } catch { /* noop */ }
  }
  if (hasSupabase()) {
    try {
      await getSupabase()
        .from('raw_ingest_queue')
        .update({ refined_at: new Date().toISOString() })
        .in('id', mistakeIds);
    } catch (err) {
      console.warn('[refinery] cloud refine-mark failed:', (err as Error).message);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Entry points                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Run one distillation cycle. Safe to call concurrently — internal LLM
 * calls are not stateful, but the local cache writes are serialised by
 * `better-sqlite3`'s single-writer model.
 */
export async function runRefinery(): Promise<RefineryRunResult> {
  const startedAt = Date.now();
  const errors: string[] = [];
  let candidatesGenerated = 0;
  let candidatesInserted = 0;
  let duplicatesSkipped = 0;

  let mistakes: CapturedMistake[];
  try { mistakes = await loadMistakes(); }
  catch (err) { mistakes = []; errors.push(`load: ${(err as Error).message}`); }

  if (mistakes.length === 0) {
    return { startedAt, finishedAt: Date.now(), mistakesSeen: 0, candidatesGenerated: 0, candidatesInserted: 0, duplicatesSkipped: 0, errors };
  }

  let candidates: CandidateMemory[];
  try { candidates = await distillBatch(mistakes); }
  catch (err) { candidates = []; errors.push(`distill: ${(err as Error).message}`); }
  candidatesGenerated = candidates.length;

  let unique: Array<CandidateMemory & { embedding: number[] }>;
  try {
    const out = await filterDuplicates(candidates);
    unique = out.unique;
    duplicatesSkipped = out.dups;
  } catch (err) {
    unique = [];
    errors.push(`dedupe: ${(err as Error).message}`);
  }

  try { candidatesInserted = await persistCandidates(unique); }
  catch (err) { errors.push(`persist: ${(err as Error).message}`); }

  try { await markRefined(mistakes.map((m) => m.id)); }
  catch (err) { errors.push(`markRefined: ${(err as Error).message}`); }

  const finishedAt = Date.now();
  const summary = {
    startedAt, finishedAt,
    mistakesSeen: mistakes.length,
    candidatesGenerated,
    candidatesInserted,
    duplicatesSkipped,
    errors,
  };
  console.log(`[refinery] ${JSON.stringify(summary)}`);
  return summary;
}

/* -------------------------------------------------------------------------- */
/*  Lifecycle promotion                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Bump `performance_score` for a memory by `delta` (clamped to [0, 1]).
 * Promotes Candidate → Elevated → Trusted based on thresholds. Called by
 * any code that observes a memory being useful (e.g. a successful agent
 * turn retrieved it).
 */
export async function recordMemorySuccess(memoryId: string, delta = 0.1): Promise<void> {
  if (!memoryId) return;
  let newScore = 0;
  let current: { performance_score: number | null; status: string } | null = null;

  if (hasSupabase()) {
    try {
      const { data } = await getSupabase().from('memories').select('performance_score, status').eq('id', memoryId).maybeSingle();
      current = data ?? null;
    } catch { /* fall through */ }
  }
  if (!current) {
    try {
      // Local fallback — better-sqlite3 directly (no public read API for
      // single-row performance_score; we mirror via getLocalCache later).
      newScore = 0;
    } catch { /* noop */ }
  }
  const prev = current?.performance_score ?? 0;
  newScore = Math.max(0, Math.min(1, prev + delta));
  const newStatus = scoreToStatus(newScore);
  const quality = 0.5; // not tracked yet — keep at neutral

  try { getLocalCache().promoteMemory(memoryId, newStatus, quality, newScore); } catch { /* noop */ }
  if (hasSupabase()) {
    try {
      await getSupabase().from('memories').update({ performance_score: newScore, status: newStatus }).eq('id', memoryId);
    } catch (err) {
      console.warn('[refinery] promotion write failed:', (err as Error).message);
    }
  }
}

function scoreToStatus(score: number): 'Candidate' | 'Elevated' | 'Trusted' {
  if (score >= TRUSTED_THRESHOLD) return 'Trusted';
  if (score >= ELEVATED_THRESHOLD) return 'Elevated';
  return 'Candidate';
}

/* -------------------------------------------------------------------------- */
/*  Background timer                                                          */
/* -------------------------------------------------------------------------- */

let timer: NodeJS.Timeout | null = null;

export function startRefineryTimer(intervalMs = REFINERY_INTERVAL_MS): void {
  if (timer) return;
  const tick = async () => {
    try { await runRefinery(); }
    catch (err) { console.warn('[refinery] tick failed:', (err as Error).message); }
  };
  timer = setInterval(tick, intervalMs);
  // Don't keep the event loop alive purely for the refinery.
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopRefineryTimer(): void {
  if (timer) { clearInterval(timer); timer = null; }
}