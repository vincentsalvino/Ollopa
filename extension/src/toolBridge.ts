/**
 * Tool bridge: executes the sidecar's tool_call against the temp workspace.
 *
 * The bridge is intentionally pure: it takes a tool call, runs it, and
 * returns a tool output. It does NOT speak WebSocket. The caller (the
 * WebviewProvider, wired through the SidecarManager) is responsible for
 * sending the result back to the sidecar.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import {
  getContext,
  markChanged,
  readTempFile,
  writeTempFile,
  type TempContext,
} from './tempWorkspace';
import { isSecretPath } from './filePolicy';
import { verifyCommand, getWhitelist } from './commandWhitelist';

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolOutput {
  toolName: string;
  output: string;
  kind: 'terminal' | 'diff' | 'file' | 'error';
}

const TOOL_NAMES = new Set(['search_replace', 'read_file', 'execute_safe_bash', 'run_lint', 'check_git_diff', 'semgrep_scan', 'move_file', 'batch_search_replace', 'list_files', 'run_tests', 'secrets_scan']);

export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function execute(taskId: string, call: ToolCall): Promise<ToolOutput> {
  const ctx = getContext(taskId);
  if (!ctx) {
    return { toolName: call.toolName, output: 'no temp workspace for task', kind: 'error' };
  }

  switch (call.toolName) {
    case 'search_replace':      return searchReplace(ctx, call.args);
    case 'read_file':           return readFileTool(ctx, call.args);
    case 'execute_safe_bash':   return safeBash(ctx, call.args);
    case 'run_lint':            return runLint(ctx, call.args);
    case 'check_git_diff':      return checkDiff(ctx);
    case 'semgrep_scan':        return semgrepScan(ctx, call.args);
    // Phase 1.1C
    case 'move_file':           return moveFile(ctx, call.args);
    case 'batch_search_replace':return batchSearchReplace(ctx, call.args);
    case 'list_files':          return listFiles(ctx, call.args);
    case 'run_tests':           return runTests(ctx, call.args);
    case 'secrets_scan':        return secretsScan(ctx, call.args);
    default:
      return { toolName: call.toolName, output: `unknown tool: ${call.toolName}`, kind: 'error' };
  }
}

function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

// ---------- search_replace ----------

async function searchReplace(ctx: TempContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const filePath = getStringArg(args, 'filePath');
  const oldStr = getStringArg(args, 'old_str');
  const newStr = getStringArg(args, 'new_str');
  if (!filePath || oldStr === undefined || newStr === undefined) {
    return { toolName: 'search_replace', output: 'missing filePath/old_str/new_str', kind: 'error' };
  }
  if (isSecretPath(filePath)) {
    return { toolName: 'search_replace', output: `refused: ${filePath} is a protected path`, kind: 'error' };
  }
  let current: string;
  try { current = await readTempFile(ctx, filePath); }
  catch (err) {
    return { toolName: 'search_replace', output: `read failed: ${(err as Error).message}`, kind: 'error' };
  }
  if (!current.includes(oldStr)) {
    return { toolName: 'search_replace', output: `old_str not found verbatim in ${filePath}`, kind: 'error' };
  }
  const occurrences = current.split(oldStr).length - 1;
  if (occurrences > 1) {
    return { toolName: 'search_replace', output: `old_str is not unique in ${filePath} (${occurrences} matches) — add more context`, kind: 'error' };
  }
  const updated = current.replace(oldStr, newStr);
  await writeTempFile(ctx, filePath, updated);
  markChanged(ctx.taskId, filePath);
  const patch = createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, current, updated, undefined, undefined, { context: 3 });
  return { toolName: 'search_replace', output: patch, kind: 'diff' };
}

// ---------- read_file ----------

async function readFileTool(ctx: TempContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const filePath = getStringArg(args, 'filePath');
  if (!filePath) return { toolName: 'read_file', output: 'missing filePath', kind: 'error' };
  if (isSecretPath(filePath)) {
    return { toolName: 'read_file', output: `refused: ${filePath} is a protected path`, kind: 'error' };
  }
  try {
    const content = await readTempFile(ctx, filePath);
    return { toolName: 'read_file', output: content, kind: 'file' };
  } catch (err) {
    return { toolName: 'read_file', output: `read failed: ${(err as Error).message}`, kind: 'error' };
  }
}

// ---------- execute_safe_bash ----------

async function safeBash(ctx: TempContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const command = getStringArg(args, 'command');
  if (!command) return { toolName: 'execute_safe_bash', output: 'missing command', kind: 'error' };
  const verdict = verifyCommand(command);
  if (!verdict.ok) return { toolName: 'execute_safe_bash', output: `denied: ${verdict.reason}`, kind: 'error' };

  return new Promise<ToolOutput>((resolve) => {
    const child = spawn(verdict.bin, verdict.args, {
      cwd: ctx.tempPath,
      shell: false,
      windowsHide: true,
    });
    const wl = getWhitelist();
    let stdout = '';
    let stderr = '';
    let killed = false;

    const t = setTimeout(() => {
      killed = true;
      try { child.kill(); } catch { /* noop */ }
    }, wl.maxTimeoutMs);

    child.stdout.on('data', (b: Buffer) => {
      if (stdout.length < wl.maxOutputBytes) {
        stdout += b.toString('utf8');
        if (stdout.length > wl.maxOutputBytes) stdout = stdout.slice(0, wl.maxOutputBytes) + '\n[truncated]';
      }
    });
    child.stderr.on('data', (b: Buffer) => {
      if (stderr.length < wl.maxOutputBytes) {
        stderr += b.toString('utf8');
        if (stderr.length > wl.maxOutputBytes) stderr = stderr.slice(0, wl.maxOutputBytes) + '\n[truncated]';
      }
    });
    child.on('error', (err) => {
      clearTimeout(t);
      resolve({ toolName: 'execute_safe_bash', output: `spawn error: ${err.message}`, kind: 'error' });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      const body = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
      const out = killed
        ? `${body}\n[killed after ${wl.maxTimeoutMs}ms timeout]`
        : body || `(no output, exit ${code ?? 'null'})`;
      resolve({
        toolName: 'execute_safe_bash',
        output: out,
        kind: killed || code !== 0 ? 'error' : 'terminal',
      });
    });
  });
}

// ---------- run_lint ----------

async function runLint(ctx: TempContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const filePaths = Array.isArray(args.filePaths)
    ? args.filePaths.filter((p): p is string => typeof p === 'string')
    : [];
  if (filePaths.length === 0) {
    return { toolName: 'run_lint', output: 'no filePaths provided', kind: 'error' };
  }
  return new Promise<ToolOutput>((resolve) => {
    const child = spawn('npx', ['--no-install', 'eslint', ...filePaths], {
      cwd: ctx.tempPath,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => { try { child.kill(); } catch { /* noop */ } }, 30_000);
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(t);
      resolve({ toolName: 'run_lint', output: `spawn error: ${err.message}`, kind: 'error' });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({
        toolName: 'run_lint',
        output: (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim() || `(exit ${code ?? 'null'})`,
        kind: code === 0 ? 'terminal' : 'error',
      });
    });
  });
}

// ---------- check_git_diff ----------

async function checkDiff(ctx: TempContext): Promise<ToolOutput> {
  const diffs: string[] = [];
  for (const rel of ctx.changedFiles) {
    const original = await safeReadReal(ctx, rel);
    const current = await readTempFile(ctx, rel).catch(() => '');
    if (original === null) {
      diffs.push(`# new file: ${rel}\n`);
      continue;
    }
    if (original === current) continue;
    diffs.push(createTwoFilesPatch(`a/${rel}`, `b/${rel}`, original, current, undefined, undefined, { context: 3 }));
  }
  if (diffs.length === 0) {
    return { toolName: 'check_git_diff', output: '(no changes recorded)', kind: 'terminal' };
  }
  return { toolName: 'check_git_diff', output: diffs.join('\n'), kind: 'diff' };
}

async function safeReadReal(ctx: TempContext, rel: string): Promise<string | null> {
  const norm = normalize(rel);
  if (isAbsolute(norm) || norm.startsWith('..')) return null;
  const abs = join(ctx.realPath, norm);
  // Defensive: confirm the resolved path is still inside realPath.
  if (!resolve(abs).startsWith(resolve(ctx.realPath) + '\\') &&
      !resolve(abs).startsWith(resolve(ctx.realPath) + '/')) {
    return null;
  }
  try { return await readFile(abs, 'utf8'); }
  catch { return null; }
}

// ---------- semgrep_scan ----------

interface SemgrepFinding {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    severity: 'INFO' | 'WARNING' | 'ERROR';
    message: string;
    metadata?: { category?: string; cwe?: string[]; owasp?: string[] };
  };
}

interface SemgrepResult {
  findings: SemgrepFinding[];
  errors: string[];
}

const SEMGREP_TIMEOUT_MS = 60_000;
const SEMGREP_CRITICAL_SEVERITIES = new Set(['ERROR']);

function isSemgrepCritical(f: SemgrepFinding): boolean {
  return SEMGREP_CRITICAL_SEVERITIES.has(f.extra?.severity);
}

/**
 * Run `npx semgrep --config auto --json` over the requested files in the
 * temp workspace. Returns a JSON line summary + a critical-findings list
 * (separated by a sentinel line so the Review agent can parse them).
 */
async function semgrepScan(ctx: TempContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const filePaths = Array.isArray(args.filePaths)
    ? args.filePaths.filter((p): p is string => typeof p === 'string')
    : [];
  if (filePaths.length === 0) {
    // No files specified — scan all changed files in the task.
    if (ctx.changedFiles.size === 0) {
      return { toolName: 'semgrep_scan', output: 'no filePaths provided and no changed files', kind: 'error' };
    }
    filePaths.push(...ctx.changedFiles);
  }

  // Only allow files inside the temp workspace.
  const safe: string[] = [];
  for (const rel of filePaths) {
    const norm = normalize(rel);
    if (isAbsolute(norm) || norm.startsWith('..')) continue;
    safe.push(norm);
  }
  if (safe.length === 0) {
    return { toolName: 'semgrep_scan', output: 'no valid file paths', kind: 'error' };
  }

  return new Promise<ToolOutput>((resolve) => {
    const child = spawn('npx', ['--no-install', 'semgrep', '--config', 'auto', '--json', '--quiet', ...safe], {
      cwd: ctx.tempPath,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => { try { child.kill(); } catch { /* noop */ } }, SEMGREP_TIMEOUT_MS);
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(t);
      resolve({ toolName: 'semgrep_scan', output: `spawn error: ${err.message}`, kind: 'error' });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      const result: SemgrepResult = { findings: [], errors: [] };
      try {
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed?.results)) result.findings = parsed.results as SemgrepFinding[];
        if (Array.isArray(parsed?.errors)) result.errors = parsed.errors.map((e: unknown) => String(e));
      } catch {
        result.errors.push(`semgrep returned non-JSON (exit ${code}): ${stdout.slice(0, 200)}`);
      }
      const critical = result.findings.filter(isSemgrepCritical);
      const summary = [
        `===SEMGREP_RESULT===`,
        JSON.stringify({
          totalFindings: result.findings.length,
          criticalCount: critical.length,
          critical: critical.map((f) => ({
            check_id: f.check_id,
            path: f.path,
            line: f.start?.line,
            message: f.extra?.message,
            severity: f.extra?.severity,
          })),
          errors: result.errors,
        }, null, 2),
      ].join('\n');
      resolve({
        toolName: 'semgrep_scan',
        output: summary,
        kind: critical.length > 0 ? 'error' : 'terminal',
      });
    });
  });
}

/* -------------------------------------------------------------------------- */
/*  Phase 1.1C — extended tools                                              */
/* -------------------------------------------------------------------------- */

import { rename as fsRename, unlink as fsUnlink, readdir as fsReaddir, stat as fsStat } from 'node:fs/promises';

// ---------- move_file ----------

async function moveFile(ctx: TempContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const src = getStringArg(args, 'src');
  const dst = getStringArg(args, 'dst');
  const overwrite = args.overwrite === true;
  if (!src || !dst) return { toolName: 'move_file', output: 'missing src/dst', kind: 'error' };
  if (isSecretPath(src) || isSecretPath(dst)) {
    return { toolName: 'move_file', output: `refused: ${isSecretPath(src) ? src : dst} is a protected path`, kind: 'error' };
  }
  const normSrc = normalize(src);
  const normDst = normalize(dst);
  if (isAbsolute(normSrc) || normSrc.startsWith('..') || isAbsolute(normDst) || normDst.startsWith('..')) {
    return { toolName: 'move_file', output: 'refused: src/dst must be workspace-relative', kind: 'error' };
  }
  const absSrc = join(ctx.tempPath, normSrc);
  const absDst = join(ctx.tempPath, normDst);
  // Defensive: stay inside tempPath.
  const realTemp = resolve(ctx.tempPath);
  if (!resolve(absSrc).startsWith(realTemp) || !resolve(absDst).startsWith(realTemp)) {
    return { toolName: 'move_file', output: 'refused: path escapes temp workspace', kind: 'error' };
  }
  // Check destination existence.
  let dstExists = false;
  try { await fsStat(absDst); dstExists = true; } catch { /* not exists */ }
  if (dstExists && !overwrite) {
    return { toolName: 'move_file', output: `refused: ${dst} already exists (set overwrite=true)`, kind: 'error' };
  }
  if (dstExists) {
    try { await fsUnlink(absDst); } catch (err) {
      return { toolName: 'move_file', output: `unlink dst failed: ${(err as Error).message}`, kind: 'error' };
    }
  }
  try {
    await fsRename(absSrc, absDst);
  } catch (err) {
    return { toolName: 'move_file', output: `rename failed: ${(err as Error).message}`, kind: 'error' };
  }
  markChanged(ctx.taskId, normDst);
  return { toolName: 'move_file', output: `moved ${src} -> ${dst}`, kind: 'terminal' };
}

// ---------- batch_search_replace ----------

interface BatchEdit { filePath: string; old_str: string; new_str: string; }

async function batchSearchReplace(ctx: TempContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const raw = Array.isArray(args.edits) ? args.edits : [];
  const edits: BatchEdit[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.filePath === 'string' && typeof o.old_str === 'string' && typeof o.new_str === 'string') {
      edits.push({ filePath: o.filePath, old_str: o.old_str, new_str: o.new_str });
    }
  }
  if (edits.length === 0) return { toolName: 'batch_search_replace', output: 'no valid edits', kind: 'error' };
  // Dry-run validation pass — fail fast before mutating any file.
  const byFile = new Map<string, { original: string; applied: string[] }>();
  for (const e of edits) {
    if (isSecretPath(e.filePath)) {
      return { toolName: 'batch_search_replace', output: `refused: ${e.filePath} is a protected path`, kind: 'error' };
    }
    if (!byFile.has(e.filePath)) {
      let orig: string;
      try { orig = await readTempFile(ctx, e.filePath); }
      catch (err) { return { toolName: 'batch_search_replace', output: `read ${e.filePath} failed: ${(err as Error).message}`, kind: 'error' }; }
      byFile.set(e.filePath, { original: orig, applied: [] });
    }
    const entry = byFile.get(e.filePath)!;
    const before = entry.applied.length > 0
      ? entry.applied[entry.applied.length - 1]
      : entry.original;
    if (!before.includes(e.old_str)) {
      return { toolName: 'batch_search_replace', output: `old_str not found in ${e.filePath}`, kind: 'error' };
    }
    const occurrences = before.split(e.old_str).length - 1;
    if (occurrences > 1) {
      return { toolName: 'batch_search_replace', output: `old_str not unique in ${e.filePath} (${occurrences} matches)`, kind: 'error' };
    }
    entry.applied.push(before.replace(e.old_str, e.new_str));
  }
  // Commit.
  const patches: string[] = [];
  for (const [filePath, entry] of byFile) {
    const final = entry.applied[entry.applied.length - 1];
    await writeTempFile(ctx, filePath, final);
    markChanged(ctx.taskId, filePath);
    if (entry.original !== final) {
      patches.push(createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, entry.original, final, undefined, undefined, { context: 3 }));
    }
  }
  return { toolName: 'batch_search_replace', output: patches.join('\n') || '(no net change)', kind: 'diff' };
}

// ---------- list_files ----------

async function listFiles(ctx: TempContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const pattern = typeof args.pattern === 'string' ? args.pattern : '**/*';
  // Ponytail: literal substring match instead of pulling in a glob lib.
  // Worker can pre-filter client-side if it needs glob semantics.
  // Real glob matching is a "nice to have" — add `glob` dep only if needed.
  const out: string[] = [];
  const norm = pattern.replace(/^\*\*\/\*$/, ''); // empty = match all
  const needle = norm.replace(/^\*\*?\//, '').replace(/\*\*?$/, '');
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try { entries = await fsReaddir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = join(dir, ent.name);
      if (needle === '' || rel.includes(needle)) out.push(rel);
      if (ent.isDirectory()) await walk(abs, rel);
    }
  }
  await walk(ctx.tempPath, '');
  if (out.length === 0) return { toolName: 'list_files', output: '(no files matched)', kind: 'terminal' };
  // Cap output to avoid blowing the worker's context window.
  const cap = 500;
  const truncated = out.length > cap;
  const shown = truncated ? out.slice(0, cap) : out;
  return {
    toolName: 'list_files',
    output: shown.join('\n') + (truncated ? `\n…(truncated, ${out.length - cap} more)` : ''),
    kind: 'terminal',
  };
}

// ---------- run_tests ----------

const TEST_TIMEOUT_MS = 5 * 60 * 1000;

async function runTests(ctx: TempContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const command = getStringArg(args, 'command');
  if (!command) return { toolName: 'run_tests', output: 'missing command', kind: 'error' };
  const verdict = verifyCommand(command);
  if (!verdict.ok) return { toolName: 'run_tests', output: `denied: ${verdict.reason}`, kind: 'error' };
  // Reject anything that is not a recognized test runner.
  const isTestCmd =
    (verdict.bin === 'npm' && verdict.args[0] === 'test') ||
    (verdict.bin === 'npx' && (verdict.args[0] === 'jest' || verdict.args[0] === 'vitest'));
  if (!isTestCmd) {
    return { toolName: 'run_tests', output: 'denied: only npm test / npx jest / npx vitest allowed', kind: 'error' };
  }
  return new Promise<ToolOutput>((resolve) => {
    const child = spawn(verdict.bin, verdict.args, {
      cwd: ctx.tempPath,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      try { child.kill(); } catch { /* noop */ }
    }, TEST_TIMEOUT_MS);
    const cap = 64 * 1024;
    child.stdout.on('data', (b: Buffer) => {
      if (stdout.length < cap) { stdout += b.toString('utf8'); if (stdout.length > cap) stdout = stdout.slice(0, cap) + '\n[truncated]'; }
    });
    child.stderr.on('data', (b: Buffer) => {
      if (stderr.length < cap) { stderr += b.toString('utf8'); if (stderr.length > cap) stderr = stderr.slice(0, cap) + '\n[truncated]'; }
    });
    child.on('error', (err) => {
      clearTimeout(t);
      resolve({ toolName: 'run_tests', output: `spawn error: ${err.message}`, kind: 'error' });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      const body = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
      const out = killed ? `${body}\n[killed after ${TEST_TIMEOUT_MS}ms timeout]` : body || `(no output, exit ${code ?? 'null'})`;
      resolve({ toolName: 'run_tests', output: out, kind: killed || code !== 0 ? 'error' : 'terminal' });
    });
  });
}

// ---------- secrets_scan (regex sweep, no external dep) ----------

// Ponytail: a few well-known patterns, not a real secret scanner.
// Real detection belongs in semgrep_scan (Phase 5). This is the cheap pre-check.
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'aws-access-key',     re: /AKIA[0-9A-Z]{16}/g },
  { name: 'aws-secret-key',     re: /aws_secret_access_key\s*=\s*['"][A-Za-z0-9/+=]{40}['"]/gi },
  { name: 'github-pat',         re: /ghp_[A-Za-z0-9]{36}/g },
  { name: 'slack-token',        re: /xox[abp]-[0-9A-Za-z-]{10,}/g },
  { name: 'private-key-block',  re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'jwt',                re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
];

async function secretsScan(ctx: TempContext, args: Record<string, unknown>): Promise<ToolOutput> {
  const requested = Array.isArray(args.filePaths)
    ? (args.filePaths as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];
  const files = requested.length > 0
    ? requested
    : Array.from(ctx.changedFiles);
  if (files.length === 0) return { toolName: 'secrets_scan', output: 'no files to scan', kind: 'terminal' };
  const findings: Array<{ file: string; line: number; kind: string; snippet: string }> = [];
  for (const rel of files) {
    if (isSecretPath(rel)) continue; // skip protected files — don't even try
    const norm = normalize(rel);
    if (isAbsolute(norm) || norm.startsWith('..')) continue;
    let content: string;
    try { content = await readTempFile(ctx, norm); }
    catch { continue; }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const { name, re } of SECRET_PATTERNS) {
        re.lastIndex = 0;
        if (re.test(lines[i])) {
          findings.push({ file: norm, line: i + 1, kind: name, snippet: lines[i].slice(0, 120) });
        }
      }
    }
  }
  if (findings.length === 0) {
    return { toolName: 'secrets_scan', output: `scanned ${files.length} file(s); no secrets found`, kind: 'terminal' };
  }
  const summary = [
    `===SECRETS_RESULT===`,
    JSON.stringify({ count: findings.length, findings }, null, 2),
  ].join('\n');
  return { toolName: 'secrets_scan', output: summary, kind: 'error' };
}
