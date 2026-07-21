/**
 * Quick Mode implementation agent.
 *
 * Lifecycle:
 *   1. Retrieve memories (scope='general', limit=3).
 *   2. Build system prompt + memories + user task as messages.
 *   3. Loop:
 *        chatCompletion(messages, TOOL_DEFS)
 *        - If the result has tool_calls: emit each as an event, await the
 *          tool_output reply, append tool result, continue.
 *          (Quick Mode processes one tool at a time to keep the contract
 *          simple — multi-tool turns come in a later phase.)
 *        - If only text: emit agent_thought, break.
 *   4. If any search_replace calls were issued, request a final diff from
 *      the extension via the synthetic "self diff" path: we re-derive the
 *      per-file diffs locally using the recorded edits against the
 *      `read_file` snapshots we collected along the way. This is enough
 *      for the Phase 3 acceptance test and avoids requiring a git repo.
 *      The extension host remains the source of truth for the final
 *      workspace state.
 */
import { chatCompletion, type ChatMessage, type ChatResult } from '../llm/chatClient';
import { TOOL_DEFS } from '../tools/definitions';
import { retrieveMemory } from '../memory/memoryService';
import { ToolAwaiter, type ToolOutputPayload } from './toolAwaiter';
import { buildUnifiedDiff, replayEdits } from './diffSynth';

export interface SearchReplaceEdit {
  filePath: string;
  old_str: string;
  new_str: string;
}

export interface AgentEvent {
  kind:
    | 'agent_thought'
    | 'tool_call'
    | 'task_final_diff'
    | 'task_error'
    | 'task_complete';
  taskId: string;
  // payload fields
  message?: string;
  agent?: 'implementation';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  diff?: string;
  error?: string;
}

export interface AgentContext {
  taskId: string;
  send: (event: AgentEvent) => void;
  awaiter: ToolAwaiter;
}

/**
 * Run the agent to completion. Resolves with the list of search_replace
 * edits performed — the caller (start.ts) uses these to build the final
 * diff sent to the webview.
 */
export async function runQuickMode(
  task: string,
  ctx: AgentContext,
): Promise<SearchReplaceEdit[]> {
  // 1. Memories (best-effort — Quick Mode must work even when the cache is empty).
  let memoryBlock = '';
  try {
    const { memories } = await retrieveMemory({
      query: task,
      scope: 'general',
      agent: 'implementation',
      taskId: ctx.taskId,
      limit: 3,
    });
    if (memories.length > 0) {
      memoryBlock = memories
        .map((m) => `- (${m.scope}) ${m.title}: ${m.content}`)
        .join('\n');
    }
  } catch (err) {
    // Memory is best-effort; never block on it.
    console.warn('[agent] memory retrieval failed:', (err as Error).message);
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are the Ollopa Implementation agent in Quick Mode.',
        'You operate on a temporary copy of the user\'s workspace. All file modifications',
        'go through the provided tools; never assume a change is persisted until the user',
        'approves the final diff.',
        'Workflow: read files you need first, make focused edits with search_replace,',
        'then call check_git_diff before finishing. Stop when the change is complete.',
        memoryBlock ? `\nRelevant memories from prior tasks:\n${memoryBlock}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { role: 'user', content: task },
  ];

  const edits: SearchReplaceEdit[] = [];
  const fileSnapshots = new Map<string, string>(); // filePath → original content (from read_file)
  const MAX_TURNS = 12; // safety against infinite loops

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let result: ChatResult;
    try {
      result = await chatCompletion(messages, TOOL_DEFS);
    } catch (err) {
      const msg = (err as Error).message;
      ctx.send({ kind: 'task_error', taskId: ctx.taskId, error: msg });
      return edits;
    }

    const m = result.message;
    if (m.content) {
      ctx.send({ kind: 'agent_thought', taskId: ctx.taskId, message: m.content, agent: 'implementation' });
    }

    if (!m.tool_calls || m.tool_calls.length === 0) {
      // Model decided to stop.
      break;
    }

    // Multi-tool turn: process them one at a time. Each gets its own
    // tool_call/tool_output pair and we accumulate messages in order.
    for (const tc of m.tool_calls) {
      ctx.send({
        kind: 'tool_call',
        taskId: ctx.taskId,
        toolName: tc.name,
        toolArgs: tc.args,
      });

      // Remember the edit if this is a search_replace.
      if (tc.name === 'search_replace') {
        const a = tc.args as Partial<SearchReplaceEdit>;
        if (typeof a.filePath === 'string' && typeof a.old_str === 'string' && typeof a.new_str === 'string') {
          edits.push({ filePath: a.filePath, old_str: a.old_str, new_str: a.new_str });
        }
      }
      // Cache the file's original content if this is a read_file.
      if (tc.name === 'read_file') {
        const a = tc.args as { filePath?: string };
        if (a.filePath && !fileSnapshots.has(a.filePath)) {
          // The actual content comes back in the tool_output; we patch it
          // into the snapshot map there (the bridge tells us).
        }
      }

      let output: ToolOutputPayload;
      try {
        output = await ctx.awaiter.awaitToolOutput(ctx.taskId);
      } catch (err) {
        ctx.send({ kind: 'task_error', taskId: ctx.taskId, error: (err as Error).message });
        return edits;
      }

      // If the tool_output is from a read_file, capture the original content
      // so we can diff against it later without needing file system access.
      if (output.toolName === 'read_file' && output.kind === 'file') {
        try {
          // The extension host puts the file content in `output`; we store
          // it under the path that was in the tool call args.
          const filePath = (tc.args as { filePath?: string }).filePath;
          if (filePath) {
            fileSnapshots.set(filePath, output.output);
          }
        } catch { /* ignore — diffs will just lack originals */ }
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.name,
        content: output.output,
      });
    }
  }

  // 4. Build the final diff locally from recorded edits + snapshots. This is
  // a synthetic diff — it does not require the extension to roundtrip.
  // If we have snapshots for every edited file, we can replay; otherwise we
  // fall back to a coarse "edits recorded" message.
  const diff = synthesizeDiff(edits, fileSnapshots);
  if (diff) {
    ctx.send({ kind: 'task_final_diff', taskId: ctx.taskId, diff });
  }
  ctx.send({ kind: 'task_complete', taskId: ctx.taskId });
  return edits;
}

function synthesizeDiff(
  edits: SearchReplaceEdit[],
  snapshots: Map<string, string>,
): string {
  if (edits.length === 0) return '';

  // Group edits by file.
  const byFile = new Map<string, SearchReplaceEdit[]>();
  for (const e of edits) {
    const list = byFile.get(e.filePath) ?? [];
    list.push(e);
    byFile.set(e.filePath, list);
  }

  const out: string[] = [];
  for (const [filePath, fileEdits] of byFile) {
    const original = snapshots.get(filePath);
    if (original === undefined) {
      out.push(`# ${filePath}\n# (no original snapshot — diff not synthesizable from recorded edits alone)\n`);
      continue;
    }
    let current: string;
    try { current = replayEdits(original, fileEdits); }
    catch (err) {
      out.push(`# ${filePath}\n# error replaying edits: ${(err as Error).message}\n`);
      continue;
    }
    if (current === original) {
      out.push(`# ${filePath}\n# (no net change after replay)\n`);
      continue;
    }
    out.push(buildUnifiedDiff(filePath, original, current));
  }
  return out.join('\n');
}
