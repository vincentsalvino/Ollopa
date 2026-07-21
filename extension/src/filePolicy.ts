/**
 * File access policy for `read_file`. Block secret files; return an error
 * message that the agent can see (so it doesn't keep trying).
 */
const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)credentials?\./i,
  /(^|\/)?\*?secret\*/i,
];

export function isSecretPath(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  for (const re of SECRET_PATTERNS) {
    if (re.test(norm)) return true;
  }
  return false;
}
