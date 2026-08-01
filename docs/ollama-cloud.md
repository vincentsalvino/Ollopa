# Ollama Cloud — Free-Tier Hosted Models (Phase 8)

Ollama Cloud is Ollama's hosted model endpoint at `https://api.ollama.com/v1`. It exposes the same model catalogue as the local Ollama CLI (`llama3.2`, `gemma3`, `qwen2.5`, `devstral`, …) but runs on Ollama's GPUs. New accounts get a free weekly + per-session quota.

Ollopa treats it as a third way to reach an LLM — alongside OmniRoute and your direct providers — using a generic key-pool circuit breaker so multiple accounts multiply your combined free tier.

## Why

- **Zero hardware**: no GPU, no local install. Cloud-hosted, OpenAI-compatible.
- **Free tier per account**: weekly + 2-hour session quota. New Gmail = new free key.
- **Multi-account multiplication**: every additional account adds another full free quota. The key pool rotates between them automatically.
- **Automatic recovery**: when a key hits quota, it's marked exhausted until the reset window lifts. The router keeps going on the next key.

## Setup

### 1. Create the entry in settings

`ollama-cloud` ships as a preset in `ollopa.directProviders` defaults:

```json
{
  "name": "ollama-cloud",
  "baseUrl": "https://api.ollama.com/v1",
  "enabled": true,
  "keys": ["ollama_cloud_key1"],
  "kind": "openai-compatible",
  "poolDefaults": { "weeklyMs": 604800000, "sessionMs": 7200000 }
}
```

Flip `enabled` to `true` after step 2. The default pool has one slot — add more aliases later via **Ollopa: Manage Provider Keys**.

### 2. Add the API key

1. Sign in at [ollama.com](https://ollama.com) (Google, GitHub, or email).
2. Open the dashboard → **Settings → API keys** → **Generate**.
3. In VS Code: run **Ollopa: Add Provider API Key** (or **Ollopa: Manage Provider Keys → add-key** for pool entries).
   - Alias: `ollama_cloud_key1`
   - Value: the key you just generated.
4. The key is stored in the OS keychain under `ollopa.providerKey.ollama_cloud_key1`. Ollopa never touches `settings.json` for secrets.

### 3. Multi-account strategy

Each Gmail/email account = one Ollama account = one full free quota. To multiply:

1. Sign out, sign up with a different email.
2. Generate another API key (alias `ollama_cloud_key2`, `ollama_cloud_key3`, …).
3. In `ollopa.directProviders` → `ollama-cloud.keys`, add the new alias.
4. Reload the sidecar (toggling any Ollopa setting, or restarting VS Code).

The router now round-robins across all configured keys. When one hits its quota, it skips to the next; when the cooldown lifts, it cycles back.

### 4. Pick the model

`ollama-cloud` does not specify a model by default — Ollopa falls back to `LLM_MODEL` from `sidecar/src/llm/llmConfig.ts`. To override per-provider, add `model` to the entry:

```json
{ "name": "ollama-cloud", "model": "llama3.2", ... }
```

Available models include `llama3.2`, `gemma3`, `qwen2.5-coder`, `devstral`, `mistral`, `phi4`, and others.

## Quota signals

The router detects quota exhaustion from three sources, in order:

1. **HTTP 429** with `x-ratelimit-reset`, `x-ratelimit-reset-requests`, or `retry-after` headers. The value is parsed as either a Unix timestamp or seconds-from-now.
2. **Body keywords** in the error response: `weekly limit`, `session limit`, `quota exceeded`, `insufficient credits`, `usage limit reached`, `rate limit exceeded`.
3. **Default windows** from `poolDefaults` when neither signal is present — 7 days for `weekly limit`, 2 hours for `session limit`, 1 hour for everything else.

Each event is appended to `~/.ollopa/audit.log` as a `keypool_exhausted` entry:

```json
{"ts":1722350000000,"kind":"keypool_exhausted","source":"ollama-cloud","detail":"key[0] exhausted, reset in 4d"}
```

Tail the log while you work:

```bash
tail -f ~/.ollopa/audit.log | grep keypool
```

## State persistence

The pool's cooldown state lives in `~/.ollopa/keypool.json`. It is updated debounced (250ms after the last transition). When the sidecar restarts, the file is reloaded — exhausted keys stay exhausted until their window lifts. The extension mirrors `lastSeenAt` so toggling settings mid-session doesn't clobber active cooldowns.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Chip shows `Direct · ollama-cloud · error` repeatedly | No key configured | Run **Ollopa: Add Provider API Key** with the alias from `keys[]` |
| Chip shows `[1/2]` after a 429, then `[2/2]` | First key exhausted, pool rotated | Expected — the router is doing its job |
| All keys exhausted, requests fail | Weekly quotas all hit | Wait for the reset window or add another account |
| Local-only mode refuses ollama-cloud | Privacy gate | `ollama-cloud` is a cloud provider — `ollopa.privacy.localOnly` blocks it. Use `ollama-local` instead |
| `401 Provider auth failed` | Key revoked / wrong alias | Re-generate the key at ollama.com, re-store in OS keychain |

## When NOT to use Ollama Cloud

- **Sensitive code** — the prompt leaves your machine. Use `ollama-local` + `ollopa.privacy.localOnly` for fully offline runs.
- **Unbounded throughput** — the free tier has weekly caps. For heavy work, sign up for paid quota or use local Ollama on a GPU box.
- **Production-grade SLA** — the free tier has no uptime guarantee.
