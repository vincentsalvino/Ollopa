/**
 * Mistake & Repair capture — Phase 4.
 *
 * On a final task FAIL we record the bad diff + review feedback + the
 * principles the review flagged. The Refinery (Phase 6) distills these
 * into Candidate memories. We do not require Supabase here — if the
 * cloud is offline the record is queued in the local cache.
 */
import type { PrincipleId } from '../agents/principles';
import { getLocalCache } from './localCache';
import { getSupabase } from './supabaseClient';

export interface MistakeCapture {
  taskId: string;
  task: string;
  badDiff: string;
  reviewFeedback: string;
  violatedPrinciples: PrincipleId[];
  retryCount: number;
}

export interface CapturedMistake extends MistakeCapture {
  id: string;
  timestamp: number;
  /** 'queued' = local only; 'persisted' = written to Supabase. */
  delivery: 'queued' | 'persisted' | 'failed';
  errorMessage?: string;
}

/**
 * Capture a mistake. Best-effort: never throw, never block the caller.
 * Returns a status object so the graph can log what happened.
 */
export async function captureMistake(input: MistakeCapture): Promise<CapturedMistake> {
  const id = `mistake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record: CapturedMistake = {
    ...input,
    id,
    timestamp: Date.now(),
    delivery: 'queued',
  };

  // Local cache: always write, regardless of cloud availability.
  try {
    const cache = getLocalCache();
    cache.insertMistake(record);
  } catch (err) {
    record.delivery = 'failed';
    record.errorMessage = `local cache: ${(err as Error).message}`;
    console.warn('[mistake] local insert failed:', (err as Error).message);
  }

  // Supabase: best-effort. If unavailable, the local row stays and the
  // Refinery will pick it up on next sync.
  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb.from('raw_ingest_queue').insert({
        id: record.id,
        task_id: record.taskId,
        task_text: record.task,
        bad_diff: record.badDiff,
        review_feedback: record.reviewFeedback,
        violated_principles: record.violatedPrinciples,
        retry_count: record.retryCount,
        captured_at: new Date(record.timestamp).toISOString(),
      });
      if (error) {
        record.delivery = 'queued'; // local row still there
        record.errorMessage = `supabase: ${error.message}`;
      } else {
        record.delivery = 'persisted';
      }
    } catch (err) {
      record.delivery = 'queued';
      record.errorMessage = `supabase: ${(err as Error).message}`;
    }
  }

  console.warn(`[mistake] captured task=${record.taskId.slice(0, 8)} principles=[${record.violatedPrinciples.join(',')}] delivery=${record.delivery}`);
  return record;
}
