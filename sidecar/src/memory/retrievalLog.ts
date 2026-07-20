/**
 * Retrieval logging. Best-effort writes to `retrieval_log`. We never let a
 * log failure abort a memory_query response.
 */
import { getSupabase, hasSupabase } from './supabaseClient';

export async function logRetrieval(
  memoryId: string,
  query: string,
  taskId: string | null,
  agent: string | null,
  retrieved: boolean,
): Promise<void> {
  if (!hasSupabase()) return;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('retrieval_log').insert({
      memory_id: memoryId,
      query,
      task_id: taskId,
      agent,
      retrieved,
      used: false,
      success: null,
      created_at: new Date().toISOString(),
    });
    if (error) console.warn('[memory] logRetrieval failed:', error.message);
  } catch (err) {
    console.warn('[memory] logRetrieval threw:', (err as Error).message);
  }
}
