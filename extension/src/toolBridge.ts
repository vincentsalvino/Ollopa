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

const TOOL_NAMES = new Set(['search_replace', 'read_file', 'execute_safe_bash', 'run_lint', 'check_git_diff']);

export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function execute(taskId: string, call: ToolCall): Promise<ToolOutput> {
  const ctx = getContext(taskId);
  if (!ctx) {
    return { toolName: call.toolName, output: 'no temp workspace for task', kind: 'error' };
  }

  switch (call.toolName) {
    case 'search_replace':    return searchReplace(ctx, call.args);
    case 'read_file':         return readFileTool(ctx, call.args);
    case 'execute_safe_bash': return safeBash(ctx, call.args);
    case 'run_lint':          return runLint(ctx, call.args);
    case 'check_git_diff':    return checkDiff(ctx);
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
