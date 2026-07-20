/// <reference types="vite/client" />

declare global {
  interface Window {
    // Provided by VS Code when running inside a webview.
    // https://code.visualstudio.com/api/extension-guides/webview#passing-messages-from-a-webview-to-an-extension
    acquireVsCodeApi: () => VsCodeApi;
  }
}

export interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

export type Inbound =
  | { type: 'sidecar:ready' }
  | { type: 'sidecar:closed' }
  | { type: 'sidecar:error'; message: string }
  | { type: 'chat:reply'; text: string; from: 'sidecar' }
  | { type: 'memory_result'; memories: unknown[]; source: 'cloud' | 'cache' }
  | { type: 'memory_error'; message: string };

export type Outbound =
  | { type: 'chat:send'; text: string }
  | { type: 'memory_query'; query: string; scope: string; agent: string; taskId: string };
