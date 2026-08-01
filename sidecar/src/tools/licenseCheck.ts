/**
 * Phase 5.2 — license check.
 *
 * Reads `package.json` dependencies and looks up each one's declared
 * license. Uses `npm view <pkg> license` over stdout. Forbidden licenses
 * configurable via `OLLOPA_FORBIDDEN_LICENSES` (comma-sep, glob patterns).
 *
 * Why not use the lockfile? Because the user installs fresh deps and
 * wants to know their licenses before merging. `package.json` is the
 * declared intent.
 *
 * Ponytail: spawn `npm view` per package. Could cache to `web_cache` later.
 */
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface LicenseCheckResult {
  package: string;
  license: string | null;
  /** True if license matches any pattern in the forbidden list. */
  forbidden: boolean;
  error?: string;
}

const DEFAULT_FORBIDDEN = ['AGPL-*', 'SSPL*', 'BUSL-*', 'Commons-Clause'];

export function getForbiddenLicenses(): string[] {
  const fromEnv = process.env.OLLOPA_FORBIDDEN_LICENSES;
  if (!fromEnv || fromEnv.trim().length === 0) return [...DEFAULT_FORBIDDEN];
  return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
}

export function isLicenseForbidden(license: string | null, patterns: string[]): boolean {
  if (!license) return false;
  const lower = license.toLowerCase();
  for (const pat of patterns) {
    if (matchGlob(lower, pat.toLowerCase())) return true;
  }
  return false;
}

function matchGlob(s: string, pat: string): boolean {
  // Convert glob to regex: only `*` supported (rest is literal).
  const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(s);
}

/**
 * Read package.json from a workspace root and resolve the license of
 * each declared dependency. Returns one result per package.
 */
export async function checkWorkspaceLicenses(workspaceRoot: string): Promise<LicenseCheckResult[]> {
  const pkgJsonPath = join(workspaceRoot, 'package.json');
  let raw: string;
  try { raw = await readFile(pkgJsonPath, 'utf8'); }
  catch (err) {
    return [{ package: '<package.json>', license: null, forbidden: false, error: (err as Error).message }];
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    return [{ package: '<package.json>', license: null, forbidden: false, error: 'invalid JSON' }];
  }
  const deps = extractDeps(parsed);
  if (deps.length === 0) return [];
  const forbidden = getForbiddenLicenses();
  const out: LicenseCheckResult[] = [];
  // Sequential — `npm view` is one process at a time per package.
  // Ponytail: cheap and avoids spawning N processes in parallel (Windows
  // is unhappy with hundreds of concurrent `npm` invocations).
  for (const dep of deps) {
    const r = await checkOne(dep, forbidden);
    out.push(r);
  }
  return out;
}

async function checkOne(pkg: string, forbidden: string[]): Promise<LicenseCheckResult> {
  try {
    const license = await npmViewLicense(pkg);
    return { package: pkg, license, forbidden: isLicenseForbidden(license, forbidden) };
  } catch (err) {
    return { package: pkg, license: null, forbidden: false, error: (err as Error).message };
  }
}

function npmViewLicense(pkg: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['view', pkg, 'license'], { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => { try { child.kill(); } catch { /* noop */ } reject(new Error('npm view timed out')); }, 10_000);
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    child.on('error', (err) => { clearTimeout(t); reject(err); });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) {
        // npm view exits non-zero if the package doesn't exist.
        const msg = stderr.trim().split('\n')[0] || `exit ${code}`;
        return reject(new Error(msg));
      }
      const out = stdout.trim();
      if (!out || out === 'undefined') return resolve(null);
      resolve(out);
    });
  });
}

function extractDeps(pkg: unknown): string[] {
  if (!pkg || typeof pkg !== 'object') return [];
  const o = pkg as Record<string, unknown>;
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const out = new Set<string>();
  for (const s of sections) {
    const section = o[s];
    if (section && typeof section === 'object') {
      for (const k of Object.keys(section as Record<string, unknown>)) out.add(k);
    }
  }
  return Array.from(out);
}

/**
 * Format the results into a plain-text summary suitable for an LLM tool
 * output. One line per package, with a banner listing forbidden matches.
 */
export function formatLicenseResults(results: LicenseCheckResult[]): string {
  if (results.length === 0) return 'no dependencies to check (or no package.json found)';
  const lines: string[] = [];
  const forbidden = results.filter((r) => r.forbidden);
  lines.push(`Checked ${results.length} package(s).`);
  if (forbidden.length > 0) {
    lines.push(`\n!!! ${forbidden.length} FORBIDDEN LICENSE(S) !!!`);
    for (const r of forbidden) {
      lines.push(`  - ${r.package}: ${r.license}`);
    }
    lines.push('Replace these before merging or add to allowlist (OLLOPA_FORBIDDEN_LICENSES).');
  } else {
    lines.push('No forbidden licenses found.');
  }
  // Append the full table for the LLM to see.
  lines.push('\nFull list:');
  for (const r of results) {
    const flag = r.forbidden ? ' [FORBIDDEN]' : r.error ? ' [ERROR]' : '';
    lines.push(`  ${r.package}: ${r.license ?? r.error ?? 'unknown'}${flag}`);
  }
  return lines.join('\n');
}