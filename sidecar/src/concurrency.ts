/**
 * Concurrency & cancellation — Phase 8.
 *
 * The sidecar now supports multiple concurrent tasks. Each one carries an
 * AbortController so a `task_cancel` message can halt the running graph
 * promptly. The cancellation is cooperative — nodes that want to honour
 * it must check `isCancelled(taskId)` at safe points (or rely on the
 * LangGraph `interrupt()` mechanism via Command({ resume })). The
 * Awaiter rejects any pending tool_output so the loop exits.
 */
import { ToolAwaiter } from './agents/toolAwaiter';

export interface ActiveTask {
  taskId: string;
  controller: AbortController;
  startedAt: number;
  kind: 'quick' | 'task' | 'command';
}

const active = new Map<string, ActiveTask>();

export function registerTask(taskId: string, kind: ActiveTask['kind']): AbortController {
  const controller = new AbortController();
  active.set(taskId, { taskId, controller, startedAt: Date.now(), kind });
  return controller;
}

export function unregisterTask(taskId: string): void {
  active.delete(taskId);
}

export function isCancelled(taskId: string): boolean {
  return active.get(taskId)?.controller.signal.aborted ?? false;
}

export function abortTask(taskId: string, awaiter?: ToolAwaiter): boolean {
  const t = active.get(taskId);
  if (!t) return false;
  t.controller.abort();
  if (awaiter) awaiter.rejectAllForTask(taskId, 'task cancelled');
  return true;
}

export function listActive(): ActiveTask[] {
  return Array.from(active.values());
}

export function getActive(taskId: string): ActiveTask | undefined {
  return active.get(taskId);
}