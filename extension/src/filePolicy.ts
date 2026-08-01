/**
 * File access policy for `read_file`. Block secret files; return an error
 * message that the agent can see (so it doesn't keep trying).
 *
 * Phase 5: hardened patterns + symlink defense.
 */
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /\.(pem|key|p12|pfx|asc|gpg|pgp)$/i,
  /\.(bak|backup|swp|tmp).*\.(pem|key|p12|pfx)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.|$)/i, // SSH private keys
  /(^|\/)credentials?(?:\.[a-z0-9]+)?$/i,     // credentials, credentials.json, .credentials
  /(^|\/)[a-z0-9_-]*credentials?\.[a-z0-9]+$/i, // aws-credentials.json, gcloud-credentials.json
  /(^|\/)(?:\.|\w*\.)*secret[s]?\b/i,         // secret, secrets, *.secret.json, .secrets
  /(?:^|\/)\.aws\/(?:credentials|config)$/i,
  /(?:^|\/)\.ssh\/(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|known_hosts)$/i,
  /(?:^|\/)\.npmrc$/i,
  /(?:^|\/)\.netrc$/i,
];

export function isSecretPath(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  for (const re of SECRET_PATTERNS) {
    if (re.test(norm)) return true;
  }
  return false;
}

/**
 * Resolve any symlinks in `absolutePath` and re-check whether the resolved
 * target is secret. Returns true if the file (or any link in its chain)
 * points to a protected path. Symlink traversal through temp workspace
 * into real `.env` files is the attack this guards against.
 */
export async function isSecretSymlink(absolutePath: string, tempRoot: string): Promise<boolean> {
  try {
    const st = await lstat(absolutePath);
    if (!st.isSymbolicLink()) return isSecretPath(absolutePath);
    const target = await realpath(absolutePath);
    // If the link escapes tempRoot, refuse regardless.
    const rootReal = await realpath(tempRoot).catch(() => tempRoot);
    if (!target.startsWith(rootReal)) return true;
    return isSecretPath(target);
  } catch {
    // lstat failed — treat as suspicious.
    return true;
  }
}

/** Convenience: check a workspace-relative path against the temp root. */
export async function isSecretRelative(relPath: string, tempRoot: string): Promise<boolean> {
  if (isSecretPath(relPath)) return true;
  const abs = join(tempRoot, relPath);
  return isSecretSymlink(abs, dirname(abs));
}
