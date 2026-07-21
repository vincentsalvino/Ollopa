/**
 * Command whitelist for `execute_safe_bash`. The extension host runs the
 * command in the temp workspace; if it doesn't match, we return an error
 * to the agent (it sees the rejection and can adjust).
 *
 * Whitelist is intentionally small for Phase 3 — we can widen it as needed.
 */
export interface CommandWhitelist {
  allowed: Array<{ bin: string; subcommands?: string[] }>;
  bannedPatterns: RegExp[];
  maxTimeoutMs: number;
  maxOutputBytes: number;
}

const WHITELIST: CommandWhitelist = {
  allowed: [
    { bin: 'npm', subcommands: ['test', 'run', 'list', 'ls'] },
    { bin: 'npx', subcommands: ['eslint', 'tsc'] },
    { bin: 'git', subcommands: ['status', 'diff', 'log', 'show'] },
    { bin: 'node', subcommands: ['--version'] },
  ],
  bannedPatterns: [
    /\brm\s+-rf?\s+\//i,        // rm -rf /
    /\bsudo\b/i,
    /\bcurl\b/i,
    /\bwget\b/i,
    /\bchmod\b/i,
    /\/etc\//i,
    /\beval\b/i,
  ],
  maxTimeoutMs: 30_000,
  maxOutputBytes: 64 * 1024, // 64 KB
};

export function getWhitelist(): CommandWhitelist {
  return WHITELIST;
}

export type WhitelistVerdict =
  | { ok: true; bin: string; args: string[] }
  | { ok: false; reason: string };

/**
 * Parse a command line into [bin, ...args] and verify against the whitelist.
 * Naive tokenizer — handles double-quoted strings but not escapes. Good
 * enough for the kind of commands we want to allow.
 */
export function verifyCommand(command: string): WhitelistVerdict {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { ok: false, reason: 'empty command' };
  }
  for (const pat of WHITELIST.bannedPatterns) {
    if (pat.test(command)) return { ok: false, reason: `banned pattern: ${pat}` };
  }
  const tokens = tokenize(command);
  if (tokens.length === 0) return { ok: false, reason: 'no tokens' };
  const [bin, ...rest] = tokens;
  const allowed = WHITELIST.allowed.find((a) => a.bin === bin);
  if (!allowed) return { ok: false, reason: `bin not allowed: ${bin}` };
  if (allowed.subcommands && rest.length > 0) {
    if (!allowed.subcommands.includes(rest[0])) {
      return { ok: false, reason: `subcommand not allowed: ${bin} ${rest[0]}` };
    }
  }
  return { ok: true, bin, args: rest };
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (!inQ && /\s/.test(c)) {
      if (cur) { out.push(cur); cur = ''; }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
