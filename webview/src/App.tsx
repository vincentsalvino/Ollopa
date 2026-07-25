import { useEffect, useMemo, useRef, useState } from 'react';
import type { Inbound, Outbound, VsCodeApi } from './global';

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
  output?: { kind: 'terminal' | 'diff' | 'file' | 'error'; output: string };
}

interface TaskView {
  taskId: string;
  status: 'running' | 'finished' | 'errored';
  thoughts: string[];
  toolCalls: ToolCallView[];
  finalDiff?: string;
  errorMessage?: string;
  backend?: { kind: 'omniroute' | 'direct'; provider?: string; model: string };
}

interface ProviderStatus {
  forceDirect: boolean;
  omnirouteUp: boolean;
  omnirouteUrl: string | null;
  providerCount: number;
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
  const [provider, setProvider] = useState<ProviderStatus>({ forceDirect: false, omnirouteUp: false, omnirouteUrl: null, providerCount: 0 });
  const [commands, setCommands] = useState<Array<{ name: string; description: string }>>([]);
  const [showHelp, setShowHelp] = useState(false);
  const idRef = useRef(0);

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
          upsertTask(detail.taskId, (t) => ({ ...t, status: 'running', thoughts: [], toolCalls: [] }));
          break;
        case 'agent_thought':
          upsertTask(detail.taskId, (t) => ({ ...t, thoughts: [...t.thoughts, detail.message] }));
          break;
        case 'tool_call':
          upsertTask(detail.taskId, (t) => ({
            ...t,
            toolCalls: [...t.toolCalls, { taskId: detail.taskId, toolName: detail.toolName, toolArgs: detail.toolArgs }],
          }));
          break;
        case 'tool_output':
          upsertTask(detail.taskId, (t) => {
            const calls = t.toolCalls.slice();
            for (let i = calls.length - 1; i >= 0; i--) {
              if (calls[i].toolName === detail.toolName && !calls[i].output) {
                calls[i] = { ...calls[i], output: { kind: detail.kind, output: detail.output } };
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
        case 'provider_status':
          setProvider({
            forceDirect: detail.forceDirect,
            omnirouteUp: detail.omnirouteUp,
            omnirouteUrl: detail.omnirouteUrl,
            providerCount: detail.providerCount,
          });
          break;
        case 'task_backend':
          upsertTask(detail.taskId, (t) => ({ ...t, backend: detail.backend }));
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

  function upsertTask(taskId: string, mut: (t: TaskView) => TaskView): void {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.taskId === taskId);
      if (idx === -1) {
        return [...prev, mut({ taskId, status: 'running', thoughts: [], toolCalls: [] })];
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
      // Slash command: parse `/name args…` and dispatch.
      const space = trimmed.indexOf(' ');
      const cmd = space === -1 ? trimmed.slice(1) : trimmed.slice(1, space);
      const args = space === -1 ? '' : trimmed.slice(space + 1);
      vscode.postMessage({ type: 'chat:command', command: cmd, args } satisfies Outbound);
      setText('');
      return;
    }
    if (mode === 'task') {
      push('system', '[task mode] not implemented in this build');
      return;
    }
    vscode.postMessage({ type: 'chat:send', text: trimmed, mode: 'quick' } satisfies Outbound);
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
      <header className="app__header">
        <span className="app__title">Ollopa</span>
        <span
          className={`app__chip app__chip--${provider.forceDirect ? 'direct' : provider.omnirouteUp ? 'omniroute' : 'down'}`}
          title={provider.omnirouteUrl ?? 'No OmniRoute URL configured'}
        >
          {providerChip}
        </span>
        <span className={`app__status app__status--${status}`}>{status}</span>
      </header>
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
          <TaskCard key={t.taskId} task={t} onAccept={acceptTask} onReject={rejectTask} />
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
            title="Task Mode is implemented in Phase 4"
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
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. rename function foo to bar in src/utils.ts"
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
    </div>
  );
}

function TaskCard({ task, onAccept, onReject }: { task: TaskView; onAccept: (id: string) => void; onReject: (id: string) => void }): JSX.Element {
  return (
    <article className={`task task--${task.status}`}>
      <header className="task__head">
        <span>Implementation · <code>{task.taskId.slice(0, 8)}</code></span>
        {task.backend && (
          <span className={`task__backend task__backend--${task.backend.kind}`}>
            {task.backend.kind === 'omniroute'
              ? `OmniRoute · ${task.backend.model}`
              : `Direct · ${task.backend.provider ?? '?'} · ${task.backend.model}`}
          </span>
        )}
        <span className={`task__status task__status--${task.status}`}>{task.status}</span>
      </header>
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

function ToolCallCard({ call }: { call: ToolCallView }): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <details className="tool" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="tool__head">
        <span className="tool__name">{call.toolName}</span>
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
