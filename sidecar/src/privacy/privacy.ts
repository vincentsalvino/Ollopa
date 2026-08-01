/**
 * Phase 6 — privacy configuration.
 *
 * Reads OLLOPA_LOCAL_ONLY, OLLOPA_REDACT_SECRETS at startup. These are
 * set by the extension host from VS Code settings.
 *
 * Single source of truth so every tool/provider guard checks the same
 * flag — no drift between call sites.
 */
export interface PrivacyConfig {
  /** Refuse outbound HTTP and non-local LLM providers. */
  localOnly: boolean;
  /** Mask secrets-shaped strings before they go to the LLM. */
  redactSecrets: boolean;
}

let cached: PrivacyConfig | null = null;

export function loadPrivacyConfig(): PrivacyConfig {
  if (cached) return cached;
  cached = {
    localOnly: parseBool(process.env.OLLOPA_LOCAL_ONLY),
    redactSecrets: parseBool(process.env.OLLOPA_REDACT_SECRETS, true),
  };
  return cached;
}

/** Test helper — wipe the cached config so env changes take effect. */
export function resetPrivacyConfigForTests(): void {
  cached = null;
}

function parseBool(raw: string | undefined, defaultValue = false): boolean {
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return defaultValue;
}