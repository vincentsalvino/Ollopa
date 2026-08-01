/**
 * Generic key-pool circuit breaker (Phase 8).
 *
 * Sits between the direct-router loop and the OpenAI-compatible adapter.
 * Any provider entry can declare `keys[]`; the pool rotates within them,
 * marks a key exhausted on 429 / quota body, and recovers it once the
 * cooldown window passes.
 *
 * Ollama Cloud (`https://api.ollama.com/v1`) is the first preset, but the
 * pool is provider-agnostic — DeepSeek, OpenRouter, or any other entries
 * with multiple keys can use the same code path.
 *
 * State persistence: `~/.ollopa/keypool.json` (debounced 250ms). The
 * extension mirrors `lastSeenAt` per (provider, key) into
 * `context.globalState` so toggling settings mid-session does not clobber
 * a cooldown that is still active.
 *
 * Standard library only — `node:fs` + `node:path`. No new deps.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type KeyStatus = 'active' | 'cooldown' | 'exhausted';

export interface KeyState {
  /** Index in the provider's `keys[]` array. */
  index: number;
  status: KeyStatus;
  /** When the cooldown window lifts. ms epoch. */
  cooldownUntil?: number;
  /** Last successful use. ms epoch. */
  lastUsed?: number;
  errorCount: number;
  successCount: number;
}

export interface KeyPoolDefaults {
  /** Weekly reset window (Ollama Cloud). ms. */
  weeklyMs?: number;
  /** Session reset window (Ollama Cloud). ms. */
  sessionMs?: number;
  /** Generic fallback when no header hint and no keyword match. ms. */
  cooldownMs?: number;
}

export interface PoolEntry {
  provider: string;
  /** In-order. An index is "configured" iff its string is non-empty. */
  keys: string[];
  states: KeyState[];
  /** Round-robin cursor. Persists across calls. */
  cursor: number;
  defaults?: KeyPoolDefaults;
}

export interface PoolSnapshot {
  /** provider name → entry. Order is preserved by insertion. */
  entries: Record<string, PoolEntry>;
  /** ms epoch the sidecar last saw this file. Used by the extension to
   *  decide whether to clobber cooldown state on the next spawn. */
  lastSeenAt: number;
}

const POOL_PATH = path.join(os.homedir(), '.ollopa', 'keypool.json');
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000;          // 1h
const DEFAULT_WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;   // 7d
const DEFAULT_SESSION_MS = 2 * 60 * 60 * 1000;       // 2h

let cached: PoolSnapshot | null = null;
let saveTimer: NodeJS.Timeout | null = null;

/* -------------------------------------------------------------------------- */
/*  Load / save                                                               */
/* -------------------------------------------------------------------------- */

export function loadPool(): PoolSnapshot {
  if (cached) return cached;
  try {
    if (existsSync(POOL_PATH)) {
      const raw = readFileSync(POOL_PATH, 'utf8');
      const json = JSON.parse(raw);
      if (json && typeof json === 'object' && json.entries) {
        cached = json as PoolSnapshot;
        return cached;
      }
    }
  } catch (err) {
    console.warn(`[keyPool] failed to read ${POOL_PATH}:`, (err as Error).message);
  }
  cached = { entries: {}, lastSeenAt: Date.now() };
  return cached;
}

/** Debounced: collapse bursts of state transitions into one write. */
function savePool(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!cached) return;
    try {
      mkdirSync(path.dirname(POOL_PATH), { recursive: true });
      cached.lastSeenAt = Date.now();
      writeFileSync(POOL_PATH, JSON.stringify(cached, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[keyPool] failed to write ${POOL_PATH}:`, (err as Error).message);
    }
  }, 250);
}

/** Test helper — wipe the in-memory cache so the next call re-reads disk. */
export function resetPoolForTests(): void {
  cached = null;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}

/* -------------------------------------------------------------------------- */
/*  Entry helpers                                                             */
/* -------------------------------------------------------------------------- */

export interface PoolConfig {
  provider: string;
  keys: string[];
  defaults?: KeyPoolDefaults;
}

/** Get a snapshot of the pool entry for one provider, creating it if needed. */
export function getEntry(cfg: PoolConfig): PoolEntry {
  const snap = loadPool();
  let entry = snap.entries[cfg.provider];
  if (entry) {
    // Reconcile keys[] length — settings may have grown or shrunk.
    if (entry.keys.length !== cfg.keys.length) {
      entry.keys = cfg.keys.slice();
      entry.states = reconcileStates(entry.states, cfg.keys.length);
    }
    entry.defaults = cfg.defaults ?? entry.defaults;
    return entry;
  }
  entry = {
    provider: cfg.provider,
    keys: cfg.keys.slice(),
    states: cfg.keys.map((_, i) => freshState(i)),
    cursor: 0,
    defaults: cfg.defaults,
  };
  snap.entries[cfg.provider] = entry;
  savePool();
  return entry;
}

/** Drop a key from the pool (e.g. user removed it from settings). */
export function dropKey(provider: string, index: number): void {
  const snap = loadPool();
  const entry = snap.entries[provider];
  if (!entry) return;
  entry.keys[index] = '';
  entry.states[index] = freshState(index);
  savePool();
}

/* -------------------------------------------------------------------------- */
/*  Pick / transition                                                         */
/* -------------------------------------------------------------------------- */

export interface PickResult {
  /** Index of the chosen key, or -1 if every key is exhausted. */
  index: number;
  /** Resolved key value (empty string if none configured). */
  apiKey: string;
  /** How many keys are currently usable (status === 'active' and configured). */
  usable: number;
  /** How many keys are configured total. */
  total: number;
  /** Earliest cooldown expiry, if any key is currently exhausted. ms epoch. */
  earliestResetMs?: number;
}

/**
 * Round-robin pick. Skips unconfigured (empty) and currently-exhausted
 * keys. Calls `prune(now)` first so recently-expired cooldowns are
 * reopened without a separate maintenance loop.
 */
export function pick(cfg: PoolConfig, now: number = Date.now()): PickResult {
  const entry = getEntry(cfg);
  prune(entry, now);
  const total = entry.keys.length;
  let usable = 0;
  let earliestReset: number | undefined;
  for (let i = 0; i < entry.states.length; i++) {
    const s = entry.states[i];
    if (s.status === 'exhausted' || s.status === 'cooldown') {
      if (s.cooldownUntil && (!earliestReset || s.cooldownUntil < earliestReset)) {
        earliestReset = s.cooldownUntil;
      }
    }
    if (entry.keys[i] && s.status === 'active') usable++;
  }
  if (usable === 0) {
    return { index: -1, apiKey: '', usable: 0, total, earliestResetMs: earliestReset };
  }
  // Start the round-robin search at the cursor and walk forward.
  for (let i = 0; i < total; i++) {
    const idx = (entry.cursor + i) % total;
    const s = entry.states[idx];
    if (entry.keys[idx] && s.status === 'active') {
      entry.cursor = (idx + 1) % total;
      return { index: idx, apiKey: entry.keys[idx], usable, total, earliestResetMs: earliestReset };
    }
  }
  // Should not happen — usable > 0 but no active found means pruning needed.
  return { index: -1, apiKey: '', usable: 0, total, earliestResetMs: earliestReset };
}

export function markExhausted(provider: string, index: number, resetMs: number | undefined, now: number = Date.now()): void {
  const entry = loadPool().entries[provider];
  if (!entry || !entry.states[index]) return;
  entry.states[index] = {
    ...entry.states[index],
    status: 'exhausted',
    cooldownUntil: resetMs ?? (now + (entry.defaults?.cooldownMs ?? DEFAULT_COOLDOWN_MS)),
  };
  savePool();
}

export function markSuccess(provider: string, index: number, now: number = Date.now()): void {
  const entry = loadPool().entries[provider];
  if (!entry || !entry.states[index]) return;
  entry.states[index] = {
    ...entry.states[index],
    status: 'active',
    cooldownUntil: undefined,
    lastUsed: now,
    successCount: entry.states[index].successCount + 1,
    errorCount: 0,
  };
  savePool();
}

export function markError(provider: string, index: number, now: number = Date.now()): void {
  const entry = loadPool().entries[provider];
  if (!entry || !entry.states[index]) return;
  entry.states[index] = {
    ...entry.states[index],
    lastUsed: now,
    errorCount: entry.states[index].errorCount + 1,
  };
  savePool();
}

/** Flip expired cooldowns back to active. Idempotent. */
export function prune(entry: PoolEntry, now: number): void {
  let changed = false;
  for (let i = 0; i < entry.states.length; i++) {
    const s = entry.states[i];
    if ((s.status === 'exhausted' || s.status === 'cooldown') && s.cooldownUntil && s.cooldownUntil <= now) {
      entry.states[i] = { ...s, status: 'active', cooldownUntil: undefined };
      changed = true;
    }
  }
  if (changed) savePool();
}

/* -------------------------------------------------------------------------- */
/*  Exhaustion detection                                                      */
/* -------------------------------------------------------------------------- */

export interface ExhaustionResult {
  exhausted: boolean;
  /** ms epoch when the key should be retried. Undefined = use provider default. */
  resetMs?: number;
  /** Which body keyword matched, for diagnostics / UI display. */
  matched?: string;
}

/**
 * Body-keyword signals that indicate quota exhaustion. Case-insensitive
 * substring match. Order matters — the first match wins and determines the
 * default reset window.
 */
const BODY_SIGNALS: Array<{ phrase: string; window: 'weekly' | 'session' | 'generic' }> = [
  { phrase: 'weekly limit', window: 'weekly' },
  { phrase: 'session limit', window: 'session' },
  { phrase: 'quota exceeded', window: 'generic' },
  { phrase: 'insufficient credits', window: 'generic' },
  { phrase: 'usage limit reached', window: 'generic' },
  { phrase: 'rate limit exceeded', window: 'generic' },
];

export function exhaustionSignals(
  res: { status: number; headers?: Headers | Record<string, string> },
  bodyText: string | undefined,
  defaults: KeyPoolDefaults | undefined,
  now: number = Date.now(),
): ExhaustionResult {
  // 429 is the canonical signal. Headers carry the reset window.
  if (res.status === 429) {
    const resetMs = parseResetHeader(res.headers, now);
    return { exhausted: true, resetMs };
  }
  if (res.status >= 500 && res.status < 600) {
    return { exhausted: false };
  }
  const lower = (bodyText ?? '').toLowerCase();
  for (const sig of BODY_SIGNALS) {
    if (lower.includes(sig.phrase)) {
      const resetMs = parseResetHeader(res.headers, now) ?? defaultWindow(sig.window, defaults, now);
      return { exhausted: true, resetMs, matched: sig.phrase };
    }
  }
  return { exhausted: false };
}

function parseResetHeader(headers: Headers | Record<string, string> | undefined, now: number): number | undefined {
  if (!headers) return undefined;
  const get = (k: string): string | null =>
    headers instanceof Headers ? headers.get(k) : (headers[k] ?? null);
  const candidates = [
    get('x-ratelimit-reset'),
    get('x-ratelimit-reset-requests'),
    get('retry-after'),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const v = parseInt(raw, 10);
    if (Number.isNaN(v)) continue;
    // Unix timestamp in seconds (large number, post-2001).
    if (v > 1_000_000_000) return v * 1000;
    // Seconds-from-now (small number).
    return now + v * 1000;
  }
  return undefined;
}

function defaultWindow(kind: 'weekly' | 'session' | 'generic', defaults: KeyPoolDefaults | undefined, now: number): number {
  if (kind === 'weekly') return now + (defaults?.weeklyMs ?? DEFAULT_WEEKLY_MS);
  if (kind === 'session') return now + (defaults?.sessionMs ?? DEFAULT_SESSION_MS);
  return now + (defaults?.cooldownMs ?? DEFAULT_COOLDOWN_MS);
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function freshState(index: number): KeyState {
  return { index, status: 'active', errorCount: 0, successCount: 0 };
}

function reconcileStates(existing: KeyState[], target: number): KeyState[] {
  const out: KeyState[] = [];
  for (let i = 0; i < target; i++) {
    out.push(existing[i] ?? freshState(i));
  }
  return out;
}

/** Serialize the pool state for the UI chip. */
export function snapshotForUi(provider: string): { keys: { configured: boolean; status: KeyStatus; cooldownUntil?: number }[] } | null {
  const entry = loadPool().entries[provider];
  if (!entry) return null;
  return {
    keys: entry.keys.map((k, i) => ({
      configured: !!k,
      status: entry.states[i]?.status ?? 'active',
      cooldownUntil: entry.states[i]?.cooldownUntil,
    })),
  };
}
