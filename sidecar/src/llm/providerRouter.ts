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
}

export type ResolvedBackend =
  | { kind: 'omniroute'; model: string }
  | { kind: 'direct'; provider: ProviderName; model: string };

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

  if (!cfg.forceDirect && cfg.omnirouteUrl) {
    const url = cfg.omnirouteUrl.replace(/\/+$/, '');
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

  // Direct fallback. Try each enabled provider with a key, in declared order.
  let lastErr: unknown = null;
  for (const p of cfg.directProviders) {
    if (!p.enabled || !p.apiKey) continue;
    const model = p.model ?? cfg.defaultModel;
    try {
      const result = await callOpenAICompatible(p.baseUrl, p.apiKey, model, messages, tools, {
        timeoutMs,
        signal: opts.signal,
      });
      return { ...result, backend: { kind: 'direct', provider: p.name, model } };
    } catch (err) {
      lastErr = err;
      // Try the next provider.
    }
  }
  throw new Error(
    `No LLM backend available. ${lastErr ? 'Last error: ' + (lastErr as Error).message : 'Configure OmniRoute or add a direct provider key.'}`,
  );
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
      return {
        name: o.name,
        baseUrl: o.baseUrl,
        enabled: o.enabled !== false,
        apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
        model: typeof o.model === 'string' ? o.model : undefined,
      } as DirectProviderConfig;
    })
    .filter((p): p is DirectProviderConfig => p !== null);
}
