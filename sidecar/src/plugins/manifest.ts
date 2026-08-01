/**
 * Plugin manifest — Claude Code-compatible plugin format (Phase 10).
 *
 * Layout (Claude Code convention, with Ollopa extensions):
 *
 *   <pluginDir>/
 *     plugin.json          # manifest (this file)
 *     commands/<name>.md   # slash command: frontmatter + prompt
 *     agents/<name>.md     # agent: frontmatter + system prompt + tools
 *     skills/<name>/SKILL.md
 *     hooks/hooks.json
 *     .mcp.json
 *     src/index.js         # optional JS entry (back-compat with Phase 3.6 flat .js)
 *
 * plugin.json schema:
 *   {
 *     "name": "my-plugin",          // required, kebab-case
 *     "version": "0.1.0",           // required, semver
 *     "description": "...",         // required
 *     "author": "Jane <jane@x>",
 *     "license": "MIT",
 *     "ollopa": { "min": "0.1.0", "max": "0.2.0" },  // optional version range
 *     "entry": "src/index.js",       // optional JS entry
 *     "provides": {                  // declared capabilities
 *       "commands": ["commands/"],
 *       "agents":   ["agents/"],
 *       "skills":   ["skills/"],
 *       "hooks":    ["hooks/"],
 *       "mcp":      [".mcp.json"]
 *     }
 *   }
 *
 * Minimal validation: hand-rolled, no extra dependency. Throws on missing
 * required fields, bad name, bad semver, or unresolvable paths.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  ollopa?: { min?: string; max?: string };
  entry?: string;
  provides?: {
    commands?: string[];
    agents?: string[];
    skills?: string[];
    hooks?: string[];
    mcp?: string[];
  };
}

export interface LoadedManifest extends PluginManifest {
  /** Absolute path to the plugin root. */
  dir: string;
  /** Absolute paths resolved against the root. */
  resolved: {
    entry: string | null;
    commandFiles: string[];
    agentFiles: string[];
    skillDirs: string[];
    hookFiles: string[];
    mcpFiles: string[];
  };
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asString(v: unknown, field: string, where: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`[manifest] ${where}: '${field}' must be a non-empty string`);
  }
  return v;
}

function asSemver(v: unknown, field: string, where: string): string {
  const s = asString(v, field, where);
  if (!SEMVER_RE.test(s)) throw new Error(`[manifest] ${where}: '${field}' must be semver, got '${s}'`);
  return s;
}

function asStringArray(v: unknown, field: string, where: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.length > 0)) {
    throw new Error(`[manifest] ${where}: '${field}' must be string[]`);
  }
  return v;
}

/** Parse a JSON manifest from disk and validate. Returns a LoadedManifest. */
export function loadManifest(pluginDir: string): LoadedManifest {
  const dir = resolve(pluginDir);
  const where = `plugin at ${dir}`;
  const manifestPath = join(dir, 'plugin.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`[manifest] ${where}: plugin.json not found`);
  }

  let raw: unknown;
  try { raw = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch (err) { throw new Error(`[manifest] ${where}: invalid JSON: ${(err as Error).message}`); }
  if (!isObject(raw)) throw new Error(`[manifest] ${where}: plugin.json must be an object`);

  const name = asString(raw.name, 'name', where);
  if (!NAME_RE.test(name)) throw new Error(`[manifest] ${where}: 'name' must match ${NAME_RE}, got '${name}'`);
  const version = asSemver(raw.version, 'version', where);
  const description = asString(raw.description, 'description', where);

  const author = typeof raw.author === 'string' ? raw.author : undefined;
  const license = typeof raw.license === 'string' ? raw.license : undefined;

  let ollopa: PluginManifest['ollopa'];
  if (raw.ollopa !== undefined) {
    if (!isObject(raw.ollopa)) throw new Error(`[manifest] ${where}: 'ollopa' must be an object`);
    const o = raw.ollopa as Record<string, unknown>;
    const min = typeof o.min === 'string' ? asSemver(o.min, 'min', `${where}.ollopa`) : undefined;
    const max = typeof o.max === 'string' ? asSemver(o.max, 'max', `${where}.ollopa`) : undefined;
    ollopa = { min, max };
  }

  let entry: string | undefined;
  if (raw.entry !== undefined) {
    entry = asString(raw.entry, 'entry', where);
    if (!isAbsolute(entry)) entry = join(dir, entry);
    if (!existsSync(entry)) throw new Error(`[manifest] ${where}: entry file missing: ${entry}`);
  }

  let provides: PluginManifest['provides'];
  if (raw.provides !== undefined) {
    if (!isObject(raw.provides)) throw new Error(`[manifest] ${where}: 'provides' must be an object`);
    const p = raw.provides as Record<string, unknown>;
    provides = {
      commands: asStringArray(p.commands, 'commands', `${where}.provides`),
      agents: asStringArray(p.agents, 'agents', `${where}.provides`),
      skills: asStringArray(p.skills, 'skills', `${where}.provides`),
      hooks: asStringArray(p.hooks, 'hooks', `${where}.provides`),
      mcp: asStringArray(p.mcp, 'mcp', `${where}.provides`),
    };
  }

  return {
    name, version, description, author, license, ollopa, entry, provides,
    dir,
    resolved: {
      entry: entry ?? null,
      commandFiles: resolveGlobs(dir, provides?.commands, ['commands']),
      agentFiles: resolveGlobs(dir, provides?.agents, ['agents']),
      skillDirs: resolveGlobs(dir, provides?.skills, ['skills']),
      hookFiles: resolveGlobs(dir, provides?.hooks, ['hooks']),
      mcpFiles: resolveGlobs(dir, provides?.mcp, []),
    },
  };
}

function resolveGlobs(dir: string, declared: string[] | undefined, defaultDirs: string[]): string[] {
  const out: string[] = [];
  const roots = declared ?? defaultDirs.map((d) => `${d}/`);
  for (const r of roots) {
    const abs = isAbsolute(r) ? r : join(dir, r);
    if (!existsSync(abs)) continue;
    let stat;
    try { stat = statSync(abs); } catch { continue; }
    if (stat.isDirectory()) {
      // Glob **/*.md for command/agent dirs, **/SKILL.md for skills, **/*.json for hooks/mcp
      collectAll(abs, abs, out);
    } else if (stat.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function collectAll(root: string, cur: string, out: string[]): void {
  let entries: string[];
  try {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    entries = readdirSync(cur);
  } catch { return; }
  for (const e of entries) {
    const full = join(cur, e);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      // Skip the plugin entry dir we already resolved
      if (full !== root) collectAll(root, full, out);
    } else if (stat.isFile()) {
      out.push(full);
    }
  }
}

/** Check whether a plugin's `ollopa.*` range is compatible with the running version. */
export function isCompatible(manifest: PluginManifest, ollopaVersion: string): boolean {
  if (!manifest.ollopa) return true;
  if (manifest.ollopa.min && compareSemver(ollopaVersion, manifest.ollopa.min) < 0) return false;
  if (manifest.ollopa.max && compareSemver(ollopaVersion, manifest.ollopa.max) > 0) return false;
  return true;
}

/** Tiny semver compare: -1, 0, 1. Pre-release tokens sort before release. */
export function compareSemver(a: string, b: string): number {
  const [am, ap] = a.split('-', 2);
  const [bm, bp] = b.split('-', 2);
  const an = am.split('.').map(Number);
  const bn = bm.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (an[i] !== bn[i]) return an[i] < bn[i] ? -1 : 1;
  }
  if (ap === bp) return 0;
  if (ap === undefined) return 1; // release > pre-release
  if (bp === undefined) return -1;
  return ap < bp ? -1 : 1;
}

/** Stable identifier for a plugin install: <name>@<version>. */
export function pluginId(m: PluginManifest): string {
  return `${m.name}@${m.version}`;
}

/** Convert plugin path to a file:// URL safe for ESM imports. */
export function toFileUrl(p: string): string {
  return pathToFileURL(p).href;
}
