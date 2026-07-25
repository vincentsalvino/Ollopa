/**
 * Slash command dispatch.
 *
 * Phase 3.6: user types `/<name> <args>` in the webview. The extension host
 * forwards it as `chat:command` over WS; the sidecar looks the command up
 * in the plugin registry and runs its handler. The result is streamed back
 * as a `command_result` event, which the webview renders as a message card.
 */
import { getRegistry, type PluginContext } from './loader';
import type { AgentEvent } from '../agents/implementation';

export interface CommandSummary {
  name: string;
  description: string;
}

export function listCommands(): CommandSummary[] {
  return Array.from(getRegistry().commands.values()).map(({ command }) => ({
    name: command.name,
    description: command.description,
  }));
}

export async function runCommand(
  command: string,
  args: string,
  ctx: { taskId: string; send: (e: AgentEvent) => void; tempWorkspace: string | null },
): Promise<void> {
  const entry = getRegistry().commands.get(command);
  if (!entry) {
    ctx.send({ kind: 'command_result', taskId: ctx.taskId, command, output: `unknown command: /${command}`, kind_: 'error' } as unknown as AgentEvent);
    return;
  }
  const plugCtx: PluginContext = {
    tempWorkspaceRoot: ctx.tempWorkspace,
    retrieveMemory: async () => [], // commands don't have agent memory access yet
  };
  try {
    const result = await entry.command.handler(args, plugCtx);
    ctx.send({
      kind: 'command_result',
      taskId: ctx.taskId,
      command,
      output: result.text,
      kind_: result.kind ?? 'info',
    } as unknown as AgentEvent);
  } catch (err) {
    ctx.send({
      kind: 'command_result',
      taskId: ctx.taskId,
      command,
      output: `command failed: ${(err as Error).message}`,
      kind_: 'error',
    } as unknown as AgentEvent);
  }
}
