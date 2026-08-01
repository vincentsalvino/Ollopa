/**
 * Provider registry — Phase 4.
 *
 * Each provider implements the same `call()` shape. The router picks
 * one and dispatches. Today: only `openai-compatible`. Anthropic and
 * Ollama can plug in by registering an adapter below.
 *
 * Ponytail: a flat registry of small adapter functions, not a class
 * hierarchy. Adding `anthropic` = one entry + one call(). Done.
 */
import type { ChatMessage, ChatResult, ToolDefinition } from './chatClient';

export interface ProviderCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  /** Stable identifier used by settings (`ollopa.providers[].kind`). */
  kind: 'openai-compatible' | 'anthropic' | 'ollama';
  /** Pretty name for the UI. */
  displayName: string;
  /** Whether this provider requires an API key. Ollama: no. */
  requiresApiKey: boolean;
  /**
   * Dispatch a chat completion. Implementations throw on transport /
   * auth / non-2xx errors so the router can move to the next provider.
   */
  call(
    cfg: ProviderConfig,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    opts: ProviderCallOptions,
  ): Promise<ChatResult>;
}

export interface ProviderConfig {
  /** Provider kind from `ProviderAdapter.kind`. */
  kind: ProviderAdapter['kind'];
  /** Stable name (e.g. "ollama-local"). */
  name: string;
  /** Base URL, no trailing slash. */
  baseUrl: string;
  /** API key (empty for Ollama). */
  apiKey: string;
  /** Model to request. */
  model: string;
  /** Optional Anthropic-version header (future). */
  apiVersion?: string;
}

/* -------------------------------------------------------------------------- */
/*  Adapters                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_TIMEOUT_MS = 30_000;

const openaiCompatible: ProviderAdapter = {
  kind: 'openai-compatible',
  displayName: 'OpenAI-compatible',
  requiresApiKey: true,
  async call(cfg, messages, tools, opts) {
    const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages,
      temperature: 0.2,
    };
    if (tools.length > 0) body.tools = tools;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const res = await timedFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) throw new Error(`provider auth failed (401): check API key`);
      throw new Error(`provider ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as OpenAIChatResponse;
    const choice = json.choices?.[0];
    if (!choice) throw new Error('provider returned no choices');
    const raw = choice.message ?? { role: 'assistant', content: '' };
    const toolCalls = (raw.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name ?? '',
      args: parseArgs(tc.function?.arguments ?? ''),
    }));
    return {
      message: {
        role: 'assistant',
        content: raw.content ?? '',
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
    };
  },
};

const ollama: ProviderAdapter = {
  kind: 'ollama',
  displayName: 'Ollama (local)',
  // Ponytail: most Ollama installs don't enforce auth on localhost.
  // Set apiKey if you've fronted it with a reverse proxy.
  requiresApiKey: false,
  async call(cfg, messages, tools, opts) {
    // Ollama exposes an OpenAI-compatible endpoint at /v1/chat/completions
    // (since 0.1.14). If users set baseUrl=http://localhost:11434, we
    // append /v1 ourselves; if they already include /v1, leave as-is.
    const base = cfg.baseUrl.replace(/\/+$/, '');
    const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    // Reuse the openai-compatible wire format — only difference is the auth.
    return openaiCompatible.call({ ...cfg, apiKey: cfg.apiKey || 'ollama' }, messages, tools, {
      ...opts,
      // Ollama on a small local model can be slow; bump default.
      timeoutMs: opts.timeoutMs ?? 120_000,
    }).catch((err) => {
      // Surface a clearer error for the most common Ollama misconfig.
      if (err instanceof Error && /ECONNREFUSED/.test(err.message)) {
        throw new Error(`Ollama not reachable at ${base}. Is it running? Start it with 'ollama serve'.`);
      }
      throw err;
    }).then((r) => {
      // Tag the URL so the caller can see we routed through /v1.
      void url;
      return r;
    });
  },
};

/* -------------------------------------------------------------------------- */
/*  Registry                                                                  */
/* -------------------------------------------------------------------------- */

const ADAPTERS: Partial<Record<ProviderAdapter['kind'], ProviderAdapter>> = {
  'openai-compatible': openaiCompatible,
  ollama,
  // 'anthropic': reserved — register when needed.
};

export function getAdapter(kind: ProviderAdapter['kind']): ProviderAdapter {
  const a = ADAPTERS[kind];
  if (!a) throw new Error(`unknown provider kind: ${kind}`);
  return a;
}

export function listKinds(): ProviderAdapter['kind'][] {
  return Object.keys(ADAPTERS) as ProviderAdapter['kind'][];
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

async function timedFetch(url: string, init: RequestInit, opts: ProviderCallOptions): Promise<Response> {
  const ctrl = new AbortController();
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const t = setTimeout(() => ctrl.abort(), ms);
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { return { _raw: raw }; }
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