/**
 * Plugin marketplace installer (Phase 10).
 *
 * Resolves a user-specified spec into a concrete plugin directory under
 * `~/.ollopa/plugins/<name>@<version>/` and records the install in
 * `~/.ollopa/plugins.lock.json`.
 *
 * Spec syntax:
 *   npm:@scope/name                 — pack the latest matching version
 *   npm:@scope/name@1.2.3           — pack a pinned version
 *   github:owner/repo[@ref]         — fetch the GitHub tarball
 *   git:https://...git[#ref]        — shallow clone with git
 *
 * Each install:
 *   1. Resolves and downloads the artifact.
 *   2. Extracts / clones into a temp dir.
 *   3. Validates `plugin.json`.
 *   4. Computes sha256 of the plugin.json + key payload files for the
 *      lockfile integrity entry.
 *   5. Copies the result to `~/.ollopa/plugins/<name>@<version>/`.
 *   6. Updates `~/.ollopa/plugins.lock.json`.
 *
 * No external SDKs — uses node's child_process for npm/git and `fetch()`
 * for GitHub tarballs, so the install path is testable end-to-end without
 * any extra dep.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadManifest, type LoadedManifest } from './manifest';

export interface LockEntry {
  /** Plugin id, e.g. "@scope/name@1.2.3" or "my-plugin@abc1234" */
  id: string;
  name: string;
  version: string;
  source: string;
  /** sha256 of the extracted plugin.json (and any extra entries concatenated). */
  integrity: string;
  installedAt: string; // ISO timestamp
}

export interface LockFile {
  version: 1;
  entries: Record<string, LockEntry>;
}

export type InstallResult =
  | { ok: true; dir: string; manifest: LoadedManifest }
  | { ok: false; error: string };

export interface InstallSpec {
  raw: string;
  kind: 'npm' | 'github' | 'git';
  spec: string;
  ref?: string;
}

/** Resolve a user spec to one of the install sources. Throws on bad shape. */
export function parseSpec(raw: string): InstallSpec {
  const m = /^(npm|github|git):(.+)$/.exec(raw.trim());
  if (!m) throw new Error(`[marketplace] spec must start with npm:, github:, or git: — got '${raw}'`);
  const kind = m[1] as InstallSpec['kind'];
  const rest = m[2].trim();
  if (kind === 'npm') return { raw, kind, spec: rest };
  if (kind === 'github') {
    const ref = rest.includes('@') ? rest.slice(rest.lastIndexOf('@') + 1) : undefined;
    const ownerRepo = (ref ? rest.slice(0, rest.lastIndexOf('@')) : rest).replace(/^@/, '');
    if (!/^[^/\s]+\/[^/\s]+$/.test(ownerRepo)) {
      throw new Error(`[marketplace] github spec must be owner/repo[@ref], got '${raw}'`);
    }
    return { raw, kind, spec: ownerRepo, ref };
  }
  // git
  const hashIdx = rest.lastIndexOf('#');
  const ref = hashIdx !== -1 ? rest.slice(hashIdx + 1) : undefined;
  const url = hashIdx !== -1 ? rest.slice(0, hashIdx) : rest;
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(url)) {
    throw new Error(`[marketplace] git spec must be a URL, got '${raw}'`);
  }
  return { raw, kind, spec: url, ref };
}

/** Resolve the marketplace root. Default: ~/.ollopa/plugins/. */
export function marketplaceRoot(): string {
  const home = process.env.USERPROFILE || process.env.HOME || tmpdir();
  return join(home, '.ollopa', 'plugins');
}

export function lockFilePath(): string {
  const home = process.env.USERPROFILE || process.env.HOME || tmpdir();
  return join(home, '.ollopa', 'plugins.lock.json');
}

export function loadLockFile(): LockFile {
  const p = lockFilePath();
  if (!existsSync(p)) return { version: 1, entries: {} };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as LockFile;
    if (raw.version !== 1 || typeof raw.entries !== 'object') {
      return { version: 1, entries: {} };
    }
    return raw;
  } catch {
    return { version: 1, entries: {} };
  }
}

export function saveLockFile(lf: LockFile): void {
  const p = lockFilePath();
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(lf, null, 2));
}

/** Spawn npm view to discover latest matching version. Returns null on failure. */
async function resolveNpmVersion(pkg: string, requestedRef?: string): Promise<string | null> {
  if (requestedRef && /^\d+\.\d+\.\d+/.test(requestedRef)) return requestedRef;
  return new Promise<string | null>((resolveP, rejectP) => {
    const args = ['view', pkg, 'version'];
    const proc = spawn('npm', args, { shell: false });
    let out = '';
    proc.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    proc.on('error', () => resolveP(null));
    proc.on('exit', (code) => {
      if (code === 0) resolveP(out.trim());
      else resolveP(null);
    });
    setTimeout(() => { try { proc.kill(); } catch { /* */ } rejectP(new Error('npm view timed out')); }, 15_000);
  });
}

/** Download a GitHub tarball into a temp dir and return its extract path. */
async function fetchGithubTarball(ownerRepo: string, ref: string): Promise<string> {
  const url = `https://api.github.com/repos/${ownerRepo}/tarball/${encodeURIComponent(ref)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GitHub fetch ${ownerRepo}@${ref}: HTTP ${res.status}`);
  const tmp = join(tmpdir(), `ollopa-mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  const tarball = join(tmp, 'tarball.tgz');
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(tarball, buf);
  const extractDir = join(tmp, 'src');
  mkdirSync(extractDir, { recursive: true });
  await new Promise<void>((resolveP, rejectP) => {
    const proc = spawn('tar', ['-xzf', tarball, '-C', extractDir, '--strip-components=1'], { shell: false });
    proc.on('exit', (code) => code === 0 ? resolveP() : rejectP(new Error(`tar failed (${code})`)));
    proc.on('error', rejectP);
  });
  return extractDir;
}

/** Shallow clone a git URL to a temp dir. */
async function cloneGit(url: string, ref: string | undefined): Promise<string> {
  const tmp = join(tmpdir(), `ollopa-mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push(url, tmp);
  await new Promise<void>((resolveP, rejectP) => {
    const proc = spawn('git', args, { shell: false });
    proc.on('exit', (code) => code === 0 ? resolveP() : rejectP(new Error(`git clone failed (${code})`)));
    proc.on('error', rejectP);
  });
  return tmp;
}

/** Pack and extract an npm package to a temp dir. */
async function packNpm(pkg: string): Promise<string> {
  const version = await resolveNpmVersion(pkg);
  if (!version) throw new Error(`[marketplace] npm view failed for ${pkg}`);
  const tmp = join(tmpdir(), `ollopa-mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  await new Promise<void>((resolveP, rejectP) => {
    const proc = spawn('npm', ['pack', `${pkg}@${version}`], { shell: false, cwd: tmp });
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    proc.on('exit', (code) => code === 0 ? resolveP() : rejectP(new Error(`npm pack failed: ${stderr.slice(0, 200)}`)));
    proc.on('error', rejectP);
  });
  const extract = join(tmp, 'src');
  mkdirSync(extract, { recursive: true });
  const tgz = (require('node:fs') as typeof import('node:fs')).readdirSync(tmp).find((n) => n.endsWith('.tgz'));
  if (!tgz) throw new Error('[marketplace] npm pack produced no tgz');
  await new Promise<void>((resolveP, rejectP) => {
    const proc = spawn('tar', ['-xzf', join(tmp, tgz), '-C', extract, '--strip-components=1'], { shell: false });
    proc.on('exit', (code) => code === 0 ? resolveP() : rejectP(new Error(`tar failed (${code})`)));
    proc.on('error', rejectP);
  });
  // Stash the resolved version so the caller can write the lock entry.
  (extract as unknown as Record<string, string | null>).__resolvedVersion = version;
  return extract;
}

/** Hash the plugin.json + every .md file under commands/agents/skills, plus .mcp.json. */
export function integrity(dir: string): string {
  const h = createHash('sha256');
  const manifestPath = join(dir, 'plugin.json');
  if (existsSync(manifestPath)) h.update(readFileSync(manifestPath));
  for (const sub of ['commands', 'agents', 'skills', 'hooks']) {
    const subDir = join(dir, sub);
    if (!existsSync(subDir)) continue;
    hashDir(subDir, h);
  }
  for (const f of ['.mcp.json', 'README.md']) {
    const p = join(dir, f);
    if (existsSync(p)) h.update(readFileSync(p));
  }
  return `sha256:${h.digest('hex')}`;
}

function hashDir(dir: string, h: import('node:crypto').Hash): void {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) hashDir(full, h);
    else if (s.isFile()) h.update(readFileSync(full));
  }
}

/** Main install entry point. */
export async function installPlugin(rawSpec: string): Promise<InstallResult> {
  let spec: InstallSpec;
  try { spec = parseSpec(rawSpec); }
  catch (err) { return { ok: false, error: (err as Error).message }; }

  let extractDir: string;
  try {
    if (spec.kind === 'npm') {
      extractDir = await packNpm(spec.spec);
    } else if (spec.kind === 'github') {
      extractDir = await fetchGithubTarball(spec.spec, spec.ref ?? 'HEAD');
    } else {
      extractDir = await cloneGit(spec.spec, spec.ref);
    }
  } catch (err) {
    return { ok: false, error: `download failed: ${(err as Error).message}` };
  }

  // Validate
  let manifest: LoadedManifest;
  try { manifest = loadManifest(extractDir); }
  catch (err) {
    rmSync(extractDir, { recursive: true, force: true });
    return { ok: false, error: (err as Error).message };
  }

  // Copy to marketplace root, idempotent
  const root = marketplaceRoot();
  mkdirSync(root, { recursive: true });
  const target = join(root, `${manifest.name}@${manifest.version}`);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  copyDir(extractDir, target);

  // Update lock
  const lock = loadLockFile();
  lock.entries[manifest.name] = {
    id: `${manifest.name}@${manifest.version}`,
    name: manifest.name,
    version: manifest.version,
    source: rawSpec,
    integrity: integrity(target),
    installedAt: new Date().toISOString(),
  };
  saveLockFile(lock);

  // Clean up temp
  rmSync(extractDir, { recursive: true, force: true });

  return { ok: true, dir: target, manifest };
}

/** Uninstall: remove dir + lock entry. */
export function uninstallPlugin(name: string): { ok: boolean; error?: string } {
  const lock = loadLockFile();
  const entry = lock.entries[name];
  if (!entry) return { ok: false, error: `plugin '${name}' not in lockfile` };
  const dir = join(marketplaceRoot(), entry.id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  delete lock.entries[name];
  saveLockFile(lock);
  return { ok: true };
}

/** List installed plugins (from lockfile). */
export function listInstalledPlugins(): LockEntry[] {
  return Object.values(loadLockFile().entries);
}

function copyDir(src: string, dst: string): void {
  const { mkdirSync: mk, readdirSync, statSync, copyFileSync } = require('node:fs') as typeof import('node:fs');
  mk(dst, { recursive: true });
  for (const e of readdirSync(src)) {
    const sFull = join(src, e);
    const dFull = join(dst, e);
    const s = statSync(sFull);
    if (s.isDirectory()) copyDir(sFull, dFull);
    else copyFileSync(sFull, dFull);
  }
}
