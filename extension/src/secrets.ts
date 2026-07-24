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
}

/** Raw provider config as stored in settings.json. */
export interface DirectProviderSetting {
  name: string;
  baseUrl: string;
  enabled?: boolean;
  keyAlias: string;
  model?: string;
}

/** Connection config that gets serialised into env vars for the sidecar. */
export interface ProviderConfig {
  omnirouteUrl: string | null;
  forceDirect: boolean;
  directProviders: ResolvedDirectProvider[];
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
    if (p.keyAlias === '__openrouter__') {
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
    });
  }

  return { omnirouteUrl, forceDirect, directProviders: resolved };
}

/** Stable JSON form for the OLLOPA_DIRECT_PROVIDERS env var. */
export function serialiseDirectProviders(providers: ResolvedDirectProvider[]): string {
  // Only the fields the sidecar needs. apiKey included so the sidecar can
  // dispatch without needing the SecretStorage on its side.
  return JSON.stringify(
    providers.map((p) => ({
      name: p.name,
      baseUrl: p.baseUrl,
      enabled: p.enabled,
      apiKey: p.apiKey,
      model: p.model,
    })),
  );
}
