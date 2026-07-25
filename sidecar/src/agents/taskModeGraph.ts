/**
 * Task Mode — LangGraph state machine. Phase 4.
 *
 *   architect → humanApproval → router → worker → review
 *                       │                       │
 *                       │                       ├─ PASS → end
 *                       │                       └─ FAIL → (≤3 retries) worker
 *                       │                                  (>3 retries) end + capture
 *                       └─ reject w/ comment → architect (max 2 replans)
 *
 *   - `interrupt()` halts the graph at the approval node until the host
 *     sends a `plan_decision` resume payload via `Command({ resume: ... })`.
 *   - The Review node returns `verdict: 'PASS' | 'FAIL'` and a list of
 *     `violated` principles. The conditional edge routes accordingly.
 *   - Circuit breaker: `retryCount >= 3` ends the graph and triggers
 *     Mistake & Repair capture with principle attribution.
 *
 * Per task we get a fresh `CompiledStateGraph` (LangGraph compiles are
 * reusable but holding a separate instance per task keeps state clean).
 *
 * Per-node context (WS sink, tool awaiter, temp workspace path) is
 * passed via the `configurable` channel of the run config and read
 * inside each node — this is the v1.4 way of attaching side-channel
 * data to a graph.
 */
import { StateGraph, Annotation, START, END, interrupt, Command } from '@langchain/langgraph';
import { chatCompletion, type ChatMessage, type ChatResult } from '../llm/chatClient';
import { TOOL_DEFS } from '../tools/definitions';
import { retrieveMemory } from '../memory/memoryService';
import { getRegistry, runHooks, type PluginContext } from '../plugins/loader';
import { buildUnifiedDiff, replayEdits } from './diffSynth';
import {
  buildSystemPrompt,
  buildAuditPrompt,
  ALL_PRINCIPLES,
  type PrincipleId,
  type AgentRole,
} from './principles';
import { ToolAwaiter, type ToolOutputPayload } from './toolAwaiter';
import type { SearchReplaceEdit, AgentEvent } from './implementation';
import { captureMistake } from '../memory/mistakeCapture';

/* -------------------------------------------------------------------------- */
/*  State                                                                     */
/* -------------------------------------------------------------------------- */

export const TaskState = Annotation.Root({
  taskId: Annotation<string>(),
  userTask: Annotation<string>(),
  workspaceRoot: Annotation<string>(),
  tempWorkspace: Annotation<string | null>({
    reducer: (_prev, y) => y,
    default: () => null,
  }),
  /** Chat messages appended by the LLM/tool loop. */
  messages: Annotation<ChatMessage[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  /** Output of the architect node: a parsed .contract.json. */
  contract: Annotation<Contract | null>({
    reducer: (_prev, y) => y,
    default: () => null,
  }),
  /** Plain-text plan the user sees in the approval modal. */
  planText: Annotation<string>({
    reducer: (_prev, y) => y,
    default: () => '',
  }),
  /** Approval feedback from the user; '' on first pass. */
  feedback: Annotation<string>({
    reducer: (_prev, y) => y,
    default: () => '',
  }),
  /** Number of times the architect re-planned after rejection. */
  replanCount: Annotation<number>({
    reducer: (_prev, y) => y,
    default: () => 0,
  }),
  /** Number of times the worker re-ran after a FAIL. */
  retryCount: Annotation<number>({
    reducer: (_prev, y) => y,
    default: () => 0,
  }),
  /** Selected worker role. */
  workerRole: Annotation<AgentRole | null>({
    reducer: (_prev, y) => y,
    default: () => null,
  }),
  /** Recorded edits (search_replace) for diff synthesis. */
  edits: Annotation<SearchReplaceEdit[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  /** Per-file original content captured by read_file. */
  fileSnapshots: Annotation<Record<string, string>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  /** Final diff string (synthesised on PASS). */
  finalDiff: Annotation<string>({
    reducer: (_prev, y) => y,
    default: () => '',
  }),
  /** Review outcome. */
  reviewVerdict: Annotation<'PASS' | 'FAIL' | null>({
    reducer: (_prev, y) => y,
    default: () => null,
  }),
  /** Principles the review flagged. */
  violated: Annotation<PrincipleId[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  /** Review feedback string. */
  reviewFeedback: Annotation<string>({
    reducer: (_prev, y) => y,
    default: () => '',
  }),
  /** Final task status. */
  status: Annotation<'running' | 'success' | 'failed' | 'cancelled'>({
    reducer: (_prev, y) => y,
    default: () => 'running',
  }),
  /** Last error message, if any. */
  errorMessage: Annotation<string>({
    reducer: (_prev, y) => y,
    default: () => '',
  }),
});

export type TaskStateType = typeof TaskState.State;

/* -------------------------------------------------------------------------- */
/*  Contract shape                                                            */
/* -------------------------------------------------------------------------- */

export interface Contract {
  goal: string;
  files: string[];
  risks: string[];
  suggestedRole: AgentRole;
  steps: string[];
  scopeHash: string;
}

/* -------------------------------------------------------------------------- */
/*  Per-node context (carried via configurable channel)                       */
/* -------------------------------------------------------------------------- */

export interface NodeCtx {
  taskId: string;
  send: (event: AgentEvent | TaskEvent) => void;
  awaiter: ToolAwaiter;
  tempWorkspace: string | null;
}

export type TaskEvent =
  | { kind: 'plan_proposed'; taskId: string; contract: Contract; planText: string; agent: 'architect' }
  | { kind: 'task_started'; taskId: string }
  | { kind: 'agent_thought'; taskId: string; message: string; agent: AgentRole }
  | { kind: 'tool_call'; taskId: string; toolName: string; toolArgs: Record<string, unknown> }
  | { kind: 'tool_output'; taskId: string; toolName: string; output: string; outputKind: 'terminal' | 'diff' | 'file' | 'error' }
  | { kind: 'task_final_diff'; taskId: string; diff: string }
  | { kind: 'task_complete'; taskId: string; status: 'success' | 'failed' | 'cancelled' }
  | { kind: 'task_error'; taskId: string; error: string }
  | { kind: 'review_verdict'; taskId: string; verdict: 'PASS' | 'FAIL'; violated: PrincipleId[]; feedback: string };

/* -------------------------------------------------------------------------- */
/*  Built-in tool set                                                         */
/* -------------------------------------------------------------------------- */

const BUILTIN_TOOLS = new Set([
  'search_replace',
  'read_file',
  'execute_safe_bash',
  'run_lint',
  'check_git_diff',
]);

/* -------------------------------------------------------------------------- */
/*  Runtime helper — fetch the NodeCtx out of the configurable channel        */
/* -------------------------------------------------------------------------- */

function ctxFromRuntime(runtime: { configurable?: Record<string, unknown> }): NodeCtx {
  const c = (runtime.configurable ?? {}) as { nodeCtx?: NodeCtx };
  if (!c.nodeCtx) {
    // Fallback no-op ctx. Should never happen when invoked via `runTaskMode`.
    return { taskId: 'unknown', send: () => { /* noop */ }, awaiter: new ToolAwaiter(), tempWorkspace: null };
  }
  return c.nodeCtx;
}

/* -------------------------------------------------------------------------- */
/*  Architect                                                                 */
/* -------------------------------------------------------------------------- */

const architectSystem = [
  'You are the Ollopa Architect.',
  'Your job: plan the change, decide which files to touch, suggest the worker role,',
  'and emit a contract as STRICT JSON. Never write code. Never call tools that modify files.',
  '',
  'Output a single JSON object — no prose, no markdown fences — with this shape:',
  '{',
  '  "goal": "one-sentence description of the change",',
  '  "files": ["list of files the worker will touch, relative to workspace root"],',
  '  "risks": ["non-empty list of risks the worker must mitigate"],',
  '  "suggestedRole": "frontend" | "backend" | "implementation",',
  '  "steps": ["ordered list of concrete steps the worker must follow"]',
  '}',
  '',
  'Then append a separate `planText` line: a 2–3 sentence human summary of the plan.',
  'Format:',
  '---CONTRACT---',
  '{...the JSON object above...}',
  '---PLAN---',
  'the human-readable plan text',
].join('\n');

async function architectNode(
  state: TaskStateType,
  runtime: { configurable?: Record<string, unknown> },
): Promise<Partial<TaskStateType>> {
  const ctx = ctxFromRuntime(runtime);
  const mems = await retrieveMemorySafe(state.userTask, 'architecture', 'architect', state.taskId);
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt('architect', [architectSystem, mems]) },
  ];
  if (state.feedback) {
    messages.push({
      role: 'user',
      content: `Original task:\n${state.userTask}\n\nUser feedback on the prior plan (must address this):\n${state.feedback}`,
    });
  } else {
    messages.push({ role: 'user', content: state.userTask });
  }

  let result: ChatResult;
  try {
    result = await chatCompletion(messages, []); // no tools — architect reasons only
  } catch (err) {
    return { status: 'failed', errorMessage: `architect LLM failed: ${(err as Error).message}` };
  }
  const text = result.message.content ?? '';
  ctx.send({ kind: 'agent_thought', taskId: state.taskId, message: text, agent: 'architect' });

  const parsed = parseArchitectOutput(text);
  if (!parsed) {
    return { status: 'failed', errorMessage: 'architect did not emit a parseable contract' };
  }
  parsed.contract.scopeHash = computeScopeHash(parsed.contract.files);

  ctx.send({ kind: 'plan_proposed', taskId: state.taskId, contract: parsed.contract, planText: parsed.planText, agent: 'architect' });

  return { contract: parsed.contract, planText: parsed.planText };
}

/* -------------------------------------------------------------------------- */
/*  Human approval — pauses the graph                                         */
/* -------------------------------------------------------------------------- */

export interface ApprovalDecision {
  decision: 'approve' | 'reject';
  comment?: string;
}

function humanApprovalNode(
  state: TaskStateType,
  _runtime: { configurable?: Record<string, unknown> },
): Command | Partial<TaskStateType> {
  if (!state.contract) {
    return { status: 'failed', errorMessage: 'humanApproval reached without a contract' };
  }

  const decision = interrupt({
    taskId: state.taskId,
    contract: state.contract,
    planText: state.planText,
  }) as ApprovalDecision;

  if (decision?.decision === 'approve') {
    return new Command({ goto: 'router', update: { feedback: '' } });
  }
  if (decision?.decision === 'reject') {
    return new Command({
      goto: 'architect',
      update: {
        feedback: decision.comment ?? 'rejected without comment',
        replanCount: (state.replanCount ?? 0) + 1,
      },
    });
  }
  return { status: 'cancelled', errorMessage: 'approval cancelled' };
}

/* -------------------------------------------------------------------------- */
/*  Router                                                                    */
/* -------------------------------------------------------------------------- */

function routerNode(state: TaskStateType): Partial<TaskStateType> {
  const role = state.contract?.suggestedRole ?? 'implementation';
  return { workerRole: role };
}

/* -------------------------------------------------------------------------- */
/*  Worker                                                                    */
/* -------------------------------------------------------------------------- */

async function workerNode(
  state: TaskStateType,
  runtime: { configurable?: Record<string, unknown> },
): Promise<Partial<TaskStateType>> {
  const ctx = ctxFromRuntime(runtime);
  const role = state.workerRole ?? 'implementation';
  const system = buildSystemPrompt(role, [
    'You are running inside a LangGraph Task Mode pipeline. Follow the contract exactly.',
    'If the review feedback is non-empty, address it before adding anything new.',
    state.contract ? `\nContract:\n${JSON.stringify(state.contract, null, 2)}` : '',
    state.reviewFeedback ? `\nReview feedback from previous attempt:\n${state.reviewFeedback}` : '',
  ]);

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: state.userTask },
  ];

  const toolDefs = [
    ...TOOL_DEFS,
    ...Array.from(getRegistry().tools.values()).map((e) => ({
      type: 'function' as const,
      function: e.tool.definition,
    })),
  ];

  const edits: SearchReplaceEdit[] = [];
  const snapshots: Record<string, string> = {};
  const MAX_TURNS = 12;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let result: ChatResult;
    try {
      result = await chatCompletion(messages, toolDefs);
    } catch (err) {
      return { status: 'failed', errorMessage: `worker LLM failed: ${(err as Error).message}` };
    }
    const m = result.message;
    if (m.content) {
      ctx.send({ kind: 'agent_thought', taskId: state.taskId, message: m.content, agent: role });
    }
    if (!m.tool_calls || m.tool_calls.length === 0) break;

    for (const tc of m.tool_calls) {
      ctx.send({ kind: 'tool_call', taskId: state.taskId, toolName: tc.name, toolArgs: tc.args });

      if (BUILTIN_TOOLS.has(tc.name)) {
        await runHooks('before', { toolName: tc.name, args: tc.args });
        if (tc.name === 'search_replace') {
          const a = tc.args as Partial<SearchReplaceEdit>;
          if (typeof a.filePath === 'string' && typeof a.old_str === 'string' && typeof a.new_str === 'string') {
            edits.push({ filePath: a.filePath, old_str: a.old_str, new_str: a.new_str });
          }
        }
      }

      let output: ToolOutputPayload;
      try {
        if (BUILTIN_TOOLS.has(tc.name)) {
          output = await ctx.awaiter.awaitToolOutput(state.taskId);
        } else {
          output = await runPluginTool(tc.name, tc.args, ctx);
          ctx.send({
            kind: 'tool_output',
            taskId: state.taskId,
            toolName: output.toolName,
            output: output.output,
            outputKind: output.kind,
          });
        }
      } catch (err) {
        return { status: 'failed', errorMessage: `tool ${tc.name} failed: ${(err as Error).message}` };
      }

      if (BUILTIN_TOOLS.has(tc.name)) {
        await runHooks('after', { toolName: tc.name, args: tc.args, output: { toolName: output.toolName, output: output.output, kind: output.kind } });
      }

      if (output.toolName === 'read_file' && output.kind === 'file') {
        const fp = (tc.args as { filePath?: string }).filePath;
        if (fp) snapshots[fp] = output.output;
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: output.output });
    }
  }

  const diff = synthesiseDiff(edits, snapshots);
  return { edits, fileSnapshots: snapshots, finalDiff: diff };
}

/* -------------------------------------------------------------------------- */
/*  Review                                                                    */
/* -------------------------------------------------------------------------- */

interface ReviewVerdict {
  verdict: 'PASS' | 'FAIL';
  violated: PrincipleId[];
  feedback: string;
  semgrepCritical: string[];
}

async function reviewNode(
  state: TaskStateType,
  runtime: { configurable?: Record<string, unknown> },
): Promise<Partial<TaskStateType>> {
  const ctx = ctxFromRuntime(runtime);
  const ruleMems = await retrieveMemorySafe(state.userTask, 'architecture', 'review', state.taskId);
  const system = buildSystemPrompt('review', [buildAuditPrompt(), ruleMems]);

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        `Task: ${state.userTask}`,
        state.contract ? `Contract:\n${JSON.stringify(state.contract, null, 2)}` : '',
        state.finalDiff ? `\nDiff:\n${truncate(state.finalDiff, 6000)}` : '(no diff produced)',
        '\nReturn the strict JSON verdict object only.',
      ].filter(Boolean).join('\n'),
    },
  ];

  let result: ChatResult;
  try {
    result = await chatCompletion(messages, []);
  } catch (err) {
    return { status: 'failed', errorMessage: `review LLM failed: ${(err as Error).message}` };
  }
  ctx.send({ kind: 'agent_thought', taskId: state.taskId, message: result.message.content ?? '', agent: 'review' });

  const verdict = parseReviewOutput(result.message.content ?? '');
  if (!verdict) {
    return { status: 'failed', errorMessage: 'review agent did not return parseable JSON' };
  }

  ctx.send({
    kind: 'review_verdict',
    taskId: state.taskId,
    verdict: verdict.verdict,
    violated: verdict.violated,
    feedback: verdict.feedback,
  });

  if (verdict.verdict === 'PASS') {
    return {
      reviewVerdict: 'PASS',
      violated: [],
      reviewFeedback: verdict.feedback,
      status: 'success',
    };
  }
  return {
    reviewVerdict: 'FAIL',
    violated: verdict.violated,
    reviewFeedback: verdict.feedback,
  };
}

/* -------------------------------------------------------------------------- */
/*  Conditional edges                                                         */
/* -------------------------------------------------------------------------- */

function afterArchitect(state: TaskStateType): 'human_approval' | 'fail' {
  return state.status === 'failed' || state.status === 'cancelled' ? 'fail' : 'human_approval';
}

function afterApproval(state: TaskStateType): 'router' | 'architect' | 'cancelled' {
  if (state.status === 'cancelled' || state.status === 'failed') return 'cancelled';
  if ((state.replanCount ?? 0) > 2) return 'cancelled';
  return 'router';
}

function afterReview(state: TaskStateType): 'success' | 'worker_retry' | 'final_fail' {
  if (state.status === 'failed' || state.status === 'cancelled') return 'final_fail';
  if (state.reviewVerdict === 'PASS') return 'success';
  if ((state.retryCount ?? 0) >= 3) return 'final_fail';
  return 'worker_retry';
}

function bumpRetry(state: TaskStateType): Partial<TaskStateType> {
  return { retryCount: (state.retryCount ?? 0) + 1 };
}

async function captureFinalFail(
  state: TaskStateType,
  _runtime: { configurable?: Record<string, unknown> },
): Promise<Partial<TaskStateType>> {
  void captureMistake({
    taskId: state.taskId,
    task: state.userTask,
    badDiff: state.finalDiff ?? '',
    reviewFeedback: state.reviewFeedback,
    violatedPrinciples: state.violated ?? [],
    retryCount: state.retryCount ?? 0,
  });
  return { status: 'failed' };
}

/* -------------------------------------------------------------------------- */
/*  Build the graph                                                           */
/* -------------------------------------------------------------------------- */

export function buildTaskGraph() {
  const graph = new StateGraph(TaskState)
    .addNode('architect', architectNode)
    .addNode('human_approval', humanApprovalNode)
    .addNode('router', routerNode)
    .addNode('worker', workerNode)
    .addNode('review', reviewNode)
    .addNode('worker_retry', bumpRetry)
    .addNode('final_fail', captureFinalFail)
    .addNode('success', () => ({ status: 'success' as const }))
    .addNode('fail', () => ({ status: 'failed' as const }))
    .addNode('cancelled', () => ({ status: 'cancelled' as const }))
    .addEdge(START, 'architect')
    .addConditionalEdges('architect', afterArchitect, { human_approval: 'human_approval', fail: 'fail' })
    .addConditionalEdges('human_approval', afterApproval, { router: 'router', architect: 'architect', cancelled: 'cancelled' })
    .addEdge('router', 'worker')
    .addEdge('worker', 'review')
    .addConditionalEdges('review', afterReview, { success: 'success', worker_retry: 'worker_retry', final_fail: 'final_fail' })
    .addEdge('worker_retry', 'worker')
    .addEdge('success', END)
    .addEdge('fail', END)
    .addEdge('cancelled', END)
    .addEdge('final_fail', END);

  return graph.compile();
}

/* -------------------------------------------------------------------------- */
/*  Run wrapper — fires the graph with NodeCtx attached                       */
/* -------------------------------------------------------------------------- */

export interface TaskRunInput {
  taskId: string;
  userTask: string;
  workspaceRoot: string;
  tempWorkspace: string | null;
}

/**
 * Run a task end-to-end. The graph is invoked with the `configurable`
 * channel carrying the per-task NodeCtx. On `interrupt()` (human
 * approval), the function throws an `Interruption` error which the
 * host catches and resumes with a `Command({ resume })`.
 */
export async function runTaskMode(
  input: TaskRunInput,
  ctx: NodeCtx,
  decision?: ApprovalDecision | null,
): Promise<TaskStateType> {
  const app = buildTaskGraph();
  const config = {
    configurable: { nodeCtx: ctx },
  } as Parameters<typeof app.invoke>[1];
  const initial = {
    taskId: input.taskId,
    userTask: input.userTask,
    workspaceRoot: input.workspaceRoot,
    tempWorkspace: input.tempWorkspace,
  };
  // Resume from interrupt with a decision; otherwise kick off fresh.
  return app.invoke(
    decision ? (new Command({ resume: decision }) as unknown as typeof initial) : (initial as typeof initial),
    config,
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

async function retrieveMemorySafe(
  query: string,
  scope: string,
  agent: string,
  taskId: string,
): Promise<string> {
  try {
    const { memories } = await retrieveMemory({
      query,
      scope,
      agent,
      taskId,
      limit: 3,
    });
    if (memories.length === 0) return '';
    return memories.map((m) => `- (${m.scope}) ${m.title}: ${m.content}`).join('\n');
  } catch (err) {
    console.warn('[task-mode] memory retrieval failed:', (err as Error).message);
    return '';
  }
}

function parseArchitectOutput(text: string): { planText: string; contract: Contract } | null {
  const m = text.match(/---CONTRACT---\s*([\s\S]*?)\s*---PLAN---\s*([\s\S]*?)$/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    if (!obj || typeof obj !== 'object' || typeof obj.goal !== 'string' || !Array.isArray(obj.files)) {
      return null;
    }
    const role: AgentRole =
      obj.suggestedRole === 'frontend' || obj.suggestedRole === 'backend' || obj.suggestedRole === 'implementation'
        ? obj.suggestedRole
        : 'implementation';
    const contract: Contract = {
      goal: obj.goal,
      files: obj.files.filter((s: unknown) => typeof s === 'string'),
      risks: Array.isArray(obj.risks) ? obj.risks.filter((s: unknown) => typeof s === 'string') : [],
      suggestedRole: role,
      steps: Array.isArray(obj.steps) ? obj.steps.filter((s: unknown) => typeof s === 'string') : [],
      scopeHash: '',
    };
    return { planText: m[2].trim(), contract };
  } catch {
    return null;
  }
}

function parseReviewOutput(text: string): ReviewVerdict | null {
  const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(stripped.slice(start, end + 1));
    if (obj?.verdict !== 'PASS' && obj?.verdict !== 'FAIL') return null;
    const violatedRaw = Array.isArray(obj.violated) ? obj.violated : [];
    const violated = violatedRaw
      .filter((v: unknown) => typeof v === 'string')
      .map((v: string) => v as PrincipleId)
      .filter((v: PrincipleId) => ALL_PRINCIPLES.includes(v));
    const semgrepCritical = Array.isArray(obj.semgrep_critical)
      ? obj.semgrep_critical.filter((s: unknown) => typeof s === 'string')
      : [];
    return {
      verdict: obj.verdict,
      violated,
      feedback: typeof obj.feedback === 'string' ? obj.feedback.slice(0, 1000) : '',
      semgrepCritical,
    };
  } catch {
    return null;
  }
}

function computeScopeHash(files: string[]): string {
  const sorted = files.slice().sort();
  let h = 0;
  for (const f of sorted) {
    for (let i = 0; i < f.length; i++) h = (h * 31 + f.charCodeAt(i)) | 0;
  }
  return `ollopa-scope-${(h >>> 0).toString(16)}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…(truncated, ${s.length - max} more chars)`;
}

function synthesiseDiff(
  edits: SearchReplaceEdit[],
  snapshots: Record<string, string>,
): string {
  if (edits.length === 0) return '';
  const byFile = new Map<string, SearchReplaceEdit[]>();
  for (const e of edits) {
    const list = byFile.get(e.filePath) ?? [];
    list.push(e);
    byFile.set(e.filePath, list);
  }
  const out: string[] = [];
  for (const [filePath, fileEdits] of byFile) {
    const original = snapshots[filePath];
    if (original === undefined) {
      out.push(`# ${filePath}\n# (no original snapshot — diff not synthesizable)\n`);
      continue;
    }
    let current: string;
    try { current = replayEdits(original, fileEdits); }
    catch (err) {
      out.push(`# ${filePath}\n# error: ${(err as Error).message}\n`);
      continue;
    }
    if (current === original) {
      out.push(`# ${filePath}\n# (no net change)\n`);
      continue;
    }
    out.push(buildUnifiedDiff(filePath, original, current));
  }
  return out.join('\n');
}

async function runPluginTool(
  name: string,
  args: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<ToolOutputPayload> {
  const entry = getRegistry().tools.get(name);
  if (!entry) return { toolName: name, output: `unknown plugin tool: ${name}`, kind: 'error' };
  const plugCtx: PluginContext = {
    tempWorkspaceRoot: ctx.tempWorkspace,
    retrieveMemory: async () => [],
  };
  try {
    const r = await entry.tool.handler(args, plugCtx);
    const kind: ToolOutputPayload['kind'] =
      r.kind === 'diff' || r.kind === 'file' || r.kind === 'error' || r.kind === 'terminal' ? r.kind : 'terminal';
    return { toolName: name, output: r.output, kind };
  } catch (err) {
    return { toolName: name, output: `plugin tool failed: ${(err as Error).message}`, kind: 'error' };
  }
}
