# Quickstart

Get Ollopa running in your editor in under ten minutes.

## Prerequisites

- **Node.js 20+** (`node --version` should print `v20.x` or higher)
- **VS Code 1.85+**
- **npm** (bundled with Node)
- An API key for an OpenAI-compatible LLM provider — OpenRouter is the
  easiest on-ramp: <https://openrouter.ai/keys>. OmniRoute is optional;
  Ollopa falls back to direct providers automatically.
- Optional: a Supabase project if you want cloud memory sync. Skip this
  for the first run — Ollopa works fully offline with its local cache.

## 1. Clone and build

```bash
git clone https://github.com/ollopa/ollopa.git
cd ollopa
npm install
npm run build
```

`npm run build` compiles the webview (Vite), the sidecar (tsc), and the
extension host (tsc), then copies the sidecar/webview build outputs
into `extension/` so the .vsix is self-contained.

## 2. Launch the Extension Development Host

```bash
code .
```

Press **F5**. VS Code opens a new "Extension Development Host" window
with the Ollopa activity-bar icon visible on the left.

## 3. Add your API key

In the Extension Development Host, open the command palette
(`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

> **Ollopa: Add Provider API Key**

Pick `__openrouter__` (the built-in alias) and paste your OpenRouter
key when prompted. The key is stored in VS Code SecretStorage — never
on disk in plaintext.

## 4. Configure the workspace

Run **Ollopa: Configure** from the command palette. The minimum
setting is `ollopa.workspaceRoot` — point it at the project you want
Ollopa to read and edit. If you leave it blank, Ollopa defaults to
the first opened folder in the current workspace.

Leave the other defaults in place unless you run OmniRoute:

- `ollopa.omnirouteUrl` — set to your OmniRoute instance, or leave
  `http://localhost:20128` if OmniRoute is running locally.
- `ollopa.forceDirect` — keep `false` to let Ollopa try OmniRoute
  first and fall back to direct providers automatically.
- `ollopa.directProviders` — reorder or add more providers here.

## 5. First Quick Mode task

Open the **Ollopa** view in the activity bar. Type:

> Explain the auth flow in this codebase.

Quick Mode runs a short reflection loop and answers inline. It will
read files through the policy layer, summarise what it found, and
suggest follow-up edits if any.

## 6. First Task Mode task

Click the mode toggle (top-right of the chat panel) and switch to
**Task Mode**. Try:

> Add a logout button to the header component.

Task Mode spins up the LangGraph state machine:

1. **Plan** — produces a structured task list.
2. **Execute** — runs file reads / writes / shell commands.
3. **Observe** — captures tool outputs and side-effects.
4. **Reflect** — judges success or failure, captures mistakes.
5. **Refine** — graduates successful repairs into persistent memory.

You can **Cancel** any time. The plan and partial results stay
visible so you can resume by re-asking.

## 7. Write your first plugin

Two plugin shapes are supported. The Claude Code-style directory layout
is recommended for new plugins; the legacy flat-`.js` shape still works.

### Claude Code-style (recommended)

Create `~/.ollopa/plugins/hello/`:

```text
hello/
├── plugin.json
└── commands/
    └── hello.md
```

`plugin.json`:

```json
{
  "name": "hello",
  "version": "0.1.0",
  "description": "Greet the named person",
  "provides": { "commands": ["commands/"] }
}
```

`commands/hello.md`:

```md
---
name: hello
description: Greet the named person
args:
  - name: who
---

Greet {{who}} warmly. Keep it to one sentence.
```

Reload VS Code. In the Ollopa chat, type `/hello who=Ada`.

### Flat `.js` (back-compat)

Create `~/.ollopa/plugins/hello.js`:

```js
export default {
  name: 'hello',
  commands: [{
    name: 'hello',
    description: 'Say hi through Ollopa',
    async run(ctx, args) {
      ctx.log(`Hello, ${args.name || 'world'}!`);
      return { ok: true, message: `greeted ${args.name || 'world'}` };
    },
  }],
};
```

Reload VS Code. In the Ollopa chat, type `/hello name=Ada`. The
plugin's `run` is called with a context object (logging, current
workspace, memory access) and the parsed `args` object.

Project-local plugins go in `<workspace>/.ollopa/plugins/` and take
precedence over user-level ones. Built-in plugins ship with Ollopa
itself; see `sidecar/src/plugins/builtin.ts`.

### Install from the marketplace

The **Plugins** tab in the Ollopa chat panel accepts install specs:

```text
npm:@scope/name                    # pack the latest version
npm:@scope/name@1.2.3              # pin a version
github:owner/repo[@ref]            # fetch GitHub tarball
git:https://...git[#ref]           # shallow clone
```

Ollopa downloads the plugin, validates its `plugin.json`, computes a
sha256 integrity hash, and copies the result into
`~/.ollopa/plugins/<name>@<version>/`. A `~/.ollopa/plugins.lock.json`
file tracks every install.

## 8. Run the test suite

```bash
npm test
```

This runs, in order:

1. `npm run build` — full rebuild.
2. `npm run typecheck` — `tsc --noEmit` on sidecar and extension.
3. `npm run test:plugins` — 8 unit tests covering plugin loader paths
   and built-in registrations. Companion suites:
   `npm run test:marketplace` (10 tests for spec parsing, lockfile,
   integrity), `npm run test:mcp` (5 tests for the JSON-RPC client),
   `npm run test:skills` (12 tests for frontmatter and rendering).
4. `npm run test:phase2` — offline replay E2E against the sidecar.
5. `npm run test:quick` — Quick Mode E2E with the mock provider.

All tests run in **mock mode** — no API keys, no Supabase, no
network. Expected exit code: `0`.

## Troubleshooting

### "Sidecar failed to start"

- Confirm Node 20+ is on `PATH`. The sidecar is launched as
  `node sidecar/dist/start.js`.
- Check the Output panel — channel **Ollopa Sidecar** — for the
  crash stack.

### "No LLM provider reachable"

- Verify your API key with **Ollopa: Add Provider API Key**.
- If OmniRoute is configured but unreachable, set
  `ollopa.forceDirect: true` to bypass it.

### File edits rejected by the policy layer

The file policy enforces sandbox paths and blocks secret files
(`.env`, `.ssh/`, etc.). If a legitimate write is blocked, file an
issue with the exact path and the reason given in the rejection
message — the policy is intentionally strict and any widening needs
a justification.

### Memory doesn't sync to Supabase

- Run `/refine` to trigger a sync; check the Output panel
  (**Ollopa Sidecar**) for sync errors.
- Confirm the Supabase URL and anon key are set (see the
  blueprint's Phase 6 / Phase 7 sections for the env var names).

## Where to go next

- Blueprint — `# Ollopa — VSCode extension.md` — the canonical spec.
- Project tree — see the README.
- Plugin reference — `sidecar/src/plugins/commands.ts` for the full
  plugin shape (commands, tools, hooks, providers).