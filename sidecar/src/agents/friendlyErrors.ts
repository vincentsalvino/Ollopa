/**
 * Friendly error mapper — Phase 8.
 *
 * Internal errors frequently leak sensitive details: file paths, Supabase
 * SQL fragments, regex source, stack traces. This module redacts the
 * icky parts and maps common patterns to human-readable copy before the
 * webview sees them.
 */

const PATH_LIKE = /(?:\/|[A-Za-z]:\\)[\w\-./\\]+/g;
const TABLE_REFERENCE = /(?:`?\w+`?\.)?`?(?:public|memories|raw_ingest_queue|memories_emb|mistakes)`?/gi;
const POSTGRES_CODE = /\b(?:[A-Z]{2,5}\d{3,5})\b/g;

const MAX_LEN = 240;

/**
 * Map a raw error message to a friendly, redacted summary. Never throws.
 */
export function friendlyError(err: unknown, context?: string): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (!raw) return context ?? 'Something went wrong. Please try again.';

  let out = raw;
  // Redact filesystem paths.
  out = out.replace(PATH_LIKE, '…');
  // Redact table references that hint at schema.
  out = out.replace(TABLE_REFERENCE, '[table]');
  // Redact SQLSTATE-style codes.
  out = out.replace(POSTGRES_CODE, '[code]');

  // Pattern → friendly message.
  const low = out.toLowerCase();
  if (low.includes('api key') || low.includes('unauthorized') || low.includes('401')) {
    return 'Authentication failed. Check your provider API keys.';
  }
  if (low.includes('rate limit') || low.includes('429')) {
    return 'Provider rate-limited the request. Please retry in a moment.';
  }
  if (low.includes('timeout') || low.includes('timed out')) {
    return 'The operation timed out. Please retry.';
  }
  if (low.includes('econnrefused') || low.includes('enotfound') || low.includes('network')) {
    return 'Network unreachable. Check your connection or provider endpoint.';
  }
  if (low.includes('supabase') || low.includes('[table]')) {
    return 'Cloud sync failed. Working from local cache if available.';
  }
  if (low.includes('quota') || low.includes('billing')) {
    return 'Provider quota exceeded. Check your billing or switch provider.';
  }
  if (low.includes('cancelled')) {
    return 'Task cancelled.';
  }

  // Fallback: trim and prefix with context if provided.
  let fallback = out.replace(/\s+/g, ' ').trim();
  if (fallback.length > MAX_LEN) fallback = fallback.slice(0, MAX_LEN) + '…';
  if (context) return `${context}: ${fallback}`;
  return fallback;
}