import { useEffect, useMemo, useRef, useState } from 'react';
import type { Inbound, Outbound, VsCodeApi } from './global';
import { PluginsPanel } from './PluginsPanel';
import { PrivacyBanner } from './PrivacyBanner';

type Tab = 'chat' | 'plugins';

export interface Msg {
  id: string;
  role: 'user' | 'sidecar' | 'system';
  text: string;
  ts: number;
}

export interface MemoryHit {
  id: string;
  title: string;
  content: string;
  scope: string;
  status: string;
  source: string;
  tags: string[];
  similarity: number;
  category: string | null;
  code_block: string | null;
  use_when: string[];
  avoid_when: string[];
}

interface ToolCallView {
  taskId: string;
  toolName: string;
  toolArgs: unknown;
  startedAt?: number;
  output?: { kind: 'terminal' | 'diff' | 'file' | 'error'; output: string };
  durationMs?: number;
}

interface Contract {
  goal: string;
  files: string[];
  risks: string[];
  suggestedRole: 'frontend' | 'backend' | 'implementation';
  steps: string[];
  scopeHash: string;
}

interface TaskView {
  taskId: string;
  status: 'running' | 'finished' | 'errored';
  mode: 'quick' | 'task';
  thoughts: string[];
  toolCalls: ToolCallView[];
  finalDiff?: string;
  errorMessage?: string;
  backend?: { kind: 'omniroute' | 'direct'; provider?: string; model: string; keyIndex?: number; keyTotal?: number };
  pendingPlan?: { contract: Contract; planText: string };
  lastReview?: { verdict: 'PASS' | 'FAIL'; violated: string[]; feedback: string };
  tokenTotals?: Record<string, number>;
}

interface ProviderStatus {
  forceDirect: boolean;
  omnirouteUp: boolean;
  omnirouteUrl: string | null;
  providerCount: number;
  /** Phase 8: per-pool state for the chip. */
  keyPools?: Array<{ provider: string; current: number; total: number; cooldownUntil?: number }>;
}

interface Props {
  vscode: VsCodeApi;
  initialMsgs: Msg[];
}

const SAMPLE_QUERY = {
  query: 'Express health endpoint',
  scope: 'backend',
  agent: 'test',
  taskId: 'phase2-smoke',
} as const;

type Mode = 'quick' | 'task';

export function App({ vscode, initialMsgs }: Props): JSX.Element {
  const [msgs, setMsgs] = useState<Msg[]>(initialMsgs);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'closed' | 'error'>('connecting');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('quick');
  const [memories, setMemories] = useState<MemoryHit[]>([]);
  const [memSource, setMemSource] = useState<'cloud' | 'cache' | null>(null);
  const [memLoading, setMemLoading] = useState(false);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [provider, setProvider] = useState<ProviderStatus>({ forceDirect: false, omnirouteUp: false, omnirouteUrl: null, providerCount: 0, keyPools: [] });
  const [privacy, setPrivacy] = useState<{ localOnly: boolean; redactSecrets: boolean }>({ localOnly: false, redactSecrets: true });
  const [commands, setCommands] = useState<Array<{ name: string; description: string }>>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'provider' | 'plugins' | 'skills' | 'privacy'>('provider');
  const idRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Phase 8: focus the prompt input when the extension sends `focus_prompt`
  // (e.g. via keybinding ctrl+shift+p from anywhere).
  const focusPrompt = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  useEffect(() => {
    const onInbound = (ev: Event) => {
      const detail = (ev as CustomEvent<Inbound>).detail;
      switch (detail.type) {
        case 'sidecar:ready':   setStatus('ready');   break;
        case 'sidecar:closed':  setStatus('closed');  break;
        case 'sidecar:error':   setStatus('error');   break;
        case 'chat:reply':      push('sidecar', detail.text); break;
        case 'memory_result':
          setMemLoading(false);
          setMemSource(detail.source);
          setMemories(detail.memories as MemoryHit[]);
          push('system', `[memory] ${detail.memories.length} hit(s) (${detail.source})`);
          break;
        case 'memory_error':
          setMemLoading(false);
          push('system', `[memory] error: ${detail.message}`);
          break;
        case 'task_started':
          upsertTask(detail.taskId, (t) => ({
            ...t,
            status: 'running',
            mode: modeRef.current,
            thoughts: [],
            toolCalls: [],
            pendingPlan: undefined,
            lastReview: undefined,
            errorMessage: undefined,
          }));
          break;
        case 'agent_thought':
          upsertTask(detail.taskId, (t) => ({ ...t, thoughts: [...t.thoughts, detail.message] }));
          break;
        case 'tool_call':
          upsertTask(detail.taskId, (t) => ({
            ...t,
            toolCalls: [...t.toolCalls, { taskId: detail.taskId, toolName: detail.toolName, toolArgs: detail.toolArgs, startedAt: detail.startedAt }],
          }));
          break;
        case 'tool_output':
          upsertTask(detail.taskId, (t) => {
            const calls = t.toolCalls.slice();
            for (let i = calls.length - 1; i >= 0; i--) {
              if (calls[i].toolName === detail.toolName && !calls[i].output) {
                calls[i] = { ...calls[i], output: { kind: detail.kind, output: detail.output }, durationMs: detail.durationMs };
                break;
              }
            }
            return { ...t, toolCalls: calls };
          });
          break;
        case 'task_final_diff':
          upsertTask(detail.taskId, (t) => ({ ...t, finalDiff: detail.diff }));
          break;
        case 'task_error':
          upsertTask(detail.taskId, (t) => ({ ...t, status: 'errored', errorMessage: detail.message }));
          push('system', `[task ${detail.taskId.slice(0, 8)}] error: ${detail.message}`);
          break;
        case 'task_complete':
          upsertTask(detail.taskId, (t) => ({ ...t, status: t.status === 'errored' ? t.status : 'finished' }));
          break;
        case 'task_applied':
          push('system', `[task ${detail.taskId.slice(0, 8)}] applied: ${detail.applied.join(', ') || '(no files)'}`);
          break;
        case 'task_rejected':
          push('system', `[task ${detail.taskId.slice(0, 8)}] rejected and discarded`);
          break;
        case 'plan_proposed':
          upsertTask(detail.taskId, (t) => ({
            ...t,
            pendingPlan: { contract: detail.contract, planText: detail.planText },
          }));
          break;
        case 'review_verdict':
          upsertTask(detail.taskId, (t) => ({
            ...t,
            lastReview: { verdict: detail.verdict, violated: detail.violated, feedback: detail.feedback },
          }));
          break;
        case 'provider_status':
          setProvider({
            forceDirect: detail.forceDirect,
            omnirouteUp: detail.omnirouteUp,
            omnirouteUrl: detail.omnirouteUrl,
            providerCount: detail.providerCount,
            keyPools: detail.keyPools ?? [],
          });
          break;
        case 'privacy_status':
          setPrivacy({ localOnly: detail.localOnly, redactSecrets: detail.redactSecrets });
          break;
        case 'task_backend':
          upsertTask(detail.taskId, (t) => ({ ...t, backend: detail.backend }));
          break;
        case 'task_token_total':
          upsertTask(detail.taskId, (t) => ({
            ...t,
            tokenTotals: { ...(t.tokenTotals ?? {}), [detail.agent]: detail.total },
          }));
          break;
        case 'focus_prompt':
          focusPrompt();
          break;
        case 'command_list':
          setCommands(detail.commands);
          break;
        case 'command_result':
          push('system', `[${detail.command}] ${detail.output}`);
          break;
      }
    };
    window.addEventListener('ollopa:inbound', onInbound as EventListener);
    return () => window.removeEventListener('ollopa:inbound', onInbound as EventListener);
  }, []);

  const push = (role: Msg['role'], t: string) => {
    setMsgs((prev) => [...prev, { id: `m${idRef.current++}`, role, text: t, ts: Date.now() }]);
  };

  // Mode ref so the inbound listener (registered once) sees the latest value
  // when task_started arrives.
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;

  function upsertTask(taskId: string, mut: (t: TaskView) => TaskView): void {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.taskId === taskId);
      if (idx === -1) {
        return [...prev, mut({ taskId, status: 'running', mode: modeRef.current, thoughts: [], toolCalls: [] })];
      }
      const copy = prev.slice();
      copy[idx] = mut(prev[idx]);
      return copy;
    });
  }

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    push('user', trimmed);
    if (trimmed.startsWith('/')) {
      const space = trimmed.indexOf(' ');
      const cmd = space === -1 ? trimmed.slice(1) : trimmed.slice(1, space);
      const args = space === -1 ? '' : trimmed.slice(space + 1);
      vscode.postMessage({ type: 'chat:command', command: cmd, args } satisfies Outbound);
      setText('');
      return;
    }
    vscode.postMessage({ type: 'chat:send', text: trimmed, mode } satisfies Outbound);
    setText('');
  };

  const refreshCommands = () => {
    vscode.postMessage({ type: 'list_commands' } satisfies Outbound);
    setShowHelp(true);
  };

  const acceptTask = (taskId: string) => {
    vscode.postMessage({ type: 'task_accept', taskId } satisfies Outbound);
  };
  const rejectTask = (taskId: string) => {
    vscode.postMessage({ type: 'task_reject', taskId } satisfies Outbound);
  };
  const planDecision = (taskId: string, decision: 'approve' | 'reject', comment?: string) => {
    vscode.postMessage({ type: 'plan_decision', taskId, decision, comment } satisfies Outbound);
  };

  const toggleForceDirect = () => {
    const next = !provider.forceDirect;
    setProvider({ ...provider, forceDirect: next });
    vscode.postMessage({ type: 'set_provider_mode', forceDirect: next } satisfies Outbound);
  };

  const providerChip = provider.forceDirect
    ? `Direct · ${provider.providerCount} provider${provider.providerCount === 1 ? '' : 's'}`
    : provider.omnirouteUp
      ? 'OmniRoute · auto'
      : provider.omnirouteUrl
        ? 'OmniRoute · down (fallback)'
        : 'No OmniRoute configured';

  const runMemoryTest = () => {
    setMemLoading(true);
    setMemories([]);
    setMemSource(null);
    push('system', `[memory] querying: "${SAMPLE_QUERY.query}"`);
    vscode.postMessage({ type: 'memory_query', ...SAMPLE_QUERY } satisfies Outbound);
  };

  return (
    <div className="app">
      <PrivacyBanner localOnly={privacy.localOnly} redactSecrets={privacy.redactSecrets} />
      <header className="app__header">
        <span className="app__title">Ollopa</span>
        <span
          className={`app__chip app__chip--${provider.forceDirect ? 'direct' : provider.omnirouteUp ? 'omniroute' : 'down'}`}
          title={provider.omnirouteUrl ?? 'No OmniRoute URL configured'}
        >
          {providerChip}
        </span>
        <span className={`app__status app__status--${status}`}>{status}</span>
        <nav className="app__tabs" aria-label="View">
          <button
            type="button"
            className={`app__tab ${tab === 'chat' ? 'app__tab--active' : ''}`}
            onClick={() => setTab('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            className={`app__tab ${tab === 'plugins' ? 'app__tab--active' : ''}`}
            onClick={() => setTab('plugins')}
          >
            Plugins
          </button>
          <button
            type="button"
            className="app__tab app__tab--icon"
            title="Settings"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
        </nav>
      </header>
      {tab === 'plugins'
        ? <PluginsPanel vscode={vscode} />
        : (<>
      <main className="app__stream" aria-live="polite">
        {msgs.length === 0 && tasks.length === 0 && !showHelp && (
          <p className="app__empty">Type a task and press Enter. The Implementation agent will work in a temp copy of your workspace; review the diff before applying. Type <code>/</code> for slash commands.</p>
        )}
        {showHelp && (
          <section className="help">
            <header className="help__head">
              <span>Slash commands</span>
              <button type="button" onClick={() => setShowHelp(false)}>×</button>
            </header>
            {commands.length === 0
              ? <p className="help__empty">No plugins loaded. Drop a <code>.js</code> file into <code>.ollopa/plugins/</code> or <code>~/.ollopa/plugins/</code> and restart the sidecar.</p>
              : commands.map((c) => (
                  <div key={c.name} className="help__cmd">
                    <code>/{c.name}</code>
                    <span>{c.description}</span>
                  </div>
                ))}
          </section>
        )}
        {msgs.map((m) => (
          <article key={m.id} className={`msg msg--${m.role}`}>
            <header className="msg__head">{m.role}</header>
            <p className="msg__body">{m.text}</p>
          </article>
        ))}
        {tasks.map((t) => (
          <TaskCard
            key={t.taskId}
            task={t}
            onAccept={acceptTask}
            onReject={rejectTask}
            onPlanDecision={planDecision}
          />
        ))}
        {memories.length > 0 && (
          <section className="mem">
            <header className="mem__head">
              <span>Memory hits</span>
              {memSource && <span className={`mem__src mem__src--${memSource}`}>{memSource}</span>}
            </header>
            {memories.map((m) => (
              <article key={m.id} className="mem__item">
                <header className="mem__title">
                  {m.title} <span className="mem__score">{(m.similarity ?? 0).toFixed(3)}</span>
                </header>
                <p className="mem__body">{m.content}</p>
                {m.tags.length > 0 && (
                  <p className="mem__tags">{m.tags.map((tg) => `#${tg}`).join(' ')}</p>
                )}
              </article>
            ))}
          </section>
        )}
      </main>
      <form
        className="app__input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="mode">
          <button
            type="button"
            className={`mode__btn ${mode === 'quick' ? 'mode__btn--active' : ''}`}
            onClick={() => setMode('quick')}
          >
            Quick
          </button>
          <button
            type="button"
            className={`mode__btn ${mode === 'task' ? 'mode__btn--active' : ''}`}
            onClick={() => setMode('task')}
            title="Task Mode (Phase 4): Architect → Approval → Worker → Review"
          >
            Task
          </button>
          <button
            type="button"
            className={`mode__btn ${provider.forceDirect ? 'mode__btn--active' : ''}`}
            onClick={toggleForceDirect}
            title="Toggle OmniRoute vs direct providers"
          >
            {provider.forceDirect ? 'Direct' : 'OmniRoute'}
          </button>
        </div>
        <input
          aria-label="Task"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'task'
            ? 'e.g. Add pagination to GET /users with limit/offset'
            : 'e.g. rename function foo to bar in src/utils.ts'}
          autoFocus
        />
        <button type="submit" disabled={!text.trim()}>Send</button>
        <button type="button" onClick={runMemoryTest} disabled={memLoading || status !== 'ready'}>
          {memLoading ? 'Querying…' : 'Test memory'}
        </button>
        <button type="button" onClick={refreshCommands} title="List installed slash commands">
          /
        </button>
      </form>
        </>)}
      {settingsOpen && (
        <SettingsModal
          provider={provider}
          onClose={() => setSettingsOpen(false)}
          activeTab={settingsTab}
          onTabChange={setSettingsTab}
          commands={commands}
          installedPlugins={[]}
          skills={[]}
          privacy={privacy}
          vscode={vscode}
        />
      )}
    </div>
  );
}

interface SettingsModalProps {
  provider: ProviderStatus;
  onClose: () => void;
  activeTab: 'provider' | 'plugins' | 'skills' | 'privacy';
  onTabChange: (t: 'provider' | 'plugins' | 'skills' | 'privacy') => void;
  commands: Array<{ name: string; description: string }>;
  installedPlugins: Array<{ id: string; name: string; version: string; source: string; integrity: string; installedAt: string }>;
  skills: Array<{ name: string; description: string; autoTrigger: boolean; prompt: string; origin: string }>;
  privacy: { localOnly: boolean; redactSecrets: boolean };
  vscode: VsCodeApi;
}

function SettingsModal({
  provider,
  onClose,
  activeTab,
  onTabChange,
  commands,
  installedPlugins,
  skills,
  privacy,
  vscode,
}: SettingsModalProps) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <span className="modal__title">Ollopa Settings</span>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal__body">
          <nav className="modal__tabs" aria-label="Settings sections">
            <button type="button" className={`modal__tab ${activeTab === 'provider' ? 'modal__tab--active' : ''}`} onClick={() => onTabChange('provider')}>Provider</button>
            <button type="button" className={`modal__tab ${activeTab === 'plugins' ? 'modal__tab--active' : ''}`} onClick={() => onTabChange('plugins')}>Plugins</button>
            <button type="button" className={`modal__tab ${activeTab === 'skills' ? 'modal__tab--active' : ''}`} onClick={() => onTabChange('skills')}>Skills</button>
            <button type="button" className={`modal__tab ${activeTab === 'privacy' ? 'modal__tab--active' : ''}`} onClick={() => onTabChange('privacy')}>Privacy</button>
          </nav>
          <section className="modal__pane">
            {activeTab === 'provider' && (
              <div className="cfg">
                <h3>Provider routing</h3>
                <p className="cfg__row">
                  <strong>Mode:</strong> {provider.forceDirect ? 'Direct providers' : provider.omnirouteUp ? 'OmniRoute (auto)' : 'OmniRoute (down — fallback)'}
                </p>
                <p className="cfg__row">
                  <strong>OmniRoute URL:</strong> <code>{provider.omnirouteUrl ?? '(none)'}</code>
                </p>
                <p className="cfg__row">
                  <strong>Direct providers enabled:</strong> {provider.providerCount}
                </p>
                <p className="cfg__hint">
                  Edit <code>ollopa.forceDirect</code>, <code>ollopa.omnirouteUrl</code>, and <code>ollopa.directProviders</code>{' '}
                  in VS Code Settings (Ctrl+,) or run <code>Ollopa: Configure</code> from the command palette to add API keys.
                </p>
              </div>
            )}
            {activeTab === 'plugins' && (
              <div className="cfg">
                <h3>Slash commands ({commands.length})</h3>
                {commands.length === 0 ? (
                  <p className="cfg__hint">No plugins loaded. Drop a <code>.js</code> file into <code>.ollopa/plugins/</code> or <code>~/.ollopa/plugins/</code> and restart the sidecar.</p>
                ) : (
                  <ul className="cfg__list">
                    {commands.map((c) => (
                      <li key={c.name}><code>/{c.name}</code> — {c.description}</li>
                    ))}
                  </ul>
                )}
                <h3>Installed plugins ({installedPlugins.length})</h3>
                <p className="cfg__hint">Plugin manager UI lives in the Plugins tab of the main view.</p>
              </div>
            )}
            {activeTab === 'skills' && (
              <div className="cfg">
                <h3>Skills ({skills.length})</h3>
                {skills.length === 0 ? (
                  <p className="cfg__hint">No skills installed. Use <code>Ollopa: Import Skill</code> from the command palette.</p>
                ) : (
                  <ul className="cfg__list">
                    {skills.map((s) => (
                      <li key={s.name}><strong>{s.name}</strong> — {s.description}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {activeTab === 'privacy' && (
              <div className="cfg">
                <h3>Privacy</h3>
                <p className="cfg__row"><strong>Local-only:</strong> {privacy.localOnly ? 'on' : 'off'}</p>
                <p className="cfg__row"><strong>Redact secrets:</strong> {privacy.redactSecrets ? 'on' : 'off'}</p>
                <p className="cfg__hint">
                  Toggle via <code>ollopa.privacy.localOnly</code> and <code>ollopa.privacy.redactSecrets</code>{' '}
                  in VS Code Settings.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  onAccept,
  onReject,
  onPlanDecision,
}: {
  task: TaskView;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onPlanDecision: (id: string, decision: 'approve' | 'reject', comment?: string) => void;
}): JSX.Element {
  return (
    <article className={`task task--${task.status}`}>
      <header className="task__head">
        <span>{task.mode === 'task' ? 'Task Mode' : 'Quick'} · <code>{task.taskId.slice(0, 8)}</code></span>
        {task.backend && (
          <span className={`task__backend task__backend--${task.backend.kind}`}>
            {task.backend.kind === 'omniroute'
              ? `OmniRoute · ${task.backend.model}`
              : `Direct · ${task.backend.provider ?? '?'}${task.backend.keyTotal && task.backend.keyTotal > 1
                  ? ` [${(task.backend.keyIndex ?? 0) + 1}/${task.backend.keyTotal}]`
                  : ''} · ${task.backend.model}`}
          </span>
        )}
        {task.tokenTotals && Object.keys(task.tokenTotals).length > 0 && (
          <span className="task__tokens" title="running token totals per agent">
            {Object.entries(task.tokenTotals)
              .map(([agent, n]) => `${agent} ${n}`)
              .join(' · ')}
          </span>
        )}
        <span className={`task__status task__status--${task.status}`}>{task.status}</span>
      </header>
      {task.pendingPlan && (
        <PlanApprovalCard
          taskId={task.taskId}
          contract={task.pendingPlan.contract}
          planText={task.pendingPlan.planText}
          onDecision={onPlanDecision}
        />
      )}
      {task.lastReview && (
        <ReviewVerdictCard review={task.lastReview} />
      )}
      {task.thoughts.map((t, i) => (
        <p key={i} className="task__thought">{t}</p>
      ))}
      {task.toolCalls.map((tc, i) => (
        <ToolCallCard key={i} call={tc} />
      ))}
      {task.finalDiff && <DiffCard diff={task.finalDiff} taskId={task.taskId} onAccept={onAccept} onReject={onReject} />}
      {task.errorMessage && <p className="task__error">{task.errorMessage}</p>}
    </article>
  );
}

function PlanApprovalCard({
  taskId,
  contract,
  planText,
  onDecision,
}: {
  taskId: string;
  contract: Contract;
  planText: string;
  onDecision: (id: string, decision: 'approve' | 'reject', comment?: string) => void;
}): JSX.Element {
  const [comment, setComment] = useState('');
  return (
    <section className="plan">
      <header className="plan__head">
        <span className="plan__title">Architect · plan awaiting approval</span>
        <code className="plan__hash">{contract.scopeHash}</code>
      </header>
      <p className="plan__summary">{planText}</p>
      <div className="plan__grid">
        <div className="plan__col">
          <h4>Goal</h4>
          <p>{contract.goal}</p>
        </div>
        <div className="plan__col">
          <h4>Role</h4>
          <p><code>{contract.suggestedRole}</code></p>
        </div>
      </div>
      <div className="plan__col">
        <h4>Files ({contract.files.length})</h4>
        <ul className="plan__files">
          {contract.files.length === 0
            ? <li><em>(no files)</em></li>
            : contract.files.map((f) => <li key={f}><code>{f}</code></li>)}
        </ul>
      </div>
      <div className="plan__col">
        <h4>Risks</h4>
        <ul className="plan__risks">
          {contract.risks.length === 0
            ? <li><em>(none flagged)</em></li>
            : contract.risks.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>
      <div className="plan__col">
        <h4>Steps</h4>
        <ol className="plan__steps">
          {contract.steps.length === 0
            ? <li><em>(no steps)</em></li>
            : contract.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </div>
      <div className="plan__feedback">
        <label htmlFor={`plan-comment-${taskId}`}>Feedback (sent to Architect on reject)</label>
        <textarea
          id={`plan-comment-${taskId}`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional — what should the architect change?"
          rows={3}
        />
      </div>
      <div className="plan__actions">
        <button
          type="button"
          className="plan__btn plan__btn--approve"
          onClick={() => onDecision(taskId, 'approve')}
        >
          Approve
        </button>
        <button
          type="button"
          className="plan__btn plan__btn--reject"
          onClick={() => onDecision(taskId, 'reject', comment || undefined)}
        >
          Reject &amp; replan
        </button>
      </div>
    </section>
  );
}

function ReviewVerdictCard({
  review,
}: {
  review: { verdict: 'PASS' | 'FAIL'; violated: string[]; feedback: string };
}): JSX.Element {
  return (
    <section className={`review review--${review.verdict.toLowerCase()}`}>
      <header className="review__head">
        <span>Review · {review.verdict}</span>
        {review.violated.length > 0 && (
          <span className="review__principles">
            {review.violated.map((p) => (
              <span key={p} className="review__principle">{p}</span>
            ))}
          </span>
        )}
      </header>
      <p className="review__feedback">{review.feedback}</p>
    </section>
  );
}

function ToolCallCard({ call }: { call: ToolCallView }): JSX.Element {
  const [open, setOpen] = useState(true);
  const dur = typeof call.durationMs === 'number'
    ? call.durationMs >= 1000 ? `${(call.durationMs / 1000).toFixed(1)}s` : `${call.durationMs}ms`
    : null;
  return (
    <details className="tool" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="tool__head">
        <span className="tool__name">{call.toolName}</span>
        {dur && <span className="tool__dur" title="wall-clock duration">{dur}</span>}
        {!call.output && <span className="tool__pending">…</span>}
      </summary>
      <div className="tool__body">
        <div className="tool__args">
          <header>args</header>
          <pre>{JSON.stringify(call.toolArgs, null, 2)}</pre>
        </div>
        {call.output && (
          <div className={`tool__out tool__out--${call.output.kind}`}>
            <header>{call.output.kind}</header>
            <pre>{call.output.output}</pre>
          </div>
        )}
      </div>
    </details>
  );
}

function DiffCard({ diff, taskId, onAccept, onReject }: { diff: string; taskId: string; onAccept: (id: string) => void; onReject: (id: string) => void }): JSX.Element {
  const lines = useMemo(() => diff.split('\n'), [diff]);
  return (
    <div className="diff">
      <header className="diff__head">
        <span>Final diff</span>
        <span className="diff__actions">
          <button type="button" className="diff__btn diff__btn--accept" onClick={() => onAccept(taskId)}>Apply</button>
          <button type="button" className="diff__btn diff__btn--reject" onClick={() => onReject(taskId)}>Reject</button>
        </span>
      </header>
      <pre className="diff__body">
        {lines.map((line, i) => (
          <DiffLine key={i} line={line} />
        ))}
      </pre>
    </div>
  );
}

function DiffLine({ line }: { line: string }): JSX.Element {
  let cls = 'diff__line';
  if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff__line--add';
  else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff__line--del';
  else if (line.startsWith('@@')) cls += ' diff__line--hunk';
  else if (line.startsWith('diff ') || line.startsWith('index ')) cls += ' diff__line--file';
  return <div className={cls}>{line || ' '}</div>;
}
