/**
 * Plugin registry — Phase 3.6.
 *
 * A plugin is a single `.js` file that exports an `OllopaPlugin` object.
 * Plugins live in one of two directories (scanned on startup, watched
 * thereafter):
 *   - project: <workspace>/.ollopa/plugins/*.js
 *   - global:  ~/.ollopa/plugins/*.js
 *
 * The registry merges everything into a single map per category (tools,
 * commands, hooks, providers). The agent loop pulls `tools` to extend its
 * tool schema; the webview pulls `commands` to populate the slash menu;
 * the tool bridge pulls `hooks` to wrap built-in tool execution; the
 * direct-provider list pulls `providers` to register new backends.
 *
 * Sandboxing: the MVP restricts plugin file access to the temp workspace
 * (already enforced by the tool bridge) or the plugin's own directory.
 * We do not run plugins in a VM yet — that is the next phase.
 */
import { existsSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface PluginTool {
  /** OpenAI function name. Must be unique across the registry. */
  name: string;
  /** Same shape as `ToolDefinition.function` in chatClient.ts. */
  definition: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  /**
   * Handler. `ctx` provides temp workspace + memory access. Throw to surface
   * an error to the agent loop; return `{ output, kind }` to deliver a
   * structured result.
   */
  handler: (args: Record<string, unknown>, ctx: PluginContext) => Promise<PluginResult>;
  /** If true, the tool may make network calls. Default false. */
  network?: boolean;
}

export interface PluginCommand {
  /** Slash command name, e.g. "commit" → user types `/commit`. */
  name: string;
  description: string;
  /** Returns the result that will be rendered as a message card. */
  handler: (args: string, ctx: PluginContext) => Promise<{ text: string; kind?: 'info' | 'success' | 'warning' | 'error' }>;
}

export interface PluginHook {
  /** e.g. "search_replace" or "*" for all. */
  tool: string;
  /** "before" or "after". */
  phase: 'before' | 'after';
  handler: (payload: PluginHookPayload) => Promise<void> | void;
}

export interface PluginHookPayload {
  toolName: string;
  args: Record<string, unknown>;
  output?: { toolName: string; output: string; kind: string };
  error?: Error;
}

export interface PluginDirectProvider {
  /** Stable name. */
  name: string;
  /** OpenAI-compatible base URL. */
  baseUrl: string;
  /** Whether enabled by default. */
  enabled?: boolean;
  /** The base model name to request. */
  defaultModel: string;
}

export interface OllopaPlugin {
  /** Display name for the slash menu. */
  name: string;
  /** Semver, informational. */
  version?: string;
  tools?: PluginTool[];
  commands?: PluginCommand[];
  hooks?: PluginHook[];
  providers?: PluginDirectProvider[];
  /**
   * Optional async init hook. Called once after the plugin loads. Use it to
   * register dynamic tools (e.g. OmniRoute MCP bridge). The `this` binding
   * is the plugin object itself — push into `this.tools` to register more.
   */
  init?: (this: OllopaPlugin) => Promise<void> | void;
}

export interface PluginContext {
  /** Path to the active task's temp workspace, or null if no task. */
  tempWorkspaceRoot: string | null;
  /** Memory retrieval (best-effort). */
  retrieveMemory: (query: string) => Promise<Array<{ title: string; content: string }>>;
}

export interface PluginResult {
  output: string;
  kind: 'terminal' | 'diff' | 'file' | 'info' | 'error';
}

export interface Registry {
  tools: Map<string, { tool: PluginTool; origin: string }>;
  commands: Map<string, { command: PluginCommand; origin: string }>;
  hooks: Array<{ hook: PluginHook; origin: string }>;
  providers: Map<string, { provider: PluginDirectProvider; origin: string }>;
}

function emptyRegistry(): Registry {
  return {
    tools: new Map(),
    commands: new Map(),
    hooks: [],
    providers: new Map(),
  };
}

let current: Registry = emptyRegistry();
let watchers: FSWatcher[] = [];

export function getRegistry(): Registry { return current; }

/** Replace the in-memory registry. Used by tests and by the watcher. */
export function setRegistry(r: Registry): void { current = r; }

/**
 * Register a built-in plugin (e.g. shipped with the sidecar) directly into
 * the live registry. Merges into the existing maps; does not replace them.
 * Used by `start.ts` to wire hardcoded commands like `/refine`.
 */
export function registerBuiltIn(plugin: Partial<OllopaPlugin>, origin: string): void {
  mergeInto(current, plugin, origin);
}

/** Where the loader looks. Both may not exist; both are scanned if they do. */
export function pluginDirs(workspaceRoot: string | null): { project: string; global: string } {
  return {
    project: workspaceRoot ? resolve(workspaceRoot, '.ollopa', 'plugins') : '',
    global: join(homedir(), '.ollopa', 'plugins'),
  };
}

/** Load every .js file in both plugin dirs. Errors are logged. Async because
 *  plugins may register dynamic tools via their `init` hook. */
export async function loadAll(workspaceRoot: string | null): Promise<Registry> {
  const dirs = pluginDirs(workspaceRoot);
  const reg = emptyRegistry();
  const all: string[] = [];
  for (const dir of [dirs.project, dirs.global]) {
    if (!dir || !existsSync(dir)) continue;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (entry.endsWith('.js')) all.push(join(dir, entry));
    }
  }
  await Promise.all(all.map((full) => loadOne(full, reg)));
  return reg;
}

async function loadOne(full: string, reg: Registry): Promise<void> {
  try {
    if (!statSync(full).isFile()) return;
    // Bust require cache so hot reload picks up changes.
    delete require.cache[require.resolve(full)];
    const mod = require(full) as Partial<OllopaPlugin> | { default: Partial<OllopaPlugin> };
    const plugin: Partial<OllopaPlugin> = (mod as any).default ?? mod;
    if (!plugin || typeof plugin !== 'object' || typeof plugin.name !== 'string') {
      console.warn(`[plugins] ${full} missing "name"; skipped`);
      return;
    }
    // First-merge: static tools/commands/hooks/providers. The init hook may
    // push more into `plugin.tools`, so we re-merge afterwards.
    mergeInto(reg, plugin, full);
    if (typeof plugin.init === 'function') {
      try {
        await plugin.init.call(plugin as OllopaPlugin);
        mergeInto(reg, plugin, full);
      } catch (err) {
        console.warn(`[plugins] ${full} init failed: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.warn(`[plugins] failed to load ${full}: ${(err as Error).message}`);
  }
}

function mergeInto(reg: Registry, plugin: Partial<OllopaPlugin>, origin: string): void {
  if (Array.isArray(plugin.tools)) {
    for (const t of plugin.tools) {
      if (!t || typeof t.name !== 'string' || typeof t.handler !== 'function') continue;
      if (reg.tools.has(t.name)) {
        console.warn(`[plugins] duplicate tool "${t.name}" from ${origin} — overwriting`);
      }
      reg.tools.set(t.name, { tool: t, origin });
    }
  }
  if (Array.isArray(plugin.commands)) {
    for (const c of plugin.commands) {
      if (!c || typeof c.name !== 'string' || typeof c.handler !== 'function') continue;
      if (reg.commands.has(c.name)) {
        console.warn(`[plugins] duplicate command "${c.name}" from ${origin} — overwriting`);
      }
      reg.commands.set(c.name, { command: c, origin });
    }
  }
  if (Array.isArray(plugin.hooks)) {
    for (const h of plugin.hooks) {
      if (!h || typeof h.tool !== 'string' || typeof h.handler !== 'function') continue;
      reg.hooks.push({ hook: h, origin });
    }
  }
  if (Array.isArray(plugin.providers)) {
    for (const p of plugin.providers) {
      if (!p || typeof p.name !== 'string' || typeof p.baseUrl !== 'string') continue;
      reg.providers.set(p.name, { provider: p, origin });
    }
  }
}

/** Start a watcher that re-loads the registry on any plugin file change. */
export function startWatcher(workspaceRoot: string | null, onChange: (reg: Registry) => void): void {
  stopWatcher();
  const dirs = pluginDirs(workspaceRoot);
  for (const dir of [dirs.project, dirs.global]) {
    if (!dir || !existsSync(dir)) continue;
    try {
      const w = watch(dir, { persistent: false }, () => {
        // Debounce: rapid file changes during a save can fire several events
        // in a few ms. 200ms is enough that we re-load once per save.
        clearTimeout((w as any)._reloadTimer);
        (w as any)._reloadTimer = setTimeout(async () => {
          try {
            const next = await loadAll(workspaceRoot);
            setRegistry(next);
            onChange(next);
          } catch (err) {
            console.warn('[plugins] reload failed:', (err as Error).message);
          }
        }, 200);
      });
      watchers.push(w);
    } catch (err) {
      console.warn(`[plugins] could not watch ${dir}: ${(err as Error).message}`);
    }
  }
}

export function stopWatcher(): void {
  for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
  watchers = [];
}

/**
 * Fire all hooks matching a given tool + phase. Plugin errors are caught and
 * logged — they must not crash the agent loop.
 */
export async function runHooks(phase: 'before' | 'after', payload: PluginHookPayload): Promise<void> {
  for (const { hook } of current.hooks) {
    if (hook.phase !== phase) continue;
    if (hook.tool !== '*' && hook.tool !== payload.toolName) continue;
    try { await hook.handler(payload); }
    catch (err) { console.warn(`[plugins] hook for ${payload.toolName} ${phase} threw: ${(err as Error).message}`); }
  }
}

// ─── Phase 10: Claude Code-compatible marketplace plugin loading ─────────────

import { existsSync as existsFs, copyFileSync, mkdirSync as mkdirP } from 'node:fs';
import { loadManifest } from './manifest';
import { loadCommandFromMarkdown } from './commandsMd';
import { loadAgentsFromDir, setAgents, listAgents as dumpAgents } from './agents';
import { loadSkillsFromDir, setSkills, listSkills as dumpSkills } from './skills';
import { loadHooksFile } from './hooksFile';
import {
  loadMcpServers, closeMcpClients, defaultMcpContext,
  type McpServerHandle,
} from './mcp';

let mcpHandles: McpServerHandle[] = [];

/**
 * Scan marketplace + project plugin directories for any subdir with a
 * plugin.json, and any flat .js files for back-compat. Returns the full
 * registry, agents list, skills list, and a close function for MCP.
 */
export interface MarketLoadResult {
  registry: Registry;
  agents: ReturnType<typeof dumpAgents>;
  skills: ReturnType<typeof dumpSkills>;
  mcpHandles: McpServerHandle[];
  close: () => void;
}

export async function loadAllFromMarket(
  workspaceRoot: string | null,
  opts: { includeFlatJs?: boolean; includeMarketplace?: boolean } = {},
): Promise<MarketLoadResult> {
  const includeFlatJs = opts.includeFlatJs !== false;
  const includeMarketplace = opts.includeMarketplace !== false;
  const dirs = pluginDirs(workspaceRoot);
  const reg = emptyRegistry();

  const candidates: string[] = [];

  // (1) Flat .js plugins (Phase 3.6) — back-compat.
  if (includeFlatJs) {
    for (const dir of [dirs.project, dirs.global]) {
      if (!dir || !existsFs(dir)) continue;
      let entries: string[];
      try { entries = readdirSync(dir); } catch { continue; }
      for (const entry of entries) {
        if (entry.endsWith('.js')) candidates.push(join(dir, entry));
      }
    }
  }

  // (2) Marketplace plugins — `~/.ollopa/plugins/<name>@<version>/`.
  if (includeMarketplace) {
    const mkt = dirs.global;
    if (existsFs(mkt)) {
      let entries: string[];
      try { entries = readdirSync(mkt); } catch { /* ignore */ entries = []; }
      for (const entry of entries) {
        if (entry.endsWith('.js')) continue; // already counted as flat .js
        const full = join(mkt, entry);
        let s;
        try { s = statSync(full); } catch { continue; }
        if (s.isDirectory()) candidates.push(full);
      }
    }

    // (3) Project plugin dirs — each subdir is a candidate, named or not.
    const proj = dirs.project;
    if (proj && existsFs(proj)) {
      let entries: string[];
      try { entries = readdirSync(proj); } catch { /* ignore */ entries = []; }
      for (const entry of entries) {
        if (entry.endsWith('.js')) continue;
        const full = join(proj, entry);
        let s;
        try { s = statSync(full); } catch { continue; }
        if (s.isDirectory()) candidates.push(full);
      }
    }
  }

  // First pass: flat .js files use the old loader.
  const jsCandidates = candidates.filter((c) => c.endsWith('.js'));
  await Promise.all(jsCandidates.map((full) => loadOne(full, reg)));

  // Second pass: directory candidates — try to parse as a manifest.
  const dirCandidates = candidates.filter((c) => !c.endsWith('.js'));
  const collectedAgents: ReturnType<typeof dumpAgents> = [];
  const collectedSkills: ReturnType<typeof dumpSkills> = [];
  const allMcpHandles: McpServerHandle[] = [];

  for (const dir of dirCandidates) {
    let manifest;
    try { manifest = loadManifest(dir); }
    catch (err) { console.warn(`[plugins] ${dir}: ${(err as Error).message}`); continue; }

    // Optional JS entry — back-compat with hybrid plugins
    if (manifest.resolved.entry && existsFs(manifest.resolved.entry)) {
      await loadOne(manifest.resolved.entry, reg);
    }

    // Markdown commands
    for (const f of manifest.resolved.commandFiles) {
      try {
        const { command } = loadCommandFromMarkdown(f, manifest.name);
        reg.commands.set(command.name, { command, origin: `${manifest.name}:${f}` });
      } catch (err) { console.warn(`[plugins] ${f}: ${(err as Error).message}`); }
    }

    // Agents
    for (const f of manifest.resolved.agentFiles) {
      const agentsDir = join(dir, 'agents');
      const list = loadAgentsFromDir(manifest.name, agentsDir);
      for (const a of list) collectedAgents.push(a);
    }

    // Skills — load every <skillDir>/SKILL.md
    const skillDirs = manifest.resolved.skillDirs.length > 0
      ? manifest.resolved.skillDirs.map((f) => join(dir, 'skills'))
      : [join(dir, 'skills')];
    for (const sd of skillDirs) {
      const list = loadSkillsFromDir(manifest.name, sd);
      for (const s of list) collectedSkills.push(s);
    }

    // Hooks file
    for (const f of manifest.resolved.hookFiles) {
      try {
        const hooks = loadHooksFile(f);
        for (const h of hooks) reg.hooks.push({ hook: h, origin: `${manifest.name}:${f}` });
      } catch (err) { console.warn(`[plugins] ${f}: ${(err as Error).message}`); }
    }

    // MCP
    for (const f of manifest.resolved.mcpFiles) {
      try {
        const { handles, tools } = await loadMcpServers(manifest.name, f, defaultMcpContext);
        for (const h of handles) allMcpHandles.push(h);
        for (const t of tools) reg.tools.set(t.name, { tool: t, origin: `${manifest.name}:mcp` });
      } catch (err) { console.warn(`[plugins] ${f}: ${(err as Error).message}`); }
    }
  }

  // Replace global agents + skills registries.
  setAgents(collectedAgents);
  setSkills(collectedSkills);
  mcpHandles = allMcpHandles;

  return {
    registry: reg,
    agents: collectedAgents,
    skills: collectedSkills,
    mcpHandles: allMcpHandles,
    close: () => closeMcpClients(allMcpHandles),
  };
}

/** Close all open MCP clients — used on sidecar shutdown. */
export function closeAllMcp(): void {
  closeMcpClients(mcpHandles);
  mcpHandles = [];
}

// Re-export small helpers used by tests.
export { mkdirP as mkdirSafe, copyFileSync };

