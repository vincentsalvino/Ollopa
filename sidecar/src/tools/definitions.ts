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
  {
    type: 'function',
    function: {
      name: 'semgrep_scan',
      description:
        'Run semgrep with the auto config on the given files (workspace-relative) and return JSON. ' +
        'Critical (ERROR-severity) findings force a Review FAIL. Use this near the end of a task ' +
        'before requesting review, or when the Review agent asks for a security re-scan.',
      parameters: {
        type: 'object',
        properties: {
          filePaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files to scan, workspace-relative. If empty, scans all files changed so far.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  // --- Phase 1.1C: extended file ops ---
  {
    type: 'function',
    function: {
      name: 'move_file',
      description:
        'Move or rename a file within the workspace. Refuses to touch secret/protected paths. ' +
        'Fails if destination already exists unless overwrite is true.',
      parameters: {
        type: 'object',
        properties: {
          src: { type: 'string', description: 'Source path, workspace-relative.' },
          dst: { type: 'string', description: 'Destination path, workspace-relative.' },
          overwrite: { type: 'boolean', description: 'Allow replacing an existing file at dst.', default: false },
        },
        required: ['src', 'dst'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_search_replace',
      description:
        'Apply multiple search_replace edits atomically across one or more files. ' +
        'Fails fast on the first non-unique or missing old_str. All edits must succeed or none are applied.',
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            description: 'Ordered list of search_replace edits to apply.',
            items: {
              type: 'object',
              properties: {
                filePath: { type: 'string' },
                old_str: { type: 'string' },
                new_str: { type: 'string' },
              },
              required: ['filePath', 'old_str', 'new_str'],
              additionalProperties: false,
            },
          },
        },
        required: ['edits'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List files in the workspace matching a glob pattern. Read-only. Returns workspace-relative paths, one per line.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.ts". Empty string lists all files.', default: '**/*' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_tests',
      description:
        'Run the project test command. Whitelisted: `npm test`, `npx jest`, `npx vitest`. 5 minute timeout.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Test command. Must be one of the whitelisted forms above.' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'secrets_scan',
      description:
        'Quick regex sweep for hard-coded secrets in the given files (AWS keys, JWT, private keys, generic high-entropy strings). ' +
        'Cheaper than semgrep_scan; use it before committing.',
      parameters: {
        type: 'object',
        properties: {
          filePaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files to scan, workspace-relative. If empty, scans all changed files.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'license_check',
      description:
        'Check the licenses of all dependencies declared in the workspace package.json by looking them up via `npm view`. ' +
        'Returns a list of any packages whose license matches the forbidden list ' +
        '(defaults: AGPL-*, SSPL*, BUSL-*, Commons-Clause).',
      parameters: {
        type: 'object',
        properties: {
          forbidden: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional glob patterns. Overrides the default forbidden license list. e.g. ["AGPL-*", "SSPL*"].',
          },
        },
        additionalProperties: false,
      },
    },
  },
  // --- Phase 3: web tools (sidecar-side) ---
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the public web for current documentation, examples, or API references. ' +
        'Default backend is DuckDuckGo (no API key). Whitelist of domains is enforced. ' +
        'Returns a numbered list of {title, url, snippet}.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          limit: { type: 'number', description: 'Max results to return (default 5).', default: 5 },
          backend: { type: 'string', description: 'Override backend (default duckduckgo).', default: 'duckduckgo' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch a URL and return plain text (HTML stripped). Domain must be in the whitelist. ' +
        'Capped at 50KB. Use this after web_search when you need the full page content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL.' },
          maxBytes: { type: 'number', description: 'Override the response cap (default 50KB).', default: 51200 },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_api',
      description:
        'Look up the current signature/docs for a library method. Returns a snippet of the most relevant page.',
      parameters: {
        type: 'object',
        properties: {
          library: { type: 'string', description: 'Library name, e.g. "node:fs" or "react".' },
          method: { type: 'string', description: 'Method or function name.' },
        },
        required: ['library', 'method'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_example',
      description:
        'Find usage examples for a library method. Returns top results from GitHub and Stack Overflow.',
      parameters: {
        type: 'object',
        properties: {
          library: { type: 'string', description: 'Library name.' },
          method: { type: 'string', description: 'Method or function name.' },
        },
        required: ['library', 'method'],
        additionalProperties: false,
      },
    },
  },
];
