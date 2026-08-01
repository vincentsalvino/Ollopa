# Local LLM Setup (Phase 6)

Run Ollopa fully offline against a local LLM. No cloud round-trip.

## Why

Most coding assistants require sending your code to a remote API. With
Ollama + the `ollopa.privacy.localOnly` setting, Ollopa runs end-to-end
on your machine: LLM, embeddings (when wired), nothing leaves.

## Prereqs

- macOS / Linux / Windows
- 8 GB RAM minimum (16 GB recommended for 7B-class models)
- Optional: an Apple Silicon Mac, NVIDIA GPU, or modern AMD GPU

## Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows: download from https://ollama.com/download
```

## Pull a model

Smallest viable model for a quick start:

```bash
ollama pull llama3.2:3b
```

For code-heavy tasks, prefer a code-tuned model:

```bash
ollama pull deepseek-coder:6.7b
ollama pull qwen2.5-coder:7b
```

Start the server (runs on `http://localhost:11434` by default):

```bash
ollama serve
```

## Configure Ollopa

In VS Code settings, set:

```json
{
  "ollopa.directProviders": [
    {
      "name": "ollama-local",
      "baseUrl": "http://localhost:11434",
      "enabled": true,
      "kind": "ollama",
      "model": "llama3.2:3b"
    }
  ],
  "ollopa.privacy.localOnly": true,
  "ollopa.privacy.redactSecrets": true
}
```

Restart the Ollopa sidecar after changing settings. The webview will
show a `Local-only mode — cloud features are disabled` banner.

## Detecting hardware

`ollama serve` will auto-detect GPUs. To verify:

```bash
ollama ps
```

If you see no GPU listed, the model will fall back to CPU inference
(slower but works).

## What localOnly blocks

- `web_search` / `fetch_url` / `lookup_api` / `lookup_example` tools
- OmniRoute (cloud router)
- Any non-Ollama direct provider

## Audit log

Every blocked call is recorded at `~/.ollopa/audit.log` (override via
`OLLOPA_AUDIT_LOG`). Each line is JSON:

```json
{"ts":1722350000000,"kind":"network_blocked","source":"web_search","detail":"localOnly mode active"}
```

Tail the log while you work:

```bash
tail -f ~/.ollopa/audit.log
```

## llama.cpp (not yet supported)

Today the only local adapter is Ollama. Direct llama.cpp support is a
future phase — for now, run llama.cpp behind an OpenAI-compatible HTTP
shim and configure it as `kind: openai-compatible`.

## Ollama Cloud (separate from local Ollama)

The `ollama` adapter in `ollopa.directProviders` is **local-only** — it
points at `http://localhost:11434` and never makes a network call. If
you want Ollama's hosted models (free tier, no GPU), see
[ollama-cloud.md](./ollama-cloud.md) for the `ollama-cloud` preset and
key-pool setup. The cloud adapter is a cloud provider and is blocked by
`ollopa.privacy.localOnly`.
