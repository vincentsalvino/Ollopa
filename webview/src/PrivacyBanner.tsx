/**
 * Phase 6 — privacy banner. Shown when localOnly is on, or when redact
 * is on (subtle line). Pure display — the sidecar enforces the policy.
 */
interface PrivacyBannerProps {
  localOnly: boolean;
  redactSecrets: boolean;
}

export function PrivacyBanner({ localOnly, redactSecrets }: PrivacyBannerProps) {
  if (!localOnly && !redactSecrets) return null;
  const cls = localOnly ? 'privacy-banner privacy-banner--strict' : 'privacy-banner';
  const text = localOnly
    ? 'Local-only mode — cloud features are disabled. Only Ollama providers are used.'
    : 'Secrets are redacted before being sent to the LLM.';
  return <div className={cls} role="status">{text}</div>;
}
