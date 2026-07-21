/**
 * Tool definitions exposed to the LLM.
 *
 * The sidecar does NOT execute these. It emits a `tool_call` over WebSocket
 * to the extension host, which runs them against the temp workspace. The
 * schemas here are what the model sees when choosing what to call.
 */
import type { ToolDefinition } from '../llm/chatClient';

export const TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_replace',
      description:
        'Replace an exact, unique substring in a file with new content. The path is relative to the workspace root. ' +
        'old_str must match exactly one location; include enough surrounding context to make it unique. ' +
        'Use read_file first if you are unsure of the current contents.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path relative to the workspace root.' },
          old_str: { type: 'string', description: 'Exact substring to find. Must be unique in the file.' },
          new_str: { type: 'string', description: 'Replacement content.' },
        },
        required: ['filePath', 'old_str', 'new_str'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a file from the workspace. Returns the file contents. ' +
        'Access to secret files (.env, *.pem, *secret*, credentials.*) is blocked — those reads will return an error.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path relative to the workspace root.' },
        },
        required: ['filePath'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_safe_bash',
      description:
        'Run a shell command in the workspace root. Only a small whitelist of commands is allowed ' +
        '(npm test, npx eslint, git status/diff/log, etc.). 30s timeout.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The exact command to run.' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_lint',
      description: 'Run the project linter (ESLint) on the given files.',
      parameters: {
        type: 'object',
        properties: {
          filePaths: { type: 'array', items: { type: 'string' }, description: 'Files to lint, workspace-relative.' },
        },
        required: ['filePaths'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_git_diff',
      description:
        'Return a unified diff of all the changes you have made so far in this task. ' +
        'Use this before finishing to review your work.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];
