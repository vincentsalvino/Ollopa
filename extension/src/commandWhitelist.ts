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
    { bin: 'npx', subcommands: ['eslint', 'tsc', 'semgrep', 'jest', 'vitest'] },
    { bin: 'git', subcommands: ['status', 'diff', 'log', 'show'] },
    { bin: 'node', subcommands: ['--version'] },
  ],
  bannedPatterns: [
    /\brm\s+-rf?\s+\//i,                       // rm -rf /
    /\bsudo\b/i,
    /\b(curl|wget|nc|netcat)\b/i,
    /\bchmod\b\s+(-R\s+)?[0-7]*[7][0-7]/i,     // chmod 777 / chmod -R 777
    /\bchmod\b\s+(-R\s+)?\+[rwx]+\b/i,         // chmod +x / chmod -R +x
    /\/etc\//i,
    /\beval\b/i,
    /:.*\(\)\s*\{.*\|.*&.*\}/i,                // fork bomb :(){:|:&};:
    /\|\s*(sh|bash|zsh|fish|node|python)\b/i,  // pipe-to-shell
    /\b(?:mkfs|dd|shutdown|reboot|halt|poweroff)\b/i,
    />\s*\/dev\/(sd|hd|nvme|disk)/i,           // overwrite raw block devices
    /`[^`]*`/i,                                // backtick command substitution
    /\$\([^)]*\)/i,                            // $() command substitution
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
  // Strip all quote characters before pattern matching so token-splitting
  // bypasses (c""url, cur' 'l, "r"m) cannot evade bans.
  const stripped = command.replace(/["'`]/g, '');
  for (const pat of WHITELIST.bannedPatterns) {
    if (pat.test(stripped)) return { ok: false, reason: `banned pattern: ${pat}` };
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
