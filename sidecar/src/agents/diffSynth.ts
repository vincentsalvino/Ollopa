/**
 * Diff synthesis. The agent records every `search_replace` it issues, and
 * on exit the bridge calls `buildUnifiedDiff` to produce the patch the
 * webview shows for Apply/Reject.
 *
 * This is the cheap, file-local diff path (no git). Per-file, per-edit.
 */
import { createTwoFilesPatch, applyPatch } from 'diff';
import type { SearchReplaceEdit } from './implementation';

export function buildUnifiedDiff(
  filePath: string,
  original: string,
  current: string,
): string {
  // createTwoFilesPatch returns a unified diff with two labels.
  return createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    original,
    current,
    undefined,
    undefined,
    { context: 3 },
  );
}

/**
 * Replay a sequence of search/replace edits against the original content.
 * Returns the final content. Throws if any edit can't be applied exactly.
 */
export function replayEdits(original: string, edits: SearchReplaceEdit[]): string {
  let out = original;
  for (const e of edits) {
    if (!out.includes(e.old_str)) {
      throw new Error(`edit: old_str not found verbatim in ${e.filePath}`);
    }
    // Only replace the first occurrence to keep semantics tight; the LLM
    // is told to make old_str unique, so this is a guard, not a feature.
    out = out.replace(e.old_str, e.new_str);
  }
  return out;
}

/** Helper used by the test to apply a unified diff back to a string. */
export function applyUnifiedDiff(original: string, patch: string): string {
  const res = applyPatch(original, patch, { fuzzFactor: 0 });
  if (res === false) throw new Error('patch did not apply');
  return res;
}
