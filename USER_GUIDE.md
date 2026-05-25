# Claude Desktop — User Guide

A complete guide to using all features of your AI workspace.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Chat & Conversations](#chat--conversations)
3. [Model Selector](#model-selector)
4. [API Key Management](#api-key-management)
5. [Prompt Transformer (Auto-Enhance)](#prompt-transformer-auto-enhance)
6. [Web Search](#web-search)
7. [File Attachments](#file-attachments)
8. [Streaming & Stop Generation](#streaming--stop-generation)
9. [Message Editing & Regeneration](#message-editing--regeneration)
10. [Conversation Search](#conversation-search)
11. [Session History](#session-history)
12. [Export Conversations](#export-conversations)
13. [System Prompt (Custom Instructions)](#system-prompt-custom-instructions)
14. [Multi-Agent System](#multi-agent-system)
15. [Provider Router](#provider-router)
16. [Second Brain](#second-brain)
17. [Visual Memory Graphs](#visual-memory-graphs)
18. [Token Optimizer](#token-optimizer)
19. [Keyboard Shortcuts](#keyboard-shortcuts)
20. [Theme](#theme)

---

## Getting Started

### First Launch

1. Run `cargo tauri dev` from your project root
2. The app opens with a dark theme and an empty chat
3. Your default model is **DeepSeek** (set via `ANTHROPIC_API_KEY` env var)
4. To use other providers, add API keys via the **API Key Management** modal (no terminal needed!)

### Requirements

- At minimum, one API key for any supported provider (DeepSeek, Claude, OpenAI, or OpenRouter)

---

## Chat & Conversations

### Sending Messages

- Type your message in the input bar at the bottom
- Press **Enter** to send (Shift+Enter for new line)
- Messages appear in real-time with streaming display (words appear as they're generated)

### Markdown Rendering

Responses are rendered with full markdown support:
- **Headings** (H1-H6)
- **Bold**, *italic*, ~~strikethrough~~
- Bullet and numbered lists
- Tables
- Links and images
- Code blocks with syntax highlighting (12+ languages)
- Blockquotes

### Copy Messages

- Hover over any message to see a **Copy** button
- Click to copy the entire response to your clipboard

---

## Model Selector

### Switching Models

1. Click the **model name** in the toolbar (shows current model with a dropdown arrow)
2. A grouped dropdown appears organized by provider:
   - **DeepSeek**: deepseek-chat, deepseek-coder, deepseek-reasoner
   - **Claude**: claude-sonnet-4, claude-3.5-haiku
   - **OpenAI**: gpt-4o, gpt-4o-mini, gpt-4-turbo
   - **OpenRouter / Hermes**: Hermes 3 405B/70B, OpenChat 3.6, Llama 3.1 405B, Mistral Large
   - **Nous Research**: Hermes 3 70B (Direct)
3. Click any model to switch — takes effect immediately
4. You need the corresponding API key set for the provider

### Shortcut

- **Ctrl+Shift+M** toggles the model selector

---

## API Key Management

### Opening the Modal

1. Click the **model selector dropdown** in the toolbar
2. Click **"Manage API Keys"** at the top of the dropdown
3. The API Key Management modal opens

### Adding a Key

1. Find the provider you want (e.g., OpenRouter)
2. Click **"Add Key"** next to it
3. Type or paste your API key in the password field
4. Press **Enter** or click **Save**
5. The status changes to **"Active"** with a masked preview of your key

### Updating a Key

1. Click **"Update"** next to the provider
2. Enter the new key
3. Click **Save**

### Removing a Key

1. Click **"Remove"** next to the provider
2. The key is deleted and the env var is cleared

### How It Works

- Keys are saved locally to `~/.claude/workspace-brain/keys/api_keys.json`
- Keys are automatically loaded into environment variables on app startup
- You **never need to open a terminal** to set API keys
- Keys are masked in the UI (only first/last 4 characters shown)

### Supported Providers

| Provider | Env Variable | Notes |
|----------|-------------|-------|
| DeepSeek | `DEEPSEEK_API_KEY` | Default provider |
| Anthropic Claude | `ANTHROPIC_API_KEY` | Claude models |
| OpenAI | `OPENAI_API_KEY` | GPT-4o models |
| OpenRouter | `OPENROUTER_API_KEY` | Access to Hermes, Llama, Mistral, and 100+ models |
| Nous Research | `NOUS_API_KEY` | Direct Hermes API |
| Tavily | `TAVILY_API_KEY` | Enhanced web search (optional) |

---

## Prompt Transformer (Auto-Enhance)

The prompt transformer automatically structures your raw messages before sending them to the AI, resulting in better responses.

### Toggle

- Look for the **sparkle icon** (✨) in the toolbar
- **Golden glow** = ON (default)
- Click to toggle off/on
- When ON, every message is auto-enhanced before sending

### How It Works

1. You type: `fix the login bug`
2. The transformer detects **Debug mode** from keywords ("fix", "bug")
3. Your prompt is structured into a proper debugging request with context
4. The enhanced version is sent to the AI

### Modes

The transformer auto-detects your intent:

| Mode | Triggers | What It Does |
|------|----------|-------------|
| **Debug** | fix, bug, error, crash, broken, not working | Structures as debugging task with steps |
| **Code Task** | write, create, implement, build, function, class | Structures as code generation request |
| **Analysis** | analyze, explain, compare, review, summarize | Structures as analytical request |
| **Creative** | write me a, draft, compose, story, email, blog | Structures as creative writing request |
| **Auto-Enhance** | (everything else) | General enhancement with context |
| **Raw** | (when transformer is OFF) | No transformation, sent as-is |

### Preview

1. Click the **eye icon** (👁) in the input area (appears when transformer is ON)
2. As you type, a preview panel shows the transformed version
3. Shows the detected mode badge (e.g., "DEBUG", "CODE TASK")
4. Shows if web search will be triggered

---

## Web Search

The web search feature automatically searches the internet when your prompt needs real-time information.

### Toggle

- Look for the **globe icon** (🌐) in the toolbar
- **Blue glow** = ON (default)
- Click to toggle off/on
- A spinner appears while searching

### Auto-Trigger

Web search activates automatically when your message contains keywords like:
- "search for", "look up", "find out", "google"
- "what's the latest", "current", "today", "2025", "2026"
- "news about", "recent", "up to date"
- "latest version", "how much does", "price of"
- "documentation for", "docs for", "how to install"
- "npm package", "library for", "tutorial for"

### Example

1. You type: `what's the latest version of React?`
2. Web search auto-triggers → searches DuckDuckGo
3. Results are formatted and prepended to your prompt
4. The AI gets both the search results AND your question
5. A results bar appears showing "Web results for: latest version of React"

### Search Providers

| Provider | API Key Needed? | Notes |
|----------|----------------|-------|
| **DuckDuckGo** | No (free) | Default, instant answers |
| **Tavily** | Yes (`TAVILY_API_KEY`) | Richer results, AI-optimized |
| **SearXNG** | No (self-hosted) | Needs `SEARXNG_URL` env var |

---

## File Attachments

### Attaching Files

1. Click the **paperclip icon** (📎) in the input area
2. Select files from your computer
3. Or **drag and drop** files directly onto the input area
4. File contents are included with your message

### Supported Types

- **Text files**: Contents are read and included inline
- **Images**: Shown as attachment references
- **Multiple files**: Attach several at once

---

## Streaming & Stop Generation

### Streaming Display

- Responses appear word-by-word in real time (like ChatGPT/Claude)
- A blinking cursor shows where text is being generated

### Stop Generation

- While a response is streaming, a **Stop** button appears
- Click it to immediately cancel the generation
- Partial response is kept

---

## Message Editing & Regeneration

### Edit a Message

1. Hover over any of your sent messages
2. Click the **Edit** button
3. Modify your message
4. Click **Save & Resend** — gets a new response

### Regenerate a Response

1. Hover over any AI response
2. Click the **Regenerate** (retry) button
3. Gets a fresh response to the same prompt

---

## Conversation Search

### Searching

1. Click the **search icon** (🔍) in the toolbar, or press **Ctrl+Shift+S**
2. Type your search query
3. Results show matching messages across all conversations
4. Click a result to jump to that session

---

## Session History

### Viewing Past Sessions

1. The **session sidebar** (left side) shows all past conversations
2. Each session shows: title, date, message count, model used
3. Click any session to restore it and continue the conversation

### Resuming a Session

- Click a past session → it loads the full conversation history
- New messages append to the same session (no splitting!)
- The correct model is restored automatically

### Deleting Sessions

- Click the delete button on any session to remove it

---

## Export Conversations

### How to Export

1. Click the **export button** in the toolbar, or press **Ctrl+Shift+E**
2. Choose format:
   - **Markdown** (.md) — human-readable
   - **JSON** (.json) — machine-readable, includes all metadata
3. File is saved to your computer

---

## System Prompt (Custom Instructions)

### Setting a System Prompt

1. Click the **gear icon** or press **Ctrl+,**
2. The Custom Instructions modal opens
3. Type your system prompt (e.g., "You are a senior Rust developer...")
4. Click **Save**
5. All future messages use this system prompt

---

## Multi-Agent System

Access via the **Agents** tab in the dashboard sidebar.

### Available Agents

| Agent | Role | Model |
|-------|------|-------|
| Coder | Code generation & review | Default |
| Reviewer | Code review & quality | Default |
| Architect | System design | Default |
| Tester | Test generation | Default |
| Documenter | Documentation | Default |
| **Hermes Reasoner** | Deep reasoning, chain-of-thought | Hermes 3 405B |
| **OpenClaw Coder** | Fast code generation | OpenChat 3.6 |
| **Hermes Analyst** | Data analysis, summarization | Hermes 3 70B |

### Creating Workflows

1. Go to **Agents** tab
2. Create a workflow with multiple steps
3. Assign agents to each step
4. Execute — agents work in sequence

---

## Provider Router

Access via the **Agents** tab → Provider section.

### Routing Strategies

- **Cost Optimized**: Picks cheapest model
- **Quality First**: Picks best model
- **Latency First**: Picks fastest model
- **Failover**: Falls back to next provider on error
- **Manual**: You choose

---

## Second Brain

Access via the **Brain** tab in the dashboard sidebar.

- **Session Summaries**: Auto-generated summaries of past sessions
- **Decisions**: Track important decisions with context and rationale
- **Semantic Search**: Search across all your accumulated knowledge

---

## Visual Memory Graphs

Access via the **Graphs** tab in the dashboard sidebar.

- **Relationship Graphs**: See connections between files, functions, concepts
- **Architecture Diagrams**: Auto-generated system architecture
- **Workflow DAGs**: Directed acyclic graphs of processes
- **Session Timelines**: Visual timeline of session events

---

## Token Optimizer

Access via the **Tokens** tab in the dashboard sidebar.

- **Budget Management**: Set monthly token budget
- **Usage Tracking**: See input/output tokens and costs
- **Cache System**: Automatic caching to reduce redundant API calls
- **Rolling Summaries**: Compress old context to save tokens

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+N** | New chat / restart session |
| **Ctrl+Shift+S** | Search conversations |
| **Ctrl+Shift+E** | Export conversation |
| **Ctrl+,** | Open settings / system prompt |
| **Ctrl+Shift+M** | Toggle model selector |
| **Escape** | Close any open modal/dropdown |
| **Enter** | Send message |
| **Shift+Enter** | New line in input |

---

## Theme

### Dark / Light Mode

- The app defaults to **dark mode**
- Toggle via the theme button in the toolbar
- Your preference persists across restarts (saved in localStorage)

---

## Troubleshooting

### "Couldn't find callback id" Warning

This is a harmless Tauri race condition that occurs when the app reloads while Rust async operations are running. Safe to ignore.

### Model Shows "unknown"

If you see "unknown" in the model indicator after restoring a session, the session was created before the model tracking fix. New sessions track the model correctly.

### API Key Not Working

1. Open **Manage API Keys** from the model dropdown
2. Check the key status is **"Active"**
3. Make sure you're using the correct key for the provider
4. Restart the app after adding a new key (keys load on startup)

### Web Search Not Triggering

- Check the globe icon is glowing blue (ON)
- Use keywords like "latest", "current", "search for" in your message
- DuckDuckGo provides instant answers only — for richer results, add a Tavily API key
