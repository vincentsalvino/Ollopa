import { useEffect, useRef, useState } from 'react';
import type { Inbound, Outbound, VsCodeApi } from './global';

export interface Msg {
  id: string;
  role: 'user' | 'sidecar' | 'system';
  text: string;
  ts: number;
}

interface Props {
  vscode: VsCodeApi;
  initialMsgs: Msg[];
}

export function App({ vscode, initialMsgs }: Props): JSX.Element {
  const [msgs, setMsgs] = useState<Msg[]>(initialMsgs);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'closed' | 'error'>('connecting');
  const [text, setText] = useState('');
  const idRef = useRef(0);

  useEffect(() => {
    const onInbound = (ev: Event) => {
      const detail = (ev as CustomEvent<Inbound>).detail;
      switch (detail.type) {
        case 'sidecar:ready':   setStatus('ready');   break;
        case 'sidecar:closed':  setStatus('closed');  break;
        case 'sidecar:error':   setStatus('error');   break;
        case 'chat:reply':      push('sidecar', detail.text); break;
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
      </form>
    </div>
  );
}
