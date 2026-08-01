/**
 * Hooks file loader (Phase 10).
 *
 * Reads Claude Code-style `hooks/hooks.json`:
 *
 *   {
 *     "hooks": {
 *       "PostToolUse": [
 *         { "matcher": "search_replace", "command": "npx prettier --write $FILE" },
 *         { "matcher": "*",              "command": "echo done" }
 *       ],
 *       "UserPromptSubmit": [
 *         { "matcher": "*", "command": "echo user prompt: $TEXT" }
 *       ]
 *     }
 *   }
 *
 * Maps each entry onto the existing `PluginHook` shape so the rest of the
 * runtime stays unaware of the file format. `$FILE`, `$TEXT`, `$TOOL`
 * placeholders in commands are substituted at fire-time from the hook payload.
 */
import { readFileSync, existsSync } from 'node:fs';
import type { PluginHook } from './loader';

export interface HooksFile {
  hooks?: Partial<{
    /** PreToolUse / PostToolUse map to the existing PluginHook shape. */
    PreToolUse: Array<{ matcher: string; command: string }>;
    PostToolUse: Array<{ matcher: string; command: string }>;
    /** Not currently surfaced to the agent loop; stored for forward compat. */
    UserPromptSubmit: Array<{ matcher: string; command: string }>;
    SessionStart: Array<{ matcher: string; command: string }>;
    SessionEnd: Array<{ matcher: string; command: string }>;
  }>;
}

const TOOL_TO_PHASE: Record<string, 'before' | 'after'> = {
  PreToolUse: 'before',
  PostToolUse: 'after',
};

/** Read a hooks.json file and return an array of PluginHook entries. */
export function loadHooksFile(file: string): PluginHook[] {
  if (!existsSync(file)) return [];
  let raw: HooksFile;
  try { raw = JSON.parse(readFileSync(file, 'utf8')) as HooksFile; }
  catch (err) { throw new Error(`[hooks] ${file}: invalid JSON: ${(err as Error).message}`); }
  if (!raw || typeof raw !== 'object') return [];

  const out: PluginHook[] = [];
  for (const event of Object.keys(raw.hooks ?? {}) as Array<keyof NonNullable<HooksFile['hooks']>>) {
    const phase = TOOL_TO_PHASE[event as string];
    if (!phase) continue; // SessionStart/End/UserPromptSubmit: stored for later
    const entries = raw.hooks?.[event];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry.matcher !== 'string' || typeof entry.command !== 'string') continue;
      out.push({
        tool: entry.matcher,
        phase,
        handler: async (payload) => {
          const cmd = entry.command
            .replace(/\$TOOL/g, payload.toolName)
            .replace(/\$FILE/g, String((payload.args as Record<string, unknown>).filePath ?? ''))
            .replace(/\$TEXT/g, JSON.stringify(payload.args ?? {}));
          try {
            // Defer import to keep hooksFile.ts free of child-process weight in test envs.
            const { spawn } = await import('node:child_process');
            await new Promise<void>((resolveP) => {
              const proc = spawn(cmd, { shell: true, stdio: 'ignore' });
              proc.on('exit', () => resolveP());
              proc.on('error', () => resolveP());
            });
          } catch {
            // Swallow — hook failures must not break the agent loop.
          }
        },
      });
    }
  }
  return out;
}
