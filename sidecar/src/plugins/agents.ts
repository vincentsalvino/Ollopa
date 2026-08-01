/**
 * Agent loader (Phase 10).
 *
 * An agent is a markdown file describing a Task Mode sub-agent:
 *
 *   ---
 *   name: reviewer
 *   description: Code reviewer focused on correctness
 *   tools:
 *     - read_file
 *     - search_replace
 *     - execute_safe_bash
 *   model: claude-opus-4-7
 *   ---
 *   You are a senior reviewer. Read every changed file, run tests, and
 *   emit a PASS/FAIL with bullet evidence.
 *
 * Agents are launched via the Task Mode orchestrator with the named tool
 * subset; the body becomes the system prompt. The registry exposes them
 * by name; callers (built-in commands or future webview UI) resolve them.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter';
import type { MdAgentFrontmatter } from './commandsMd';

export interface LoadedAgent {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  /** Markdown body — system prompt. */
  prompt: string;
  /** File the agent was loaded from. */
  origin: string;
}

const agents: Map<string, LoadedAgent> = new Map();

/** Load every .md file in the given plugin agents/ dir. */
export function loadAgentsFromDir(pluginName: string, dir: string): LoadedAgent[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: LoadedAgent[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.md')) continue;
    const file = join(dir, entry);
    try {
      const a = loadAgentFromFile(pluginName, file);
      if (a) out.push(a);
    } catch (err) {
      console.warn(`[agents] ${file}: ${(err as Error).message}`);
    }
  }
  return out;
}

export function loadAgentFromFile(pluginName: string, file: string): LoadedAgent | null {
  const raw = readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const m = meta as Partial<MdAgentFrontmatter>;
  if (typeof m.name !== 'string' || typeof m.description !== 'string') return null;
  const agent: LoadedAgent = {
    name: m.name,
    description: m.description,
    tools: Array.isArray(m.tools) ? m.tools.filter((t) => typeof t === 'string') : [],
    model: typeof m.model === 'string' ? m.model : undefined,
    prompt: body,
    origin: `${pluginName}:${file}`,
  };
  agents.set(agent.name, agent);
  return agent;
}

/** Replace the entire agents registry — used after a plugin reload. */
export function setAgents(next: Iterable<LoadedAgent>): void {
  agents.clear();
  for (const a of next) agents.set(a.name, a);
}

/** Get a single agent by name, or undefined. */
export function getAgent(name: string): LoadedAgent | undefined {
  return agents.get(name);
}

/** List all loaded agents. */
export function listAgents(): LoadedAgent[] {
  return Array.from(agents.values());
}
