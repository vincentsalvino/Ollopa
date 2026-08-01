/**
 * Phase 7 — skill export/import.
 *
 * A `.skill.json` is a self-contained bundle:
 *   {
 *     "format": "ollopa-skill",
 *     "version": 1,
 *     "skill": {
 *       "name": "summarise",
 *       "description": "...",
 *       "autoTrigger": true,
 *       "prompt": "...full body...",
 *       "origin": "my-plugin:skills/summarise/SKILL.md"
 *     }
 *   }
 *
 * Export takes a skill name (from the in-memory registry) and returns
 * the JSON string. Import writes a fresh plugin dir under
 * `~/.ollopa/plugins/<name>@<version>/skills/<name>/SKILL.md` plus a
 * minimal plugin.json so the loader picks it up.
 *
 * No new dependencies; stdlib JSON + fs only.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSkill, type LoadedSkill } from './skills';
import { marketplaceRoot } from './marketplace';

export interface SkillBundle {
  format: 'ollopa-skill';
  version: 1;
  skill: LoadedSkill;
}

export interface ExportResult {
  ok: true;
  bundle: SkillBundle;
  json: string;
}
export interface ExportError {
  ok: false;
  error: string;
}

/** Pack a loaded skill into a JSON bundle. */
export function exportSkill(name: string): ExportResult | ExportError {
  const s = getSkill(name);
  if (!s) return { ok: false, error: `skill '${name}' not found` };
  const bundle: SkillBundle = { format: 'ollopa-skill', version: 1, skill: s };
  return { ok: true, bundle, json: JSON.stringify(bundle, null, 2) };
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  /** Absolute path of the SKILL.md that was written, if successful. */
  path?: string;
}

/** Validate + unpack a skill bundle JSON string. */
export function parseBundle(raw: string): SkillBundle | { error: string } {
  let obj: unknown;
  try { obj = JSON.parse(raw); }
  catch (err) { return { error: `invalid JSON: ${(err as Error).message}` }; }
  if (!obj || typeof obj !== 'object') return { error: 'bundle must be an object' };
  const o = obj as Record<string, unknown>;
  if (o.format !== 'ollopa-skill') return { error: `unsupported format: ${o.format}` };
  if (o.version !== 1) return { error: `unsupported bundle version: ${o.version}` };
  if (!o.skill || typeof o.skill !== 'object') return { error: 'bundle.skill missing' };
  const s = o.skill as Record<string, unknown>;
  if (typeof s.name !== 'string' || typeof s.description !== 'string' || typeof s.prompt !== 'string') {
    return { error: 'bundle.skill needs name/description/prompt strings' };
  }
  return {
    format: 'ollopa-skill',
    version: 1,
    skill: {
      name: s.name,
      description: s.description,
      autoTrigger: s.autoTrigger !== false,
      prompt: s.prompt,
      origin: typeof s.origin === 'string' ? s.origin : `<imported>${s.name}`,
    },
  };
}

/**
 * Materialise a bundle to disk: a fresh plugin dir under marketplaceRoot()
 * with a minimal plugin.json + the SKILL.md. Returns the SKILL.md path.
 */
export function importSkillBundle(raw: string): ImportResult {
  const parsed = parseBundle(raw);
  if ('error' in parsed) return { ok: false, error: parsed.error };
  const skill = parsed.skill;
  const root = marketplaceRoot();
  // Use a "imported" plugin name so the user can find/remove it later.
  const pluginName = `imported-${skill.name}`;
  const version = '0.0.0-imported';
  const target = join(root, `${pluginName}@${version}`);
  const skillDir = join(target, 'skills', skill.name);
  mkdirSync(skillDir, { recursive: true });
  // SKILL.md with frontmatter so loadSkillsFromDir picks it up.
  const md = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `autoTrigger: ${skill.autoTrigger !== false}`,
    '---',
    '',
    skill.prompt,
    '',
  ].join('\n');
  writeFileSync(join(skillDir, 'SKILL.md'), md, 'utf8');
  // Minimal plugin.json
  const pluginJson = {
    name: pluginName,
    version,
    description: `Imported skill '${skill.name}'`,
    provides: { skills: ['skills/'] },
  };
  writeFileSync(join(target, 'plugin.json'), JSON.stringify(pluginJson, null, 2), 'utf8');
  return { ok: true, path: join(skillDir, 'SKILL.md') };
}

/** Read .skill.json file from disk and import it. Convenience for the WS handler. */
export function importSkillFile(filePath: string): ImportResult {
  if (!existsSync(filePath)) return { ok: false, error: `file not found: ${filePath}` };
  const raw = readFileSync(filePath, 'utf8');
  return importSkillBundle(raw);
}