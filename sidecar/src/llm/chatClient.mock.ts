/**
 * Mock chat client for tests. Keeps a per-test script of scripted responses
 * that get returned in order. The mock has the same return shape as the real
 * client, so the agent loop is exercised identically.
 *
 * Usage (test only):
 *   import { setMockScript } from '../dist/llm/chatClient.mock.js';
 *   setMockScript([
 *     { content: '', toolCalls: [{ name: 'search_replace', args: { ... } }] },
 *     { content: 'Done.', toolCalls: [] },
 *   ]);
 *   process.env.OLLOPA_LLM_MODE = 'mock';
 */
import type { ChatMessage, ChatResult, ToolCall } from './chatClient';

interface ScriptStep {
  content: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }>;
}

let script: ScriptStep[] = [];
let cursor = 0;
let idCounter = 0;

export function setMockScript(steps: ScriptStep[]): void {
  script = steps;
  cursor = 0;
  idCounter = 0;
}

export function hasMockScript(): boolean {
  return script.length > 0;
}

export function resetMock(): void {
  script = [];
  cursor = 0;
  idCounter = 0;
}

export function runMock(_messages: ChatMessage[], _tools: unknown): ChatResult {
  if (cursor >= script.length) {
    // Defensive: if the agent runs past the script, return a no-op text reply
    // so the loop terminates cleanly instead of throwing in the middle of a run.
    return {
      message: { role: 'assistant', content: '(mock script exhausted — loop should end)' },
      finishReason: 'stop',
    };
  }
  const step = script[cursor++];
  const toolCalls: ToolCall[] = step.toolCalls.map((tc) => ({
    id: tc.id ?? `call_${++idCounter}`,
    name: tc.name,
    args: tc.args,
  }));
  return {
    message: {
      role: 'assistant',
      content: step.content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    },
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
  };
}
