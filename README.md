# Ollopa

Local-first, multi-agent AI coding assistant for VS Code.

## Status

**Phase 1 (Scaffold & Sidecar Bridge)** — complete.

- [x] VS Code extension scaffold
- [x] React + Vite webview with chat layout
- [x] Sidecar Node.js process (WebSocket server)
- [x] Extension ↔ webview ↔ sidecar message bridge
- [x] Echo roundtrip milestone

## Layout

```
ollopa/
├── package.json           # workspaces
├── extension/             # VS Code extension host
│   ├── src/
│   │   ├── extension.ts          # activation entry
│   │   ├── sidecarManager.ts     # spawns sidecar, owns WS client
│   │   └── webviewProvider.ts    # hosts webview, bridges messages
│   └── resources/icon.svg
├── webview/               # React + Vite UI
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       └── styles.css
└── sidecar/               # Node.js sidecar (Phase 1: echo)
    └── src/start.ts
```

## Build

```bash
npm install
npm run build          # builds webview → sidecar → extension
```

## Run in VS Code

1. Open this folder in VS Code.
2. Press F5 (Run > Start Debugging) to launch an Extension Development Host.
3. Click the Ollopa icon in the activity bar.
4. Type a message and press Enter. The sidecar echoes it back.

## Dev loop (webview HMR)

```bash
# Terminal 1
npm run dev:webview

# Terminal 2 — set OLLOPA_WEBVIEW_DEV=1 so the extension loads the dev server
# (then launch VS Code with the extension as usual).
OLLOPA_WEBVIEW_DEV=1 code .
```
