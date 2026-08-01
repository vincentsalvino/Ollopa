/**
 * Minimal YAML-ish frontmatter parser for plugin commands/agents/skills.
 *
 * Supports:
 *   - `key: value` strings, booleans, numbers
 *   - `key:` followed by indented list (one per line, '-' prefix)
 *   - `key: [a, b, c]` inline array
 *
 * Not a full YAML implementation — frontmatter for these files is tiny and
 * stable. Keep it that way; no extra dep.
 */

export interface FrontmatterResult {
  /** Everything before the second `---`. */
  meta: Record<string, unknown>;
  /** The body content (trimmed). */
  body: string;
}

const FRONT_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): FrontmatterResult {
  const m = FRONT_RE.exec(raw);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = parseYamlBlock(m[1]);
  return { meta, body: m[2].trim() };
}

function parseYamlBlock(src: string): Record<string, unknown> {
  const lines = src.split(/\r?\n/);
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) { i++; continue; }
    const key = m[1];
    const rest = m[2].trim();
    if (rest === '') {
      // Could be inline map (rare) or list block — look ahead.
      const collected: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+/.test(lines[j])) {
        collected.push(lines[j].replace(/^\s+/, ''));
        j++;
      }
      if (collected.length === 0) { out[key] = ''; i++; continue; }
      // List block?
      if (collected.every((c) => c.startsWith('- ') || c === '-')) {
        out[key] = collected.map((c) => c.replace(/^-\s*/, ''));
      } else {
        out[key] = collected.join('\n');
      }
      i = j;
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      // Inline array
      const inner = rest.slice(1, -1).trim();
      out[key] = inner.length === 0 ? [] : splitTopLevel(inner, ',').map((s) => coerce(s.trim()));
      i++;
    } else {
      out[key] = coerce(rest);
      i++;
    }
  }
  return out;
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let cur = '';
  for (const ch of s) {
    if (inStr) {
      cur += ch;
      if (ch === inStr && cur[cur.length - 2] !== '\\') inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; cur += ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function coerce(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s === '') return '';
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  // Strip surrounding quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
