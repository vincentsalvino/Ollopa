/**
 * Skill loader (Phase 10).
 *
 * A skill is a directory containing SKILL.md:
 *
 *   my-plugin/skills/summarise/SKILL.md
 *
 *   ---
 *   name: summarise
 *   description: Summarise a long file or conversation
 *   autoTrigger: true
 *   ---
 *   When asked to summarise, read the source first, then write a
 *   3-bullet summary focused on outcomes.
 *
 * Skills are matched to user messages via cosine similarity between the
 * message embedding and each skill's description embedding. Top-N
 * matches above a threshold are injected as context into the next LLM
 * call. Auto-trigger can be disabled per skill.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter';
import type { MdSkillFrontmatter } from './commandsMd';

export interface LoadedSkill {
  name: string;
  description: string;
  autoTrigger: boolean;
  prompt: string;
  origin: string;
}

const skills: Map<string, LoadedSkill> = new Map();
const SKILL_THRESHOLD_DEFAULT = 0.78;
const SKILL_TOP_N = 2;

export function loadSkillsFromDir(pluginName: string, dir: string): LoadedSkill[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: LoadedSkill[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const file = join(full, 'SKILL.md');
    if (!existsSync(file)) continue;
    try {
      const s = loadSkillFromFile(pluginName, file);
      if (s) out.push(s);
    } catch (err) {
      console.warn(`[skills] ${file}: ${(err as Error).message}`);
    }
  }
  return out;
}

export function loadSkillFromFile(pluginName: string, file: string): LoadedSkill | null {
  const raw = readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const m = meta as Partial<MdSkillFrontmatter>;
  if (typeof m.name !== 'string' || typeof m.description !== 'string') return null;
  const skill: LoadedSkill = {
    name: m.name,
    description: m.description,
    autoTrigger: m.autoTrigger !== false,
    prompt: body,
    origin: `${pluginName}:${file}`,
  };
  skills.set(skill.name, skill);
  return skill;
}

export function setSkills(next: Iterable<LoadedSkill>): void {
  skills.clear();
  for (const s of next) skills.set(s.name, s);
}

export function listSkills(): LoadedSkill[] {
  return Array.from(skills.values());
}

export function getSkill(name: string): LoadedSkill | undefined {
  return skills.get(name);
}

/** Embedding + score hook — set by start.ts once we have an embedding client. */
let embedFn: ((text: string) => Promise<number[]>) | null = null;
export function setSkillEmbedder(fn: (t: string) => Promise<number[]>): void {
  embedFn = fn;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Auto-trigger: pick skills whose descriptions match the user message.
 * Returns the top-N auto-trigger skills above the threshold, ordered by
 * score descending. Logs all scores when SKILL_DEBUG=1.
 */
export async function selectSkillsForMessage(
  message: string,
  threshold = SKILL_THRESHOLD_DEFAULT,
): Promise<Array<{ skill: LoadedSkill; score: number }>> {
  if (!embedFn) return [];
  const msgEmb = await embedFn(message);
  const all = listSkills().filter((s) => s.autoTrigger);
  if (all.length === 0) return [];
  const scored = await Promise.all(all.map(async (s) => ({
    skill: s,
    score: cosine(msgEmb, await embedFn!(`${s.name}: ${s.description}`)),
  })));
  scored.sort((a, b) => b.score - a.score);
  if (process.env.SKILL_DEBUG === '1') {
    console.warn('[skills] scores:', scored.slice(0, 6).map((x) => `${x.skill.name}=${x.score.toFixed(2)}`).join(' '));
  }
  return scored.filter((x) => x.score >= threshold).slice(0, SKILL_TOP_N);
}

/**
 * Format selected skills as a context block to inject into the next LLM
 * call. Concise — token-conscious.
 */
export function renderSkillContext(selected: Array<{ skill: LoadedSkill; score: number }>): string {
  if (selected.length === 0) return '';
  const lines = selected.map(
    ({ skill, score }) => `[skill:${skill.name} score=${score.toFixed(2)}] ${skill.prompt.slice(0, 800)}`,
  );
  return `Available skills (apply ONLY if directly relevant):\n${lines.join('\n\n')}`;
}
