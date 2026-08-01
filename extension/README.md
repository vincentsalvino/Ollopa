# 🦎 Ollopa

**Code once. Remember forever. Improve autonomously.**

Ollopa is a chat-centric, multi-agent coding assistant that lives inside VS Code.
It remembers every project you throw at it, learns from the mistakes it makes,
and turns those lessons into reusable principles — so the same bug never trips
you up twice.

---

## Architecture

```
            ┌────────────────────────────────────────────────────┐
            │                  VS Code Webview                   │
            │   React + Vite chat UI (commands, streaming,       │
            │   message history, plan/timeline view, plugin pane) │
            └──────────────────────┬─────────────────────────────┘
                                   │  postMessage  (structured IPC)
            ┌──────────────────────▼─────────────────────────────┐
            │            Extension host  (extension/src)          │
            │  • WebviewView provider                             │
            │  • OmniRoute client  (LLM routing)                  │
            │  • Tool whitelist   / file policy  / command safety │
            │  • Secret storage   (API keys in VS Code SecretStorage)
            └──────────────────────┬─────────────────────────────┘
                                   │  WebSocket
            ┌──────────────────────▼─────────────────────────────┐
            │              Sidecar  (sidecar/src)                 │
            │   Node.js process — single source of truth for:    │
            │                                                     │
            │   LangGraph task agent  (planner / executor /       │
            │                            reflector / refiner)     │
            │   Mistake & Repair capture + principle attribution  │
            │   Refinery distillation (cosine dedupe >= 0.92)      │
            │   Memory: Candidate -> Elevated -> Trusted          │
            │   Plugin loader  (built-in / user / project)        │
            │   Quick-mode offline replays (SQLite cache)         │
            │                                                     │
            │   ┌─────────────┐    ┌──────────────────────────┐   │
            │   │   SQLite    │    │   Supabase (optional)    │   │
            │   │ local cache │<-->│   cloud memory sync      │   │
            │   └─────────────┘    └──────────────────────────┘   │
            └────────────────────────────────────────────────────┘
```

## Features

- **Two modes, one agent.** *Quick Mode* answers questions and edits files
  with a short reflection loop. *Task Mode* is a full LangGraph state
  machine — plan, execute, observe, reflect, refine — with cancellation
  and resumable checkpoints.
- **Persistent memory.** Every successful or failed repair becomes a
  memory entry. Repeated wins graduate from *Candidate* to *Elevated*
  to *Trusted*. The Refinery distills them into short principles and
  dedupes by cosine similarity (>= 0.92).
- **Plug-in ecosystem.** Drop a JavaScript file in
  `~/.ollopa/plugins/` or `<project>/.ollopa/plugins/` and Ollopa picks
  it up at startup. The new **marketplace** install spec
  (`npm:@scope/name`, `github:owner/repo[@ref]`, or `git:url#ref`)
  downloads a Claude Code-compatible plugin — `plugin.json` + `commands/`
  + `agents/` + `skills/` + `hooks/` + `.mcp.json` — into
  `~/.ollopa/plugins/<name>@<version>/`. Plugins can register tools,
  slash commands, hooks, agents, skills, and MCP servers — no rebuild
  required. The existing flat-`.js` plugin shape still works (back-compat).
- **Provider flexibility.** Pluggable routing: OmniRoute if running,
  otherwise direct OpenAI-compatible providers (OpenRouter, DeepSeek,
  anything with a `/v1` endpoint). Per-provider API keys stored in
  VS Code SecretStorage.
- **Safety first.** File writes go through a path policy (sandbox +
  symlink-chain check). Shell commands go through a whitelist with
  defence against quote-stripping bypasses. Secret files are blocked
  outright. Friendly error redaction keeps stack traces out of chat.
- **Optional cloud sync.** Supabase-backed memory sync is opt-in. The
  local SQLite cache keeps Ollopa fully functional offline.
- **Self-improving.** Mistakes captured today become principles used
  tomorrow. The `/refine` command runs the Refinery on demand.

## Quickstart

```bash
git clone https://github.com/ollopa/ollopa.git
cd ollopa
npm install
npm run build
```

1. Open the repo in VS Code (`code .`) and press **F5** to launch
   the Extension Development Host.
2. Run **Ollopa: Configure** from the command palette and set:
   - `ollopa.workspaceRoot` — path to the project Ollopa edits.
   - `ollopa.omnirouteUrl` — leave default `http://localhost:20128`
     if OmniRoute is running, or paste your direct provider keys with
     **Ollopa: Add Provider API Key**.
3. Open the **Ollopa** activity-bar view and ask:
   > _"Explain the auth flow in this codebase."_
4. Toggle to **Task Mode** and try:
   > _"Add a logout button to the header component."_

Full step-by-step guide: [docs/quickstart.md](docs/quickstart.md).

## Configuration reference

| Setting                         | Default                  | Purpose                                                            |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| `ollopa.workspaceRoot`          | (first opened folder)    | Project Ollopa edits                                               |
| `ollopa.omnirouteUrl`           | `http://localhost:20128` | OmniRoute router base URL                                          |
| `ollopa.forceDirect`            | `false`                  | Skip OmniRoute, go straight to a direct provider                   |
| `ollopa.directProviders[]`      | OpenRouter, DeepSeek     | Order in which direct OpenAI-compatible providers are tried       |
| `ollopa.providerKey.<alias>`    | —                        | SecretStorage entry holding the API key for that provider alias   |

## Plugin example

Two plugin shapes are supported. The Claude Code-style layout is the
recommended one going forward.

### Claude Code-style (recommended)

A directory with a `plugin.json` manifest plus any of `commands/`,
`agents/`, `skills/`, `hooks/`, `.mcp.json`. Save this to
`~/.ollopa/plugins/hello/`:

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
  "description": "Say hi through Ollopa",
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

### Flat `.js` (back-compat)

A single JavaScript file exporting a default object. Save this to
`~/.ollopa/plugins/hello.js`:

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

### Install from the marketplace

Open the **Plugins** tab in the Ollopa chat panel and paste a spec:

```text
npm:@scope/name                    # pack the latest version
npm:@scope/name@1.2.3              # pin a version
github:owner/repo[@ref]            # fetch GitHub tarball
git:https://...git[#ref]           # shallow clone
```

Ollopa downloads, validates the manifest, computes a sha256 integrity
hash, and copies the result into `~/.ollopa/plugins/<name>@<version>/`.
A `~/.ollopa/plugins.lock.json` file tracks every install.

The CLI-style equivalents ship in the next minor; for now the Plugins
panel is the install surface.

## Project structure

```
ollopa/
├── extension/          # VS Code extension host (TypeScript)
│   ├── src/            #   webview provider, tool bridge, policies
│   └── package.json    #   extension manifest
├── webview/            # React + Vite chat UI
│   └── src/            #   components, message rendering, plugin pane
├── sidecar/            # Node.js sidecar — LangGraph agent + memory
│   ├── src/
│   │   ├── agents/     #   planner / executor / reflector / refiner
│   │   ├── memory/     #   refinery, local cache, Supabase sync
│   │   ├── plugins/    #   loader + manifest + commands/agents/skills/mcp/marketplace
│   │   └── llm/        #   OmniRoute + direct provider clients
│   └── test/           #   plugins / marketplace / mcp / skills / offline / quick-mode
├── examples/plugins/   # sample Claude Code-style plugins
├── scripts/            # VSIX packaging, build glue
├── docs/               # quickstart, design notes
├── .github/workflows/  # CI
└── # Ollopa — VSCode extension.md   # blueprint (source of truth)
```

## Tech stack

| Layer        | Choice                                                          |
| ------------ | --------------------------------------------------------------- |
| UI           | React 18 + Vite                                                 |
| Extension    | VS Code Extension API, WebView, WebSocket                       |
| Sidecar      | Node.js 20+, TypeScript, LangGraph.js                           |
| LLM routing  | OmniRoute (optional) + direct OpenAI-compatible providers       |
| Local store  | better-sqlite3 (memory cache)                                   |
| Cloud sync   | Supabase (Postgres + pgvector) — optional                       |
| Embeddings   | OpenAI-compatible embeddings endpoint                           |
| Tests        | tsx + a handful of end-to-end smoke scripts                     |
| Packaging    | @vscode/vsce 3.9                                                |

## Development

```bash
npm run build          # build webview + sidecar + extension
npm test               # typecheck + plugin tests + offline + quick-mode E2E
npm run package        # produce ./ollopa-<version>.vsix
```

## License

MIT — see [LICENSE](LICENSE).

## Links

- Blueprint: `# Ollopa — VSCode extension.md`
- Quickstart: [docs/quickstart.md](docs/quickstart.md)
- Repository: <https://github.com/ollopa/ollopa>