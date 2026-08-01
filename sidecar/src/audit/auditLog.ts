/**
 * Phase 6 — privacy audit log.
 *
 * Append-only JSON-lines log at `~/.ollopa/audit.log`. Each line is one
 * event: a blocked network call, an LLM payload sent (with redaction),
 * or a refused tool invocation.
 *
 * Why a flat file: writes are append-only (no contention), humans can
 * `grep`/`tail` it, no schema migration to worry about.
 *
 * Ponytail: stdlib only. No DB, no rotation. Rotation can be added later
 * via logrotate-style daily file split if size ever bites.
 */
import { appendFile, mkdir, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type AuditKind =
  | 'network_blocked'      // localOnly refused an outbound tool
  | 'cloud_provider_blocked' // localOnly refused a non-local provider
  | 'payload_redacted'     // secrets redacted from an outbound payload
  | 'tool_refused'        // any other refusal
  | 'keypool_exhausted'   // Phase 8: a key was marked exhausted
  | 'keypool_recovered';  // Phase 8: a cooldown lifted and the key is usable again

export interface AuditEntry {
  ts: number;
  kind: AuditKind;
  /** Tool or provider name. */
  source: string;
  /** Optional context (e.g. file path, query). Free-form string. */
  detail?: string;
  /** Number of bytes redacted, or 0 if N/A. */
  redactedBytes?: number;
  /** Optional preview of what would have been sent (truncated). */
  preview?: string;
}

let auditPath: string | null = null;
function resolveAuditPath(): string {
  if (auditPath) return auditPath;
  // Allow override for tests.
  const override = process.env.OLLOPA_AUDIT_LOG;
  auditPath = override && override.length > 0 ? override : join(homedir(), '.ollopa', 'audit.log');
  return auditPath;
}

async function ensureDir(filePath: string): Promise<void> {
  const dir = filePath.replace(/[\\/][^\\/]+$/, '');
  try { await mkdir(dir, { recursive: true }); } catch { /* ignore */ }
}

/**
 * Append one entry. Best-effort — never throws into the caller.
 */
export async function appendAudit(entry: Omit<AuditEntry, 'ts'>): Promise<void> {
  const path = resolveAuditPath();
  try {
    await ensureDir(path);
    const line = JSON.stringify({ ts: Date.now(), ...entry }) + '\n';
    await appendFile(path, line, 'utf8');
    // ponytail: naive 10MB rotation, keep last 10MB. add when log size bites.
    try {
      const s = await stat(path);
      if (s.size > 10 * 1024 * 1024) {
        await rename(path, path + '.1');
      }
    } catch { /* ignore stat failures */ }
  } catch { /* never throw — audit must not break the main flow */ }
}

/**
 * Secret regex patterns used by `redactSecrets`. Kept in sync with the
 * security_scan node in taskModeGraph.ts.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'aws-access-key',    re: /AKIA[0-9A-Z]{16}/g },
  { name: 'github-pat',        re: /ghp_[A-Za-z0-9]{36}/g },
  { name: 'slack-token',       re: /xox[abp]-[0-9A-Za-z-]{10,}/g },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'jwt',               re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
];

export interface RedactionResult {
  text: string;
  redactedCount: number;
  redactedBytes: number;
}

/**
 * Replace secret-shaped substrings with `[REDACTED:<kind>]`. Counts
 * replacements and returns how many bytes were masked.
 */
export function redactSecrets(text: string): RedactionResult {
  let out = text;
  let count = 0;
  let bytes = 0;
  for (const { name, re } of SECRET_PATTERNS) {
    out = out.replace(re, (match) => {
      count++;
      bytes += match.length;
      return `[REDACTED:${name}]`;
    });
  }
  return { text: out, redactedCount: count, redactedBytes: bytes };
}