import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { SidecarManager } from './sidecarManager';

type WebviewInbound =
  | { type: 'chat:send'; text: string }
  | { type: 'memory_query'; query: string; scope: string; agent: string; taskId: string };

type WebviewOutbound =
  | { type: 'sidecar:ready' }
  | { type: 'sidecar:closed' }
  | { type: 'sidecar:error'; message: string }
  | { type: 'chat:reply'; text: string; from: 'sidecar' }
  | { type: 'memory_result'; memories: unknown[]; source: 'cloud' | 'cache' }
  | { type: 'memory_error'; message: string };

/**
 * Hosts the Ollopa chat webview in the right-side panel of the workbench.
 * The HTML is loaded from the Vite build under `webview/dist/`. In dev we
 * fall back to the Vite dev server (http://localhost:5173) so HMR works.
 *
 * Phase 2: also bridges `memory_query` requests. The sidecar responds with
 * `{ kind: 'memory_result', memories, source }` or `{ kind: 'memory_error' }`.
 */
export class WebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'ollopa.chat';

  private view: vscode.WebviewView | undefined;
  private offSidecar: (() => void) | undefined;
  private subscribedSidecar: SidecarManager | undefined;

  constructor(
    private readonly extensionPath: string,
    private readonly getSidecar: () => SidecarManager | undefined,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(this.assetRoot()),
        vscode.Uri.parse('http://localhost:5173'),
      ],
    };
    webviewView.webview.html = this.htmlFor(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: WebviewInbound) => {
      this.handleFromWebview(msg);
    });

    this.bindSidecarEvents();

    // If a sidecar is already up at resolve-time, announce it now.
    if (this.getSidecar()?.isReady()) this.post({ type: 'sidecar:ready' });
  }

  /**
   * (Re)subscribe to the current sidecar instance. Called on view resolve and
   * after the extension swaps the sidecar on `ollopa.configure` (reboot).
   */
  private bindSidecarEvents(): void {
    this.offSidecar?.();
    this.offSidecar = undefined;
    const sidecar = this.getSidecar();
    if (!sidecar) return;
    this.subscribedSidecar = sidecar;
    this.offSidecar = sidecar.on((e) => {
      if (!this.view) return;
      if (e.type === 'status' && e.status === 'ready') {
        this.post({ type: 'sidecar:ready' });
      } else if (e.type === 'status' && e.status === 'closed') {
        this.post({ type: 'sidecar:closed' });
      } else if (e.type === 'status' && e.status === 'error') {
        this.post({ type: 'sidecar:error', message: e.message ?? 'unknown' });
      } else if (e.type === 'message') {
        this.routeSidecarMessage(e.payload);
      }
    });
    if (sidecar.isReady()) this.post({ type: 'sidecar:ready' });
  }

  private routeSidecarMessage(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as { kind?: string; [k: string]: unknown };
    switch (p.kind) {
      case 'echo':
        if (typeof (p as any).text === 'string') {
          this.post({ type: 'chat:reply', text: (p as any).text, from: 'sidecar' });
        }
        return;
      case 'memory_result': {
        const source = p.source === 'cache' ? 'cache' : 'cloud';
        const memories = Array.isArray(p.memories) ? p.memories : [];
        this.post({ type: 'memory_result', memories, source });
        return;
      }
      case 'memory_error':
        this.post({ type: 'memory_error', message: String((p as any).message ?? 'unknown error') });
        return;
    }
  }

  reveal(): void {
    // `workbench.view.ollopa` is contributed by the manifest.
    void vscode.commands.executeCommand('workbench.view.ollopa');
  }

  /** Re-bind to the current sidecar after a restart (e.g. after configure). */
  rebind(): void {
    this.bindSidecarEvents();
  }

  private handleFromWebview(msg: WebviewInbound): void {
    const sidecar = this.getSidecar();
    if (msg.type === 'chat:send') {
      if (!sidecar?.isReady()) {
        this.post({ type: 'chat:reply', text: '[sidecar not ready]', from: 'sidecar' });
        return;
      }
      sidecar.send({ kind: 'echo', text: msg.text });
      return;
    }
    if (msg.type === 'memory_query') {
      if (!sidecar?.isReady()) {
        this.post({ type: 'memory_error', message: 'Sidecar not ready. Run "Ollopa: Configure" if you have not yet set credentials.' });
        return;
      }
      sidecar.send({
        kind: 'memory_query',
        query: msg.query,
        scope: msg.scope,
        agent: msg.agent,
        taskId: msg.taskId,
      });
    }
  }

  private post(msg: WebviewOutbound): void {
    this.view?.webview.postMessage(msg);
  }

  private assetRoot(): string {
    return `${this.extensionPath}/webview/dist`;
  }

  private htmlFor(webview: vscode.Webview): string {
    const devServer = process.env.OLLOPA_WEBVIEW_DEV === '1';
    if (devServer) return devHtml();
    const dist = this.assetRoot();
    const indexJs = vscode.Uri.file(`${dist}/assets/index.js`);
    const indexCss = vscode.Uri.file(`${dist}/assets/index.css`);
    const scriptUri = webview.asWebviewUri(indexJs);
    const cssUri = webview.asWebviewUri(indexCss);
    const nonce = randomNonce();
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="${cssUri}" />
    <title>Ollopa</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  dispose(): void {
    this.offSidecar?.();
    this.offSidecar = undefined;
  }
}

function randomNonce(): string {
  return randomBytes(16).toString('hex');
}

function devHtml(): string {
  const nonce = randomNonce();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${'' /* dev */}; script-src http://localhost:5173 'nonce-${nonce}'; connect-src http://localhost:5173 ws://localhost:5173;" />
    <title>Ollopa (dev)</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="http://localhost:5173/src/main.tsx"></script>
  </body>
</html>`;
}
