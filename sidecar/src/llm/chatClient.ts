/**
 * Chat completion client — Phase 3.5.
 *
 * In production this delegates to the provider router (OmniRoute default,
 * direct OpenAI-compatible providers as fallback). The mock path is kept
 * identical so the Phase 3 test suite keeps passing.
 *
 * Mocking: when `process.env.OLLOPA_LLM_MODE === 'mock'`, calls return a
 * deterministic scripted sequence so the agent loop is testable without
 * spending tokens. The script lives in `chatClient.mock.ts`.
 */
import { runMock as runMockImpl, hasMockScript } from './chatClient.mock';
import { loadCredentials } from '../credentials';
import { LLM_MODEL } from './llmConfig';
import { chatWithRouter, type ResolvedChatResult } from './providerRouter';

export interface ToolCall {
  id: string;
  name: string;
  /** Already parsed from JSON. */
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Plain text content. May be empty when the message only carries tool_calls. */
  content: string;
  /** Set on assistant messages that include tool calls. */
  tool_calls?: ToolCall[];
  /** Set on tool messages; references the tool call id from the assistant. */
  tool_call_id?: string;
  /** Set on tool messages — name is required by OpenAI-compatible APIs. */
  name?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResult {
  message: ChatMessage;
  /** Set if the model stopped because of tool_calls. The agent loop continues. */
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

/**
 * The most recent resolved backend. Exposed so callers (start.ts / webview
 * via the sidecar) can render a "OmniRoute · auto" or "Direct · deepseek" chip.
 */
let lastBackend: ResolvedChatResult['backend'] | null = null;
export function getLastBackend(): ResolvedChatResult['backend'] | null {
  return lastBackend;
}

/**
 * Phase 4: optional per-call override. When `overrideProvider` is set,
 * the router bypasses OmniRoute and the fallback chain and uses this
 * provider directly. Empty string = no override.
 *
 * Why per-call: the webview header chip lets the user pin a task to a
 * specific model. The override lives on the call, not on the process.
 */
let activeOverride: string = '';
export function setProviderOverride(name: string | null | undefined): void {
  activeOverride = typeof name === 'string' ? name : '';
}
export function getProviderOverride(): string {
  return activeOverride;
}

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<ChatResult> {
  if (process.env.OLLAPA_LLM_MODE === 'mock' || process.env.OLLOPA_LLM_MODE === 'mock') {
    if (!hasMockScript()) {
      throw new Error('OLLOPA_LLM_MODE=mock but no mock script registered');
    }
    return runMockImpl(messages, tools);
  }

  // Production path: route through OmniRoute (default) or direct providers.
  const creds = loadCredentials();
  const result = await chatWithRouter(messages, tools, {
    omnirouteUrl: creds.omnirouteUrl,
    forceDirect: creds.forceDirect,
    directProviders: creds.directProviders,
    defaultModel: LLM_MODEL,
    fallbackChain: creds.fallbackChain,
    overrideProvider: activeOverride || undefined,
  });
  lastBackend = result.backend;
  return result;
}
