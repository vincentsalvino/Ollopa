import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type Msg } from './App';
import type { Inbound, Outbound } from './global';
import './styles.css';

const vscode = window.acquireVsCodeApi();

function bootstrap(): void {
  const container = document.getElementById('root');
  if (!container) throw new Error('missing #root');
  const root = createRoot(container);
  const initialMsgs: Msg[] = [];

  root.render(<StrictMode><App vscode={vscode} initialMsgs={initialMsgs} /></StrictMode>);

  window.addEventListener('message', (ev: MessageEvent<Inbound>) => {
    // The host posts events on the global message channel. We re-emit on a
    // CustomEvent so React state can be updated without prop-drilling the raw
    // event object.
    window.dispatchEvent(new CustomEvent('ollopa:inbound', { detail: ev.data }));
  });
}

bootstrap();
