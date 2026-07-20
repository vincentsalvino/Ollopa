import { useEffect, useRef, useState } from 'react';
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

export function App({ vscode, initialMsgs }: Props): JSX.Element {
  const [msgs, setMsgs] = useState<Msg[]>(initialMsgs);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'closed' | 'error'>('connecting');
  const [text, setText] = useState('');
  const [memories, setMemories] = useState<MemoryHit[]>([]);
  const [memSource, setMemSource] = useState<'cloud' | 'cache' | null>(null);
  const [memLoading, setMemLoading] = useState(false);
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
      }
    };
    window.addEventListener('ollopa:inbound', onInbound as EventListener);
    return () => window.removeEventListener('ollopa:inbound', onInbound as EventListener);
  }, []);

  const push = (role: Msg['role'], t: string) => {
    setMsgs((prev) => [...prev, { id: `m${idRef.current++}`, role, text: t, ts: Date.now() }]);
  };

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    push('user', trimmed);
    vscode.postMessage({ type: 'chat:send', text: trimmed } satisfies Outbound);
    setText('');
  };

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
        <span className={`app__status app__status--${status}`}>{status}</span>
      </header>
      <main className="app__stream" aria-live="polite">
        {msgs.length === 0 && <p className="app__empty">Type a message and press Enter — the sidecar will echo it back.</p>}
        {msgs.map((m) => (
          <article key={m.id} className={`msg msg--${m.role}`}>
            <header className="msg__head">{m.role}</header>
            <p className="msg__body">{m.text}</p>
          </article>
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
                  <p className="mem__tags">{m.tags.map((t) => `#${t}`).join(' ')}</p>
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
        <input
          aria-label="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say something…"
          autoFocus
        />
        <button type="submit" disabled={!text.trim()}>Send</button>
        <button type="button" onClick={runMemoryTest} disabled={memLoading || status !== 'ready'}>
          {memLoading ? 'Querying…' : 'Test memory'}
        </button>
      </form>
    </div>
  );
}
