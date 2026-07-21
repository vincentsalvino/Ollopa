/**
 * Chat completion client (OpenRouter).
 *
 * Same fetch pattern as `embedding.ts`: bearer auth, JSON body, 10s connect
 * budget on the caller side, structured error on non-2xx.
 *
 * Mocking: when `process.env.OLLOPA_LLM_MODE === 'mock'`, calls return a
 * deterministic scripted sequence so the agent loop is testable without
 * spending tokens. The script lives in `chatClient.mock.ts`.
 */
import { runMock as runMockImpl, hasMockScript } from './chatClient.mock';
import { getOpenRouterKey } from '../credentials';
import { LLM_MODEL } from './llmConfig';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

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

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<ChatResult> {
  if (process.env.OLLOPA_LLM_MODE === 'mock') {
    if (!hasMockScript()) {
      throw new Error('OLLOPA_LLM_MODE=mock but no mock script registered');
    }
    return runMockImpl(messages, tools);
  }

  const apiKey = getOpenRouterKey();
  const body: Record<string, unknown> = {
    model: LLM_MODEL,
    messages,
    temperature: 0.2,
  };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenRouter chat ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const json = (await res.json()) as OpenRouterChatResponse;
  const choice = json.choices?.[0];
  if (!choice) throw new Error('OpenRouter returned no choices');

  const raw = choice.message ?? { role: 'assistant', content: '' };
  const toolCalls = (raw.tool_calls ?? []).map((tc) => parseToolCall(tc));

  return {
    message: {
      role: 'assistant',
      content: raw.content ?? '',
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    },
    finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
  };
}

function parseToolCall(tc: RawToolCall): ToolCall {
  let args: Record<string, unknown> = {};
  if (tc.function?.arguments) {
    try { args = JSON.parse(tc.function.arguments); }
    catch { args = { _raw: tc.function.arguments }; }
  }
  return { id: tc.id, name: tc.function?.name ?? '', args };
}

interface RawToolCall {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenRouterChatResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      role: string;
      content?: string | null;
      tool_calls?: RawToolCall[];
    };
  }>;
}
