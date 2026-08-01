/**
 * Token budget & summarisation — Phase 8.
 *
 * Rough heuristic: `tokens ≈ max(chars / 4, wordCount / 0.75)`. Good enough
 * for the cap check; we never bill the model, just measure local context.
 *
 * Two helpers:
 *   - `summariseToolOutput(s, max)` — head/tail compression with an
 *     "[... N lines omitted ...]" marker; never drops the last 30 % of
 *     output (where errors usually live).
 *   - `trimMessagesToBudget(messages, budget)` — drops the oldest
 *     non-system messages when the total exceeds `budget` tokens.
 */
import type { ChatMessage } from '../llm/chatClient';

export const DEFAULT_CONTEXT_BUDGET = 8000;
export const TOOL_OUTPUT_TOKEN_BUDGET = 1500;
export const CHAR_PER_TOKEN = 4; // conservative heuristic (Claude tokens ≈ chars/3.5)

export function approxTokens(s: string): number {
  if (!s) return 0;
  return Math.ceil(s.length / CHAR_PER_TOKEN);
}

export function messageTokens(m: ChatMessage): number {
  let n = approxTokens(m.content ?? '');
  if (m.tool_calls) {
    for (const tc of m.tool_calls) {
      n += approxTokens(tc.name) + approxTokens(JSON.stringify(tc.args));
    }
  }
  return n;
}

export function totalTokens(messages: ChatMessage[]): number {
  return messages.reduce((acc, m) => acc + messageTokens(m), 0);
}

/* -------------------------------------------------------------------------- */
/*  Tool output summarisation                                                 */
/* -------------------------------------------------------------------------- */

export function summariseToolOutput(s: string, maxTokens = TOOL_OUTPUT_TOKEN_BUDGET): string {
  if (!s) return s;
  const limit = maxTokens * CHAR_PER_TOKEN;
  if (s.length <= limit) return s;
  const lines = s.split('\n');
  const headRatio = 0.5;
  const headLines = Math.max(1, Math.floor(lines.length * headRatio));
  const tailLines = Math.max(1, Math.floor(lines.length * (1 - headRatio)));
  const omitted = lines.length - headLines - tailLines;
  if (omitted <= 0) {
    // Too few lines to truncate meaningfully — just truncate to char budget.
    return s.slice(0, limit) + `\n…(truncated, ${s.length - limit} more chars)`;
  }
  const head = lines.slice(0, headLines).join('\n');
  const tail = lines.slice(-tailLines).join('\n');
  return `${head}\n…(${omitted} lines omitted; ${s.length - head.length - tail.length} more chars)…\n${tail}`;
}

/* -------------------------------------------------------------------------- */
/*  Message-list trimming                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Drop oldest non-system messages until total ≤ budget. Keeps:
 *   - all `system` messages (principles card)
 *   - the trailing `user`/`assistant`/`tool` messages (recent context)
 *
 * If even after dropping all but system + last two we're over budget, the
 * oldest kept message is force-summarised in place.
 */
export function trimMessagesToBudget(messages: ChatMessage[], budget = DEFAULT_CONTEXT_BUDGET): ChatMessage[] {
  if (totalTokens(messages) <= budget) return messages;
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    out.push(messages[i]);
  }
  // Drop from the front, skipping system messages.
  let dropped = 0;
  while (totalTokens(out) > budget && out.length > 2) {
    if (out[0].role === 'system') {
      // Find the first non-system to drop.
      const idx = out.findIndex((m) => m.role !== 'system');
      if (idx < 1 || idx >= out.length - 1) break; // keep last non-system
      out.splice(idx, 1);
    } else {
      out.shift();
    }
    dropped++;
  }
  // Hard fallback: if even after that we're over, truncate the oldest
  // surviving non-system message.
  if (totalTokens(out) > budget) {
    const idx = out.findIndex((m) => m.role !== 'system');
    if (idx >= 0) {
      const m = out[idx];
      const trimmed = summariseToolOutput(m.content ?? '', budget / 2);
      out[idx] = { ...m, content: trimmed + `\n[truncated by budget — dropped ${dropped} prior messages]` };
    }
  }
  return out;
}