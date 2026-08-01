/**
 * Secret names stored in VS Code's SecretStorage. Kept here so the
 * `ollopa.configure` command and the sidecar launcher use the same keys.
 */
import * as vscode from 'vscode';

export const SECRET_KEYS = {
  supabaseUrl: 'ollopa.supabaseUrl',
  supabaseServiceKey: 'ollopa.supabaseServiceKey',
  openRouterKey: 'ollopa.openRouterKey',
} as const;

export interface SidecarCredentials {
  supabaseUrl: string;
  supabaseServiceKey: string;
  openRouterKey: string;
}

/**
 * A direct provider as declared in `ollopa.directProviders` settings, plus
 * the resolved API key pulled from SecretStorage under
 * `ollopa.providerKey.<keyAlias>` (or, for legacy single-key setups,
 * the global `ollopa.openRouterKey`).
 */
export interface ResolvedDirectProvider {
  name: string;
  baseUrl: string;
  enabled: boolean;
  apiKey: string;
  model?: string;
  /**
   * Phase 8: resolved key pool. Each entry was looked up under
   * `ollopa.providerKey.<alias>`; empty strings are kept so the sidecar
   * can distinguish "not yet added" from "explicitly removed".
   */
  keys?: string[];
  /** Phase 8: per-provider reset windows. */
  poolDefaults?: { weeklyMs?: number; sessionMs?: number; cooldownMs?: number };
  /** Phase 8: which key was used last (mirrored from sidecar). */
  currentKeyIndex?: number;
}

/** Raw provider config as stored in settings.json. */
export interface DirectProviderSetting {
  name: string;
  baseUrl: string;
  enabled?: boolean;
  keyAlias: string;
  model?: string;
  /**
   * Phase 8: optional key-pool aliases. When set, `keyAlias` is ignored
   * and each alias is resolved from SecretStorage independently.
   */
  keys?: string[];
  /** Phase 8: per-provider reset windows. */
  poolDefaults?: { weeklyMs?: number; sessionMs?: number; cooldownMs?: number };
  kind?: 'openai-compatible' | 'anthropic' | 'ollama';
}

/** Connection config that gets serialised into env vars for the sidecar. */
export interface ProviderConfig {
  omnirouteUrl: string | null;
  forceDirect: boolean;
  directProviders: ResolvedDirectProvider[];
  /** Phase 8: OLLOPA_KEYPOOL_DEFAULTS — passed through verbatim. */
  keyPoolDefaults?: { weeklyMs?: number; sessionMs?: number; cooldownMs?: number };
}

export async function readSidecarCredentials(
  secrets: vscode.SecretStorage,
): Promise<SidecarCredentials | null> {
  const [url, serviceKey, openRouter] = await Promise.all([
    secrets.get(SECRET_KEYS.supabaseUrl),
    secrets.get(SECRET_KEYS.supabaseServiceKey),
    secrets.get(SECRET_KEYS.openRouterKey),
  ]);
  if (!url || !serviceKey) return null;
  return { supabaseUrl: url, supabaseServiceKey: serviceKey, openRouterKey: openRouter ?? '' };
}

export async function readProviderConfig(
  secrets: vscode.SecretStorage,
  config: vscode.WorkspaceConfiguration,
): Promise<ProviderConfig> {
  const omnirouteUrl = (config.get<string>('omnirouteUrl') ?? '').trim() || null;
  const forceDirect = config.get<boolean>('forceDirect') ?? false;
  const raw = config.get<DirectProviderSetting[]>('directProviders') ?? [];

  // Resolve keys for each declared provider. Fall back to the global
  // openRouter key for any provider with the well-known alias "openrouter".
  const resolved: ResolvedDirectProvider[] = [];
  for (const p of raw) {
    if (!p || typeof p.name !== 'string' || typeof p.baseUrl !== 'string') continue;
    let apiKey = '';
    let keys: string[] | undefined;
    if (p.keys && p.keys.length > 0) {
      // Phase 8: resolve each alias independently. Empty aliases stay
      // empty so the sidecar's pool can skip them rather than treating
      // the slot as configured.
      keys = await Promise.all(
        p.keys.map(async (alias) => {
          if (!alias) return '';
          if (alias === '__openrouter__') {
            return (await secrets.get(SECRET_KEYS.openRouterKey)) ?? '';
          }
          return (await secrets.get(`ollopa.providerKey.${alias}`)) ?? '';
        }),
      );
      // Use the first non-empty key as a back-compat `apiKey` for any
      // caller that ignores the pool. The router always prefers the pool.
      apiKey = keys.find((k) => !!k) ?? '';
    } else if (p.keyAlias === '__openrouter__') {
      apiKey = (await secrets.get(SECRET_KEYS.openRouterKey)) ?? '';
    } else if (p.keyAlias) {
      apiKey = (await secrets.get(`ollopa.providerKey.${p.keyAlias}`)) ?? '';
    }
    resolved.push({
      name: p.name,
      baseUrl: p.baseUrl,
      enabled: p.enabled !== false,
      apiKey,
      model: p.model,
      keys,
      poolDefaults: p.poolDefaults,
    });
  }

  // Phase 8: surface the global pool defaults override if set. Today we
  // just pass through settings; future: per-provider defaults trump this.
  const keyPoolDefaults = config.get<{ weeklyMs?: number; sessionMs?: number; cooldownMs?: number }>('keyPool.defaults');

  return { omnirouteUrl, forceDirect, directProviders: resolved, keyPoolDefaults };
}

/** Stable JSON form for the OLLOPA_DIRECT_PROVIDERS env var. */
export function serialiseDirectProviders(providers: ResolvedDirectProvider[]): string {
  // Only the fields the sidecar needs. apiKey + keys included so the
  // sidecar can dispatch without needing SecretStorage on its side.
  return JSON.stringify(
    providers.map((p) => ({
      name: p.name,
      baseUrl: p.baseUrl,
      enabled: p.enabled,
      apiKey: p.apiKey,
      model: p.model,
      kind: (p as any).kind,
      keys: p.keys,
      poolDefaults: p.poolDefaults,
    })),
  );
}
