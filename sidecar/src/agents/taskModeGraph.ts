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
import { summariseToolOutput, trimMessagesToBudget, totalTokens } from './budget';
import { isCancelled } from '../concurrency';
import { classifyError, hintForKind, type ErrorKind } from './errorClassifier';
import { search as webSearchQuery, fetchUrl, lookupApi, lookupExample } from '../tools/webSearch';
import { checkWorkspaceLicenses, formatLicenseResults } from '../tools/licenseCheck';
import { loadPrivacyConfig } from '../privacy/privacy';
import { appendAudit, redactSecrets } from '../audit/auditLog';

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
  /** Critical (ERROR-severity) semgrep findings from the last review scan. */
  semgrepCritical: Annotation<string[]>({
    reducer: (_prev, y) => y,
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
  /** Phase 1.1A: classified error kind from the last failure. */
  lastErrorKind: Annotation<ErrorKind | null>({
    reducer: (_prev, y) => y,
    default: () => null,
  }),
  /** Phase 1.1A: rolling log of failure patterns (capped at 5) to avoid repeating mistakes. */
  failurePattern: Annotation<string[]>({
    reducer: (a, b) => a.concat(b).slice(-5),
    default: () => [],
  }),
  /**
   * Phase 8: step texts the worker has already executed on a prior attempt
   * (matched verbatim from `contract.steps`). Populated by the worker at
   * turn boundaries; read by the router on the next pass to skip steps
   * the architect marked as already proven via `riskMitigations`.
   */
  executedSteps: Annotation<string[]>({
    reducer: (a, b) => Array.from(new Set(a.concat(b))),
    default: () => [],
  }),
  /**
   * Phase 8: computed by the router. Steps to skip this attempt because
   * the prior attempt already produced them. Empty on the first pass.
   */
  skipSteps: Annotation<string[]>({
    reducer: (_prev, y) => y,
    default: () => [],
  }),
  /** Phase 5: security findings (secrets + license). Worker runs both after edits. */
  securityFindings: Annotation<{
    secrets: Array<{ file: string; line: number; kind: string; snippet: string }>;
    licenses: Array<{ package: string; license: string | null }>;
  }>({
    reducer: (_prev, y) => y,
    default: () => ({ secrets: [], licenses: [] }),
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
  /**
   * Phase 8: optional mapping from a risk string → the step index that
   * mitigates it. Used by the router to skip already-proven steps on
   * retry. LLM may omit; if absent, the router falls back to skipping
   * nothing.
   */
  riskMitigations?: Record<string, number>;
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
  | { kind: 'task_token_total'; taskId: string; agent: AgentRole; total: number }
  | { kind: 'tool_call'; taskId: string; toolName: string; toolArgs: Record<string, unknown>; startedAt: number }
  | { kind: 'tool_output'; taskId: string; toolName: string; output: string; outputKind: 'terminal' | 'diff' | 'file' | 'error'; durationMs?: number }
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
  'semgrep_scan',
  // Phase 1.1C
  'move_file',
  'batch_search_replace',
  'list_files',
  'run_tests',
  'secrets_scan',
  // Phase 3 — web tools run sidecar-side, NOT via the extension bridge.
  'web_search',
  'fetch_url',
  'lookup_api',
  'lookup_example',
  'license_check',
]);

// Tools that run sidecar-side and return a result inline, instead of
// round-tripping through the extension tool bridge. `BUILTIN_TOOLS` is
// a superset; the worker checks this set to decide which path to take.
const SIDECAR_LOCAL_TOOLS = new Set([
  'web_search',
  'fetch_url',
  'lookup_api',
  'lookup_example',
  'license_check',
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
  '  "steps": ["ordered list of concrete steps the worker must follow"],',
  '  "riskMitigations": { "<risk text>": <step index> } // optional; maps each risk to the step index that mitigates it. Omit if not useful."',
  '}',
  '',
  'Then append a separate `planText` line: a 2–3 sentence human summary of the plan.',
  'Format:',
  '---CONTRACT---',
  '{...the JSON object above...}',
  '---PLAN---',
  'the human-readable plan text',
  '',
  'REPLAN behaviour: when the user feedback lists UNCHANGED items, you may keep them as-is in `steps`.',
  'When the feedback asks for a change, rewrite ONLY the affected steps — do not regenerate unchanged ones verbatim.',
  'The router will skip steps already proven by a prior attempt when the contract has matching step text.',
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
    // Replan path. Surface the prior contract so the architect knows
    // what's already been planned and can emit only the changed steps.
    const prior = state.contract
      ? `\nPrior contract (re-emit only what changed; otherwise keep as-is):\n${JSON.stringify(state.contract, null, 2)}\n`
      : '';
    messages.push({
      role: 'user',
      content:
        `Original task:\n${state.userTask}\n\n` +
        `User feedback on the prior plan (must address this):\n${state.feedback}` +
        prior,
    });
  } else {
    messages.push({ role: 'user', content: state.userTask });
  }

  let result: ChatResult;
  try {
    result = await chatCompletionWithStats(ctx, state.taskId, 'architect', applyPrivacy(messages), []);
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
  // Phase 8: identify steps that have already been proven on a prior
  // attempt. A "proven" step is one whose text matches (case-insensitive
  // substring) a step that already executed and produced a snapshot in
  // this run. We pass this list down to the worker so it doesn't redo
  // work — but only when riskMitigations is present (otherwise the LLM
  // already chose to re-plan and we trust the new contract as-is).
  let skipSteps: string[] = [];
  if (state.contract?.riskMitigations && (state.executedSteps ?? []).length > 0) {
    const executed = new Set((state.executedSteps ?? []).map((s) => s.toLowerCase()));
    skipSteps = (state.contract.steps ?? []).filter((s) => executed.has(s.toLowerCase()));
  }
  return { workerRole: role, skipSteps };
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
    // Phase 1.1B: surface a targeted hint when we know what kind of error
    // caused the previous attempt to fail. Costs ~50 tokens, saves a blind re-run.
    state.lastErrorKind
      ? `\nPrevious attempt failed with kind="${state.lastErrorKind}". Targeted guidance:\n${hintForKind(state.lastErrorKind)}`
      : '',
    // Phase 1.1A: rolling log of prior failure snippets so the worker
    // does not retry the same broken pattern.
    (state.failurePattern ?? []).length > 0
      ? `\nRecent failure patterns (do NOT repeat):\n${(state.failurePattern ?? []).map((p) => `- ${p}`).join('\n')}`
      : '',
    // Phase 8: skip steps the router has already proven on a prior attempt.
    (state.skipSteps ?? []).length > 0
      ? `\nSteps already completed on a prior attempt (do NOT redo these):\n${(state.skipSteps ?? []).map((s) => `- ${s}`).join('\n')}`
      : '',
  ].filter(Boolean));

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
    if (isCancelled(state.taskId)) {
      return { status: 'cancelled', errorMessage: 'cancelled by host' };
    }
    let result: ChatResult;
    try {
      result = await chatCompletionWithStats(ctx, state.taskId, role, applyPrivacy(messages), toolDefs);
    } catch (err) {
      return { status: 'failed', errorMessage: `worker LLM failed: ${(err as Error).message}` };
    }
    const m = result.message;
    if (m.content) {
      ctx.send({ kind: 'agent_thought', taskId: state.taskId, message: m.content, agent: role });
    }
    if (!m.tool_calls || m.tool_calls.length === 0) break;

    for (const tc of m.tool_calls) {
      const toolStartedAt = Date.now();
      ctx.send({ kind: 'tool_call', taskId: state.taskId, toolName: tc.name, toolArgs: tc.args, startedAt: toolStartedAt });

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
        if (SIDECAR_LOCAL_TOOLS.has(tc.name)) {
          // Phase 3: web tools execute in the sidecar (outbound HTTP).
          // No temp workspace, no extension round-trip. Still emit a
          // tool_output event so the webview timeline shows the call.
          const text = await runSidecarLocalTool(tc.name, tc.args, state.workspaceRoot);
          output = { toolName: tc.name, output: text, kind: 'terminal' };
          ctx.send({
            kind: 'tool_output',
            taskId: state.taskId,
            toolName: tc.name,
            output: text,
            outputKind: 'terminal',
            durationMs: Date.now() - toolStartedAt,
          });
        } else if (BUILTIN_TOOLS.has(tc.name)) {
          output = await ctx.awaiter.awaitToolOutput(state.taskId);
        } else {
          output = await runPluginTool(tc.name, tc.args, ctx);
          ctx.send({
            kind: 'tool_output',
            taskId: state.taskId,
            toolName: output.toolName,
            output: output.output,
            outputKind: output.kind,
            durationMs: Date.now() - toolStartedAt,
          });
        }
      } catch (err) {
        const msg = `tool ${tc.name} failed: ${(err as Error).message}`;
        const kind = classifyError(msg);
        return {
          status: 'failed',
          errorMessage: msg,
          lastErrorKind: kind,
          failurePattern: [`${kind} via ${tc.name}`],
        };
      }

      if (BUILTIN_TOOLS.has(tc.name)) {
        await runHooks('after', { toolName: tc.name, args: tc.args, output: { toolName: output.toolName, output: output.output, kind: output.kind } });
      }

      if (output.toolName === 'read_file' && output.kind === 'file') {
        const fp = (tc.args as { filePath?: string }).filePath;
        if (fp) snapshots[fp] = output.output;
      }

      // Phase 8: token-aware compression of tool outputs before they go
      // back to the LLM. Diff / file outputs are kept verbatim (the agent
      // needs the full content); terminal / error outputs are summarised
      // when they exceed the budget.
      const summarised = (output.kind === 'diff' || output.kind === 'file')
        ? output.output
        : summariseToolOutput(output.output);
      messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: summarised });
    }
  }

  // Phase 8: enforce token budget after each worker turn. Drops oldest
  // non-system messages when total exceeds the budget.
  if (totalTokens(messages) > 8000) {
    const trimmed = trimMessagesToBudget(messages, 8000);
    // Replace the messages slice if anything was dropped.
    if (trimmed.length < messages.length) {
      messages.length = 0;
      messages.push(...trimmed);
    }
  }

  const diff = synthesiseDiff(edits, snapshots);
  // Phase 8: record the contract steps the worker actually executed this
  // attempt, so a future retry can skip them. Substring match against
  // step text keeps the mapping robust to minor LLM rewording.
  const allSteps = state.contract?.steps ?? [];
  const executed = allSteps.filter((s) => !(state.skipSteps ?? []).includes(s));
  return { edits, fileSnapshots: snapshots, finalDiff: diff, executedSteps: executed };
}

/* -------------------------------------------------------------------------- */
/*  Security scan (Phase 5)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Cheap pre-review security gate. Reads the worker's file snapshots,
 * runs secrets_scan over them, and runs license_check on the workspace
 * root. Returns any findings so the review node can include them.
 *
 * Ponytail: regex-only secrets scan (Phase 1 stub); `npm view` license
 * lookup. No semgrep here — review still owns that, and it's expensive.
 */
async function securityScanNode(
  state: TaskStateType,
  _runtime: { configurable?: Record<string, unknown> },
): Promise<Partial<TaskStateType>> {
  const secrets: Array<{ file: string; line: number; kind: string; snippet: string }> = [];
  // Inline regex sweep over snapshots — same patterns as extension's secrets_scan.
  const patterns = [
    { name: 'aws-access-key',    re: /AKIA[0-9A-Z]{16}/g },
    { name: 'github-pat',        re: /ghp_[A-Za-z0-9]{36}/g },
    { name: 'slack-token',       re: /xox[abp]-[0-9A-Za-z-]{10,}/g },
    { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
    { name: 'jwt',               re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  ];
  for (const [filePath, content] of Object.entries(state.fileSnapshots ?? {})) {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const { name, re } of patterns) {
        re.lastIndex = 0;
        if (re.test(lines[i])) {
          secrets.push({ file: filePath, line: i + 1, kind: name, snippet: lines[i].slice(0, 120) });
        }
      }
    }
  }
  // License check — only run if package.json is in scope.
  let licenses: Array<{ package: string; license: string | null }> = [];
  if (state.workspaceRoot) {
    try {
      const results = await checkWorkspaceLicenses(state.workspaceRoot);
      licenses = results.filter((r) => r.forbidden).map((r) => ({ package: r.package, license: r.license }));
    } catch { /* best-effort */ }
  }
  return {
    securityFindings: { secrets, licenses },
  };
}

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

  // Only allow review-only tools (no edits).
  const reviewToolDefs = TOOL_DEFS.filter((t) =>
    t.function.name === 'semgrep_scan' || t.function.name === 'check_git_diff'
  );

  // Up to 4 tool turns — enough for the reviewer to run semgrep + a re-read if needed.
  const MAX_REVIEW_TURNS = 4;
  const collectedSemgrepCritical: string[] = [];
  for (let turn = 0; turn < MAX_REVIEW_TURNS; turn++) {
    let result: ChatResult;
    try {
      result = await chatCompletionWithStats(ctx, state.taskId, 'review', applyPrivacy(messages), reviewToolDefs);
    } catch (err) {
      return { status: 'failed', errorMessage: `review LLM failed: ${(err as Error).message}` };
    }
    const m = result.message;
    if (m.content) {
      ctx.send({ kind: 'agent_thought', taskId: state.taskId, message: m.content, agent: 'review' });
    }
    if (!m.tool_calls || m.tool_calls.length === 0) break;

    for (const tc of m.tool_calls) {
      const toolStartedAt = Date.now();
      ctx.send({ kind: 'tool_call', taskId: state.taskId, toolName: tc.name, toolArgs: tc.args, startedAt: toolStartedAt });

      let output: ToolOutputPayload;
      try {
        output = await ctx.awaiter.awaitToolOutput(state.taskId);
      } catch (err) {
        return { status: 'failed', errorMessage: `review tool ${tc.name} failed: ${(err as Error).message}` };
      }

      // Parse semgrep critical findings from this turn's output.
      if (tc.name === 'semgrep_scan') {
        const m2 = output.output.match(/===SEMGREP_RESULT===\s*([\s\S]*)/);
        if (m2) {
          try {
            const parsed = JSON.parse(m2[1]);
            if (Array.isArray(parsed?.critical)) {
              for (const f of parsed.critical) {
                const id = `${f.check_id ?? 'unknown'}@${f.path ?? '?'}:${f.line ?? '?'}`;
                if (!collectedSemgrepCritical.includes(id)) collectedSemgrepCritical.push(id);
              }
            }
          } catch { /* malformed JSON — skip */ }
        }
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: output.output });
    }
  }

  // Phase 5: if the security scan already flagged secrets or forbidden
  // licenses in the worker's edits, short-circuit FAIL without asking
  // the reviewer LLM to also notice. Cheap, deterministic.
  const sf = state.securityFindings ?? { secrets: [], licenses: [] };
  if (sf.secrets.length > 0 || sf.licenses.length > 0) {
    const parts: string[] = [];
    if (sf.secrets.length > 0) {
      parts.push(`security scan found ${sf.secrets.length} secret-like pattern(s) in: ${sf.secrets.map((s) => `${s.file}:${s.line} (${s.kind})`).join(', ')}`);
    }
    if (sf.licenses.length > 0) {
      parts.push(`license check found ${sf.licenses.length} forbidden-licensed package(s): ${sf.licenses.map((l) => `${l.package} (${l.license ?? '?'})`).join(', ')}`);
    }
    const summary = parts.join('; ');
    ctx.send({
      kind: 'review_verdict',
      taskId: state.taskId,
      verdict: 'FAIL',
      violated: [],
      feedback: summary,
    });
    return {
      reviewVerdict: 'FAIL',
      violated: [],
      reviewFeedback: summary,
      semgrepCritical: [],
      securityFindings: sf,
    };
  }

  // If semgrep already flagged critical findings, short-circuit FAIL.
  if (collectedSemgrepCritical.length > 0) {
    const summary = `semgrep critical: ${collectedSemgrepCritical.length}`;
    ctx.send({
      kind: 'review_verdict',
      taskId: state.taskId,
      verdict: 'FAIL',
      violated: [],
      feedback: summary,
    });
    return {
      reviewVerdict: 'FAIL',
      violated: [],
      reviewFeedback: summary,
      semgrepCritical: collectedSemgrepCritical,
    };
  }

  // Final LLM verdict call (no tools — we just want the structured JSON).
  let verdictResult: ChatResult;
  try {
    verdictResult = await chatCompletionWithStats(ctx, state.taskId, 'review', applyPrivacy(messages), []);
  } catch (err) {
    return { status: 'failed', errorMessage: `review verdict LLM failed: ${(err as Error).message}` };
  }
  const verdictText = verdictResult.message.content ?? '';
  ctx.send({ kind: 'agent_thought', taskId: state.taskId, message: verdictText, agent: 'review' });

  const verdict = parseReviewOutput(verdictText);
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
      semgrepCritical: [],
      status: 'success',
    };
  }
  // Phase 1.1B: classify the review FAIL so the next worker retry can
  // read lastErrorKind and get a targeted hint. Semgrep criticals map
  // to their own kind; everything else is a generic review_fail.
  const kind: ErrorKind = collectedSemgrepCritical.length > 0
    ? 'semgrep_critical'
    : classifyError(verdict.feedback || 'review returned FAIL');
  return {
    reviewVerdict: 'FAIL',
    violated: verdict.violated,
    reviewFeedback: verdict.feedback,
    semgrepCritical: collectedSemgrepCritical,
    lastErrorKind: kind,
    failurePattern: [`${kind}: ${(verdict.feedback || '').slice(0, 120)}`],
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
  if ((state.semgrepCritical ?? []).length > 0) {
    // Persistent semgrep critical findings — never accept PASS, always retry.
    if ((state.retryCount ?? 0) >= 3) return 'final_fail';
    return 'worker_retry';
  }
  if (state.reviewVerdict === 'PASS') return 'success';
  if ((state.retryCount ?? 0) >= 3) return 'final_fail';
  return 'worker_retry';
}

async function bumpRetry(state: TaskStateType): Promise<Partial<TaskStateType>> {
  // Phase 1.1B: classify the failure that triggered the retry, so the
  // next worker invocation can read it via state.lastErrorKind and
  // append a targeted hint to its system prompt.
  const kind = classifyError(state.errorMessage ?? '');
  const errMsg = state.errorMessage ?? '';
  // Phase 1.1B: surface the first ESLint error line verbatim when we
  // recognise a lint failure. The worker sees this in the failurePattern
  // list, which is rendered at the top of its system prompt.
  const patterns = [`${kind}: ${errMsg.slice(0, 120)}`];
  if (kind === 'lint_fail') {
    const firstLine = errMsg.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
    if (firstLine) patterns.push(`FIRST ESLINT ERROR: ${firstLine.slice(0, 240)}`);
  }
  // Phase 1.1B: exponential backoff — 1s, 2s, 4s for retries 0,1,2.
  // Capped at 4s so a 3-retry cycle fits in ~7s. We only sleep when
  // the host isn't cancelling the task mid-retry.
  const retryN = state.retryCount ?? 0;
  const delayMs = Math.min(1000 * Math.pow(2, retryN), 4000);
  if (delayMs > 0 && !isCancelled(state.taskId)) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
  return {
    retryCount: retryN + 1,
    lastErrorKind: kind,
    failurePattern: patterns,
  };
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
    .addNode('security_scan', securityScanNode)
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
    .addEdge('worker', 'security_scan')
    .addEdge('security_scan', 'review')
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
    let riskMitigations: Record<string, number> | undefined;
    if (obj.riskMitigations && typeof obj.riskMitigations === 'object') {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj.riskMitigations as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[k] = v;
      }
      if (Object.keys(out).length > 0) riskMitigations = out;
    }
    const contract: Contract = {
      goal: obj.goal,
      files: obj.files.filter((s: unknown) => typeof s === 'string'),
      risks: Array.isArray(obj.risks) ? obj.risks.filter((s: unknown) => typeof s === 'string') : [],
      suggestedRole: role,
      steps: Array.isArray(obj.steps) ? obj.steps.filter((s: unknown) => typeof s === 'string') : [],
      riskMitigations,
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

/**
 * Phase 3: invoke a sidecar-local tool (outbound HTTP, no extension
 * round-trip) and return a plain-text result for the LLM.
 */
async function runSidecarLocalTool(name: string, args: Record<string, unknown>, workspaceRoot: string | null): Promise<string> {
  // Phase 6: localOnly blocks every outbound HTTP tool up front.
  const privacy = loadPrivacyConfig();
  if (privacy.localOnly && (name === 'web_search' || name === 'fetch_url' || name === 'lookup_api' || name === 'lookup_example')) {
    void appendAudit({ kind: 'network_blocked', source: name, detail: 'localOnly mode active' });
    return `[blocked: local-only mode is on. The tool '${name}' requires network access. Disable ollopa.privacy.localOnly to use it.]`;
  }
  switch (name) {
    case 'web_search': {
      const query = typeof args.query === 'string' ? args.query : '';
      const limit = typeof args.limit === 'number' ? args.limit : 5;
      const backend = typeof args.backend === 'string' ? args.backend : undefined;
      if (!query) return 'missing query';
      const results = await webSearchQuery(query, limit, backend);
      if (results.length === 0) return '(no results)';
      return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
    }
    case 'fetch_url': {
      const url = typeof args.url === 'string' ? args.url : '';
      const maxBytes = typeof args.maxBytes === 'number' ? args.maxBytes : undefined;
      if (!url) return 'missing url';
      return await fetchUrl(url, maxBytes);
    }
    case 'lookup_api': {
      const library = typeof args.library === 'string' ? args.library : '';
      const method = typeof args.method === 'string' ? args.method : '';
      if (!library || !method) return 'missing library/method';
      return await lookupApi(library, method);
    }
    case 'lookup_example': {
      const library = typeof args.library === 'string' ? args.library : '';
      const method = typeof args.method === 'string' ? args.method : '';
      if (!library || !method) return 'missing library/method';
      return await lookupExample(library, method);
    }
    case 'license_check': {
      const forbidden = Array.isArray(args.forbidden)
        ? (args.forbidden.filter((s) => typeof s === 'string') as string[])
        : undefined;
      if (forbidden && forbidden.length > 0) {
        // Override the default forbidden list just for this call.
        const prev = process.env.OLLOPA_FORBIDDEN_LICENSES;
        process.env.OLLOPA_FORBIDDEN_LICENSES = forbidden.join(',');
        try {
          if (!workspaceRoot) return 'no workspace root available';
          const r = await checkWorkspaceLicenses(workspaceRoot);
          return formatLicenseResults(r);
        } finally {
          if (prev === undefined) delete process.env.OLLOPA_FORBIDDEN_LICENSES;
          else process.env.OLLOPA_FORBIDDEN_LICENSES = prev;
        }
      }
      if (!workspaceRoot) return 'no workspace root available';
      const r = await checkWorkspaceLicenses(workspaceRoot);
      return formatLicenseResults(r);
    }
    default:
      return `unknown sidecar tool: ${name}`;
  }
}

/**
 * Phase 6: apply privacy redaction to messages before they go to the
 * LLM. Walks every message and replaces `content` with the redacted
 * version when `redactSecrets` is on. Returns the same array (mutates
 * in place — same shape `chatCompletion` already consumes).
 *
 * The audit log records how many bytes were masked so the user can
 * sanity-check that redaction is actually firing.
 */
function applyPrivacy(messages: ChatMessage[]): ChatMessage[] {
  const cfg = loadPrivacyConfig();
  if (!cfg.redactSecrets) return messages;
  let totalBytes = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string' && msg.content.length > 0) {
      const r = redactSecrets(msg.content);
      if (r.redactedCount > 0) {
        msg.content = r.text;
        totalBytes += r.redactedBytes;
      }
    }
  }
  if (totalBytes > 0) {
    void appendAudit({
      kind: 'payload_redacted',
      source: 'chatCompletion',
      redactedBytes: totalBytes,
      detail: `masked ${totalBytes} bytes across ${messages.length} message(s)`,
    });
  }
  return messages;
}

/**
 * Phase 8: wrap chatCompletion so the webview can show running token
 * totals in the header. Ponytail: fires a single side-channel event per
 * call; no LLM schema change. The total is the pre-call count of the
 * prompt we sent (good enough — exact usage isn't exposed by every
 * provider, and we don't want to add a parsing layer here).
 */
async function chatCompletionWithStats(
  ctx: NodeCtx,
  taskId: string,
  agent: AgentRole,
  messages: ChatMessage[],
  tools: ReturnType<typeof Array.prototype.slice> | import('../llm/chatClient').ToolDefinition[],
): Promise<ChatResult> {
  const sent = totalTokens(messages);
  ctx.send({ kind: 'task_token_total', taskId, agent, total: sent });
  return chatCompletion(messages, tools as import('../llm/chatClient').ToolDefinition[]);
}
