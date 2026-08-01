/**
 * Tool-call await registry.
 *
 * The agent loop emits a `tool_call` and then needs to pause until the
 * extension host sends back a `tool_output` for that same task. The WS
 * message handler (in start.ts) calls `resolve(taskId, output)` when the
 * reply arrives. The agent calls `awaitToolOutput(taskId, timeoutMs)`.
 *
 * Per-task: one in-flight tool at a time. Multi-tool turns (the LLM
 * returning several tool_calls in one message) are not supported in Quick
 * Mode — the agent processes the first and re-prompts the model with the
 * result, which keeps the contract simple and matches Phase 3 scope.
 */
export interface ToolOutputPayload {
  toolName: string;
  output: string;
  kind: 'terminal' | 'diff' | 'file' | 'error';
}

interface Pending {
  resolve: (out: ToolOutputPayload) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class ToolAwaiter {
  private pending = new Map<string, Pending>();

  awaitToolOutput(taskId: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ToolOutputPayload> {
    return new Promise<ToolOutputPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(taskId)) {
          reject(new Error(`Tool output timed out after ${timeoutMs}ms for task ${taskId}`));
        }
      }, timeoutMs);
      this.pending.set(taskId, { resolve, reject, timer });
    });
  }

  resolve(taskId: string, output: ToolOutputPayload): boolean {
    const p = this.pending.get(taskId);
    if (!p) return false;
    this.pending.delete(taskId);
    clearTimeout(p.timer);
    p.resolve(output);
    return true;
  }

  rejectAll(reason: string): void {
    for (const [taskId, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(taskId);
    }
  }

  /**
   * Reject only the pending tool output for a specific task. Used by the
   * cancellation path (Phase 8) so cancelling one task doesn't disturb
   * concurrent tasks sharing the same awaiter.
   */
  rejectAllForTask(taskId: string, reason: string): boolean {
    const p = this.pending.get(taskId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(taskId);
    p.reject(new Error(reason));
    return true;
  }
}
