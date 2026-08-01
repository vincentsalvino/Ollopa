/**
 * LLM provider router — Phase 3.5.
 *
 * Default: OmniRoute (http://localhost:20128). If unreachable or the user has
 * forced direct mode, fall through to a sequential list of direct OpenAI-
 * compatible providers (DeepSeek, OpenRouter, Mimo, …) configured in VS Code
 * settings and stored in SecretStorage.
 *
 * Routing is decided per call, not per process — if OmniRoute goes down
 * mid-session, the next call falls back automatically. The resolved backend
 * for the last call is reported back so the caller can show the user a
 * "OmniRoute · auto" or "Direct · deepseek" chip.
 *
 * Standard library only: native `fetch` with an AbortController-based timeout.
 * No new dependencies.
 */
import type { ChatMessage, ChatResult, ToolDefinition } from './chatClient';
import { getAdapter, type ProviderConfig } from './providerRegistry';
import { loadPrivacyConfig } from '../privacy/privacy';
import { appendAudit } from '../audit/auditLog';
import { exhaustionSignals, pick as keyPoolPick, markExhausted, markSuccess, markError, type KeyPoolDefaults } from './keyPool';

/**
 * Phase 6: re-read the env each call so settings toggled mid-session
 * take effect on the next chat. Cheap (one env parse).
 */
function privacyLocalOnly(): boolean {
  return loadPrivacyConfig().localOnly;
}

export type ProviderName = string;

export interface DirectProviderConfig {
  /** Stable name (e.g. "deepseek"). */
  name: ProviderName;
  /** OpenAI-compatible base URL, e.g. https://api.deepseek.com/v1. */
  baseUrl: string;
  /** Whether this provider is enabled. Disabled providers are skipped. */
  enabled: boolean;
  /** Resolved API key. May be empty if user has not yet added it. */
  apiKey: string;
  /** Model to request. If omitted, the global LLM_MODEL is used. */
  model?: string;
  /**
   * Phase 4: provider adapter kind. Defaults to "openai-compatible".
   * Use "ollama" for local Ollama (no API key needed).
   */
  kind?: 'openai-compatible' | 'anthropic' | 'ollama';
  /**
   * Phase 8: optional key pool. When length > 1, the router round-robins
   * within this pool, marks keys exhausted on 429/quota, and recovers
   * them when the cooldown window passes. `apiKey` is ignored when a
   * pool is configured.
   */
  keys?: string[];
  /**
   * Phase 8: pool reset windows. Falls back to module defaults when
   * missing (7d weekly / 2h session / 1h generic).
   */
  poolDefaults?: KeyPoolDefaults;
  /**
   * Phase 8: cursor from the most recent pick. Surfaced in the
   * `ResolvedBackend` so the UI chip can render `[2/3]`.
   */
  currentKeyIndex?: number;
  /** Phase 8: how many keys are configured total. */
  keyTotal?: number;
}

export interface ProviderRouterConfig {
  /** Base URL for OmniRoute. Empty/null disables. */
  omnirouteUrl: string | null;
  /** true if the user has toggled direct mode in the UI. */
  forceDirect: boolean;
  /** Direct providers in priority order. */
  directProviders: DirectProviderConfig[];
  /** Default model used when a provider does not specify one. */
  defaultModel: string;
  /**
   * Phase 4: ordered list of provider NAMES to try as fallback after
   * the primary. Empty = use `directProviders` order.
   */
  fallbackChain?: string[];
  /**
   * Phase 4: per-call override. If set, bypasses OmniRoute and the
   * normal fallback chain — just calls this provider once.
   */
  overrideProvider?: ProviderName;
}

export type ResolvedBackend =
  | { kind: 'omniroute'; model: string }
  | { kind: 'direct'; provider: ProviderName; model: string; keyIndex?: number; keyTotal?: number };

export interface ResolvedChatResult extends ChatResult {
  backend: ResolvedBackend;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function pingOmniRoute(baseUrl: string): Promise<boolean> {
  // /v1/models is a standard OpenAI-compatible health check.
  // 2xx = up; anything else = down. Short timeout — this is called on UI events.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/models`, {
      method: 'GET',
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Pick a backend and dispatch. The order:
 *   1. OmniRoute (if not forceDirect and ping returns healthy)
 *   2. Direct providers in declared order, first enabled with a key wins
 *
 * The ping is cached for a short window (5s) so a burst of completions in the
 * same agent loop doesn't hammer localhost:20128.
 */
let omnirouteCache: { url: string; healthy: boolean; ts: number } | null = null;
const OMNIROUTE_CACHE_MS = 5_000;

export async function chatWithRouter(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  cfg: ProviderRouterConfig,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ResolvedChatResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Phase 4: per-call override short-circuits everything.
  if (cfg.overrideProvider) {
    const p = cfg.directProviders.find((x) => x.name === cfg.overrideProvider);
    if (!p) throw new Error(`override provider not found: ${cfg.overrideProvider}`);
    if (!p.enabled) throw new Error(`override provider disabled: ${p.name}`);
    const result = await callProvider(p, messages, tools, { timeoutMs, signal: opts.signal });
    return { ...result, backend: { kind: 'direct', provider: p.name, model: p.model ?? cfg.defaultModel } };
  }

  if (!cfg.forceDirect && cfg.omnirouteUrl) {
    const url = cfg.omnirouteUrl.replace(/\/+$/, '');
    if (privacyLocalOnly()) {
      void appendAudit({ kind: 'cloud_provider_blocked', source: 'omniroute', detail: 'localOnly mode active' });
    } else {
      const cached = omnirouteCache;
      let healthy = cached && cached.url === url ? cached.healthy : false;
      if (!cached || cached.url !== url || Date.now() - cached.ts > OMNIROUTE_CACHE_MS) {
        healthy = await pingOmniRoute(url);
        omnirouteCache = { url, healthy, ts: Date.now() };
      }
      if (healthy) {
        const result = await callOmniRoute(url, messages, tools, { timeoutMs, signal: opts.signal });
        return { ...result, backend: { kind: 'omniroute', model: 'auto' } };
      }
    }
  }

  // Direct fallback. Phase 4: honour explicit `fallbackChain` if set.
  // Phase 6: in local-only mode, drop cloud providers (kind != 'ollama')
  // and audit each skipped provider.
  const order = pickOrder(cfg);
  let lastErr: unknown = null;
  for (const p of order) {
    if (!p.enabled) continue;
    if (privacyLocalOnly() && (p.kind ?? 'openai-compatible') !== 'ollama') {
      void appendAudit({ kind: 'cloud_provider_blocked', source: p.name, detail: 'localOnly mode active' });
      continue;
    }
    // Phase 8: rotate through key pool if configured. Loop per-key so a
    // single exhausted key falls through to the next key in the same
    // provider before we give up on the provider entirely.
    const adapter = getAdapter(p.kind ?? 'openai-compatible');
    if (adapter.requiresApiKey && !p.apiKey && !(p.keys && p.keys.length > 0)) continue;
    const model = p.model ?? cfg.defaultModel;
    const poolKeys = (p.keys && p.keys.length > 0) ? p.keys : null;

    if (!poolKeys) {
      // Legacy single-key path — unchanged.
      try {
        const result = await callProvider(p, messages, tools, { timeoutMs, signal: opts.signal });
        return { ...result, backend: { kind: 'direct', provider: p.name, model } };
      } catch (err) {
        lastErr = err;
      }
      continue;
    }

    // Phase 8: per-key rotation within this provider.
    let providerErr: unknown = null;
    let pickedIdx = -1;
    let pickedKey = '';
    // Try up to N rounds of the pool — picks may yield different keys as
    // cooldowns expire mid-loop.
    for (let attempt = 0; attempt < poolKeys.length; attempt++) {
      const picked = keyPoolPick({ provider: p.name, keys: poolKeys, defaults: p.poolDefaults });
      if (picked.index < 0) {
        providerErr = new Error(
          picked.earliestResetMs
            ? `provider ${p.name}: all keys exhausted, earliest reset in ${Math.ceil((picked.earliestResetMs - Date.now()) / 1000)}s`
            : `provider ${p.name}: no keys configured`,
        );
        break;
      }
      pickedIdx = picked.index;
      pickedKey = picked.apiKey;
      const candidate: DirectProviderConfig = { ...p, apiKey: pickedKey, currentKeyIndex: picked.index, keyTotal: poolKeys.length };
      try {
        const result = await callProvider(candidate, messages, tools, { timeoutMs, signal: opts.signal });
        markSuccess(p.name, picked.index);
        return {
          ...result,
          backend: { kind: 'direct', provider: p.name, model, keyIndex: picked.index, keyTotal: poolKeys.length },
        };
      } catch (err) {
        lastErr = err;
        providerErr = err;
        // Classify the error: 429/quota → mark exhausted; 5xx → transient;
        // 4xx other → give up immediately.
        const cls = classifyError(err);
        if (cls.kind === 'exhausted') {
          markExhausted(p.name, picked.index, cls.resetMs);
          void appendAudit({
            kind: 'keypool_exhausted',
            source: p.name,
            detail: `key[${picked.index}] exhausted, reset in ${cls.resetMs ? Math.ceil((cls.resetMs - Date.now()) / 1000) + 's' : 'default window'}`,
          });
          // Try the next key in the same provider.
          continue;
        }
        if (cls.kind === 'transient') {
          markError(p.name, picked.index);
          continue;
        }
        // Hard 4xx (bad request etc.) — surface, don't waste more keys.
        break;
      }
    }
    // Whole provider failed; move to the next one.
    if (providerErr) lastErr = providerErr;
  }
  throw new Error(
    `No LLM backend available. ${lastErr ? 'Last error: ' + (lastErr as Error).message : 'Configure OmniRoute or add a direct provider key.'}`,
  );
}

/**
 * Phase 4: pick the order in which to try direct providers. If a
 * `fallbackChain` is set, use it (looking up names in `directProviders`).
 * Otherwise use the declared order.
 */
function pickOrder(cfg: ProviderRouterConfig): DirectProviderConfig[] {
  if (!cfg.fallbackChain || cfg.fallbackChain.length === 0) return cfg.directProviders;
  const byName = new Map(cfg.directProviders.map((p) => [p.name, p]));
  const out: DirectProviderConfig[] = [];
  for (const name of cfg.fallbackChain) {
    const p = byName.get(name);
    if (p) out.push(p);
  }
  // Append any unmentioned providers at the end as a final safety net.
  for (const p of cfg.directProviders) if (!out.includes(p)) out.push(p);
  return out;
}

async function callProvider(
  p: DirectProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  opts: { timeoutMs?: number; signal?: AbortSignal },
): Promise<ChatResult> {
  const adapter = getAdapter(p.kind ?? 'openai-compatible');
  const cfg: ProviderConfig = {
    kind: adapter.kind,
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    model: p.model ?? '',
  };
  return adapter.call(cfg, messages, tools, opts);
}

export async function callOmniRoute(
  baseUrl: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ChatResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const res = await postChat(url, /* apiKey */ null, /* model */ 'auto', messages, tools, opts);
  return parseOpenAIChat(res, /* expectAuth */ false);
}

export async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ChatResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await postChat(url, apiKey, model, messages, tools, opts);
  return parseOpenAIChat(res, /* expectAuth */ true);
}

async function postChat(
  url: string,
  apiKey: string | null,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  opts: { timeoutMs?: number; signal?: AbortSignal },
): Promise<Response> {
  const body: Record<string, unknown> = { model, messages, temperature: 0.2 };
  if (tools.length > 0) body.tools = tools;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function parseOpenAIChat(res: Response, expectAuth: boolean): ChatResult {
  if (!res.ok) {
    if (expectAuth && res.status === 401) {
      throw new Error(`Provider auth failed (401). Check the API key for this provider.`);
    }
    // Read body best-effort. Some providers stream JSON; we don't.
    return res.text().then((t) => {
      throw new Error(`Provider ${res.status}: ${t.slice(0, 200)}`);
    }) as unknown as ChatResult;
  }
  return res.json().then((json) => {
    const j = json as OpenAIChatResponse;
    const choice = j.choices?.[0];
    if (!choice) throw new Error('Provider returned no choices');
    const raw = choice.message ?? { role: 'assistant', content: '' };
    const toolCalls = (raw.tool_calls ?? []).map((tc) => parseToolCall(tc));
    return {
      message: {
        role: 'assistant',
        content: raw.content ?? '',
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
    };
  }) as unknown as ChatResult;
}

// Local copies of the OpenAI types — we don't want to pull the chatClient
// surface (its `parseToolCall` is private).
function parseToolCall(tc: RawToolCall): { id: string; name: string; args: Record<string, unknown> } {
  let args: Record<string, unknown> = {};
  if (tc.function?.arguments) {
    try { args = JSON.parse(tc.function.arguments); }
    catch { args = { _raw: tc.function.arguments }; }
  }
  return { id: tc.id, name: tc.function?.name ?? '', args };
}

interface RawToolCall {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
interface OpenAIChatResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { role: string; content?: string | null; tool_calls?: RawToolCall[] };
  }>;
}

/* -------------------------------------------------------------------------- */
/*  Phase 8: error classification                                              */
/* -------------------------------------------------------------------------- */

interface ClassifiedError {
  kind: 'exhausted' | 'transient' | 'hard';
  /** When the exhausted key can be retried (ms epoch). */
  resetMs?: number;
  /** Raw HTTP status if we could parse it. */
  status?: number;
}

/**
 * Inspect an error thrown from `callProvider` and decide whether the key
 * should be marked exhausted, transient, or hard-failed.
 *
 * Error shape today: `provider ${status}: ${body.slice(0,200)}` (or
 * `provider auth failed (401): check API key` for 401s).
 */
function classifyError(err: unknown): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err);
  // Status prefix.
  const m = /provider\s+(\d{3}):\s*(.*)$/s.exec(msg);
  if (!m) {
    // Network / abort / unknown — treat as transient so we don't lock
    // out a key on something that may not be a quota issue.
    return { kind: 'transient' };
  }
  const status = Number(m[1]);
  const body = (m[2] ?? '').toLowerCase();
  if (status === 429 || /quota exceeded|rate limit exceeded|weekly limit|session limit|insufficient credits|usage limit reached/.test(body)) {
    // The header-based reset was already attempted by the openai-compatible
    // adapter — but its throws don't carry headers. Fall back to body
    // keywords to pick a default reset window via the same logic.
    const defaults: KeyPoolDefaults = {};
    const sig = exhaustionSignals({ status, headers: undefined }, m[2] ?? '', defaults);
    return { kind: 'exhausted', resetMs: sig.resetMs, status };
  }
  if (status >= 500 && status < 600) {
    return { kind: 'transient', status };
  }
  return { kind: 'hard', status };
}

/**
 * Parse the OLLOPA_DIRECT_PROVIDERS env value (JSON). Empty / malformed → [].
 */
export function parseDirectProvidersEnv(raw: string | null | undefined): DirectProviderConfig[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      if (typeof o.name !== 'string' || typeof o.baseUrl !== 'string') return null;
      const kind = o.kind === 'ollama' || o.kind === 'anthropic' || o.kind === 'openai-compatible'
        ? o.kind
        : undefined;
      const keys = Array.isArray(o.keys)
        ? o.keys.filter((k): k is string => typeof k === 'string')
        : undefined;
      let poolDefaults: KeyPoolDefaults | undefined;
      if (o.poolDefaults && typeof o.poolDefaults === 'object') {
        const pd = o.poolDefaults as Record<string, unknown>;
        poolDefaults = {};
        if (typeof pd.weeklyMs === 'number') poolDefaults.weeklyMs = pd.weeklyMs;
        if (typeof pd.sessionMs === 'number') poolDefaults.sessionMs = pd.sessionMs;
        if (typeof pd.cooldownMs === 'number') poolDefaults.cooldownMs = pd.cooldownMs;
        if (Object.keys(poolDefaults).length === 0) poolDefaults = undefined;
      }
      return {
        name: o.name,
        baseUrl: o.baseUrl,
        enabled: o.enabled !== false,
        apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
        model: typeof o.model === 'string' ? o.model : undefined,
        kind,
        keys,
        poolDefaults,
      } as DirectProviderConfig;
    })
    .filter((p): p is DirectProviderConfig => p !== null);
}
