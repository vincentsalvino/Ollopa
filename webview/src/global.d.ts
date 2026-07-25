/// <reference types="vite/client" />

declare global {
  interface Window {
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
  | { type: 'memory_error'; message: string }
  | { type: 'task_started'; taskId: string }
  | { type: 'agent_thought'; taskId: string; message: string; agent: 'implementation' }
  | { type: 'tool_call'; taskId: string; toolName: string; toolArgs: unknown }
  | { type: 'tool_output'; taskId: string; toolName: string; output: string; kind: 'terminal' | 'diff' | 'file' | 'error' }
  | { type: 'task_final_diff'; taskId: string; diff: string }
  | { type: 'task_error'; taskId: string; message: string }
  | { type: 'task_complete'; taskId: string }
  | { type: 'task_applied'; taskId: string; applied: string[] }
  | { type: 'task_rejected'; taskId: string }
  | { type: 'provider_status'; forceDirect: boolean; omnirouteUp: boolean; omnirouteUrl: string | null; providerCount: number }
  | { type: 'task_backend'; taskId: string; backend: { kind: 'omniroute' | 'direct'; provider?: string; model: string } }
  | { type: 'command_list'; commands: Array<{ name: string; description: string }> }
  | { type: 'command_result'; taskId: string; command: string; output: string; kind: 'info' | 'success' | 'warning' | 'error' };

export type Outbound =
  | { type: 'chat:send'; text: string; mode: 'quick' }
  | { type: 'task_accept'; taskId: string }
  | { type: 'task_reject'; taskId: string }
  | { type: 'memory_query'; query: string; scope: string; agent: string; taskId: string }
  | { type: 'set_provider_mode'; forceDirect: boolean }
  | { type: 'chat:command'; command: string; args: string }
  | { type: 'list_commands' };
