/**
 * Temp workspace manager.
 *
 * Phase 3 model: a fresh copy under `os.tmpdir()/ollopa-<taskId>/` for each
 * task. On Apply, only the files the tool bridge touched are copied back to
 * the real workspace. Cleanup removes the temp dir on Accept, Reject, and
 * dispose.
 *
 * `fs.cp` with `recursive: true` is available in Node 16.7+; we're on 20.
 */
import { cp, mkdir, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface TempContext {
  taskId: string;
  realPath: string;   // absolute path to the user's workspace
  tempPath: string;   // absolute path to the temp copy
  changedFiles: Set<string>; // workspace-relative paths
}

const contexts = new Map<string, TempContext>();

export function getContext(taskId: string): TempContext | undefined {
  return contexts.get(taskId);
}

export function allContexts(): TempContext[] {
  return Array.from(contexts.values());
}

export async function create(realPath: string, taskId: string): Promise<TempContext> {
  if (contexts.has(taskId)) {
    throw new Error(`temp workspace already exists for taskId ${taskId}`);
  }
  if (!existsSync(realPath)) {
    throw new Error(`real workspace does not exist: ${realPath}`);
  }
  const s = await stat(realPath);
  if (!s.isDirectory()) {
    throw new Error(`real workspace is not a directory: ${realPath}`);
  }
  const tempPath = path.join(os.tmpdir(), `ollopa-${taskId}`);
  // Wipe any prior copy from a previous run with the same taskId.
  if (existsSync(tempPath)) {
    await rm(tempPath, { recursive: true, force: true });
  }
  await mkdir(path.dirname(tempPath), { recursive: true });
  // Exclude common heavy / unwanted dirs from the copy so a copy of a big
  // monorepo is fast. Phase 3 keeps it simple — just .git.
  await cp(realPath, tempPath, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes('.git'),
  });
  const ctx: TempContext = { taskId, realPath, tempPath, changedFiles: new Set() };
  contexts.set(taskId, ctx);
  return ctx;
}

/**
 * Mark a file as changed (workspace-relative). The bridge calls this on
 * every successful search_replace so we know what to copy back on Apply.
 */
export function markChanged(taskId: string, relativePath: string): void {
  const ctx = contexts.get(taskId);
  if (!ctx) return;
  ctx.changedFiles.add(relativePath.replace(/\\/g, '/'));
}

/** Absolute path within the temp workspace, with traversal protection. */
export function resolveTempPath(ctx: TempContext, relativePath: string): string | null {
  const norm = path.normalize(relativePath);
  if (norm.startsWith('..') || path.isAbsolute(norm)) return null;
  return path.join(ctx.tempPath, norm);
}

/** Read a file from the temp workspace. */
export async function readTempFile(ctx: TempContext, relativePath: string): Promise<string> {
  const abs = resolveTempPath(ctx, relativePath);
  if (!abs) throw new Error(`path escapes temp workspace: ${relativePath}`);
  return readFile(abs, 'utf8');
}

/** Write a file into the temp workspace. */
export async function writeTempFile(ctx: TempContext, relativePath: string, content: string): Promise<void> {
  const abs = resolveTempPath(ctx, relativePath);
  if (!abs) throw new Error(`path escapes temp workspace: ${relativePath}`);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

/** Apply the recorded changes back to the real workspace. */
export async function apply(ctx: TempContext): Promise<string[]> {
  const applied: string[] = [];
  for (const rel of ctx.changedFiles) {
    const src = path.join(ctx.tempPath, rel);
    const dst = path.join(ctx.realPath, rel);
    if (!existsSync(src)) continue; // file was deleted
    await mkdir(path.dirname(dst), { recursive: true });
    await cp(src, dst);
    applied.push(rel);
  }
  return applied;
}

/** Recursively copy a directory's contents. */
export async function copyDirContents(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDirContents(s, d);
    else await cp(s, d);
  }
}

/** Remove the temp workspace. Safe to call multiple times. */
export async function cleanup(taskId: string): Promise<void> {
  const ctx = contexts.get(taskId);
  if (!ctx) return;
  contexts.delete(taskId);
  if (existsSync(ctx.tempPath)) {
    await rm(ctx.tempPath, { recursive: true, force: true });
  }
}

export async function cleanupAll(): Promise<void> {
  const ids = Array.from(contexts.keys());
  for (const id of ids) await cleanup(id);
}
