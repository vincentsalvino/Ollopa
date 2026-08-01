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
  | { type: 'agent_thought'; taskId: string; message: string; agent: 'implementation' | 'architect' | 'frontend' | 'backend' | 'review' }
  | { type: 'tool_call'; taskId: string; toolName: string; toolArgs: unknown; startedAt: number }
  | { type: 'tool_output'; taskId: string; toolName: string; output: string; kind: 'terminal' | 'diff' | 'file' | 'error'; durationMs?: number }
  | { type: 'task_final_diff'; taskId: string; diff: string }
  | { type: 'task_error'; taskId: string; message: string }
  | { type: 'task_complete'; taskId: string; status?: 'success' | 'failed' | 'cancelled' }
  | { type: 'task_applied'; taskId: string; applied: string[] }
  | { type: 'task_rejected'; taskId: string }
  | { type: 'plan_proposed'; taskId: string; contract: { goal: string; files: string[]; risks: string[]; suggestedRole: 'frontend' | 'backend' | 'implementation'; steps: string[]; scopeHash: string }; planText: string; agent: 'architect' }
  | { type: 'review_verdict'; taskId: string; verdict: 'PASS' | 'FAIL'; violated: string[]; feedback: string }
  | { type: 'provider_status'; forceDirect: boolean; omnirouteUp: boolean; omnirouteUrl: string | null; providerCount: number; keyPools?: Array<{ provider: string; current: number; total: number; cooldownUntil?: number }> }
  | { type: 'task_backend'; taskId: string; backend: { kind: 'omniroute' | 'direct'; provider?: string; model: string; keyIndex?: number; keyTotal?: number } }
  | { type: 'command_list'; commands: Array<{ name: string; description: string }> }
  | { type: 'command_result'; taskId: string; command: string; output: string; kind: 'info' | 'success' | 'warning' | 'error' }
  | { type: 'install_result'; ok: boolean; plugin?: { name: string; version: string; dir: string }; error?: string }
  | { type: 'uninstall_result'; ok: boolean; error?: string }
  | { type: 'installed_list'; plugins: Array<{ id: string; name: string; version: string; source: string; integrity: string; installedAt: string }> }
  | { type: 'task_token_total'; taskId: string; agent: 'implementation' | 'architect' | 'frontend' | 'backend' | 'review'; total: number }
  | { type: 'export_skill_result'; ok: boolean; name?: string; json?: string; error?: string }
  | { type: 'import_skill_result'; ok: boolean; error?: string; path?: string }
  | { type: 'skills_list'; skills: Array<{ name: string; description: string; autoTrigger: boolean; prompt: string; origin: string }> }
  | { type: 'focus_prompt' }
  | { type: 'privacy_status'; localOnly: boolean; redactSecrets: boolean };

export type Outbound =
  | { type: 'chat:send'; text: string; mode: 'quick' | 'task' }
  | { type: 'task_accept'; taskId: string }
  | { type: 'task_reject'; taskId: string }
  | { type: 'plan_decision'; taskId: string; decision: 'approve' | 'reject'; comment?: string }
  | { type: 'task_cancel'; taskId: string }
  | { type: 'memory_query'; query: string; scope: string; agent: string; taskId: string }
  | { type: 'set_provider_mode'; forceDirect: boolean }
  | { type: 'chat:command'; command: string; args: string }
  | { type: 'list_commands' }
  | { type: 'install_plugin'; spec: string }
  | { type: 'uninstall_plugin'; name: string }
  | { type: 'list_installed_plugins' }
  | { type: 'export_skill'; name: string }
  | { type: 'import_skill'; json: string; path?: string }
  | { type: 'list_skills' };
