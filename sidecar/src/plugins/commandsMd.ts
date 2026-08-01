/**
 * Markdown command loader (Phase 10).
 *
 * A command is a single .md file with frontmatter:
 *
 *   ---
 *   name: hello
 *   description: Say hi
 *   args:
 *     - name: who
 *       required: false
 *   ---
 *   Greet {{who}} politely. Confirm before continuing.
 *
 * The body becomes the system prompt of an LLM-driven command. When the
 * user invokes `/hello name=Ada`, we substitute {{who}} with "Ada", and
 * call the chat client with the current conversation context appended.
 */
import { readFileSync } from 'node:fs';
import { parseFrontmatter } from './frontmatter';
import { type PluginCommand } from './loader';

export interface MdCommandFrontmatter {
  name: string;
  description: string;
  args?: Array<{ name: string; required?: boolean; description?: string }>;
  /** Optional override for the LLM model. */
  model?: string;
}

export interface MdAgentFrontmatter {
  name: string;
  description: string;
  /** Subset of base tool names this agent may call. */
  tools?: string[];
  /** Override LLM model for this agent. */
  model?: string;
}

export interface MdSkillFrontmatter {
  name: string;
  description: string;
  /** When false, skill must be invoked explicitly. */
  autoTrigger?: boolean;
}

/**
 * Parse a freeform `/<cmd> <args>` invocation into a simple object.
 * Supports `key=value` pairs and bare trailing positionals joined with spaces.
 * Examples:
 *   /hello name=Ada          -> { name: 'Ada' }
 *   /commit "fix: typo"      -> { _: 'fix: typo' }
 *   /plan a b c              -> { _: 'a b c' }
 */
export function parseCommandArgs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const trimmed = raw.trim();
  if (!trimmed) return out;

  // Quick path: a single quoted string goes to `_`
  if (/^"[^"]*"$/.test(trimmed) || /^'[^']*'$/.test(trimmed)) {
    out._ = trimmed.slice(1, -1);
    return out;
  }

  const pairRe = /([a-zA-Z_][\w-]*)=("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(trimmed)) !== null) {
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
    out[m[1]] = val;
    consumed = m.index + m[0].length;
  }
  const trailing = trimmed.slice(consumed).trim();
  if (trailing) out._ = trailing;
  return out;
}

/** Substitute {{key}} placeholders in a template string. */
export function renderTemplate(tmpl: string, args: Record<string, string>): string {
  return tmpl.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key: string) => {
    return args[key] ?? args._ ?? '';
  });
}

/**
 * Build a PluginCommand from a markdown file's contents.
 * The handler returns the rendered prompt as a string — a thin wrapper.
 * Real LLM-driven command behaviour lives in `runCommandFromMarkdown`,
 * which the start.ts IPC layer will call instead.
 */
export function loadCommandFromMarkdown(file: string, pluginName: string): {
  meta: MdCommandFrontmatter;
  body: string;
  command: PluginCommand;
} {
  const raw = readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const m = meta as Partial<MdCommandFrontmatter>;
  if (typeof m.name !== 'string' || typeof m.description !== 'string') {
    throw new Error(`[commands-md] ${file}: missing name or description in frontmatter`);
  }

  const args = (m.args ?? []).map((a) => ({
    name: String(a.name),
    required: Boolean(a.required),
    description: typeof a.description === 'string' ? a.description : undefined,
  }));

  // The handler returns the rendered prompt. The IPC layer in start.ts will
  // detect this shape and route to the chat client instead.
  const command: PluginCommand = {
    name: m.name,
    description: m.description,
    handler: async (rawArgs: string) => {
      const parsed = parseCommandArgs(rawArgs);
      // Build a short preview message. The IPC layer reads this kind.
      return {
        text: renderTemplate(body, { _: rawArgs, ...parsed }),
        kind: 'info' as const,
      };
    },
  };
  // Stash metadata on the command for the IPC layer.
  (command as unknown as { __md?: object }).__md = {
    pluginName, file, prompt: body, args, model: m.model,
  };
  return { meta: m as MdCommandFrontmatter, body, command };
}
