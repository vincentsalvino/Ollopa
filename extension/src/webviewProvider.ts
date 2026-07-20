import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { SidecarManager } from './sidecarManager';

type WebviewInbound =
  | { type: 'chat:send'; text: string };

type WebviewOutbound =
  | { type: 'sidecar:ready' }
  | { type: 'sidecar:closed' }
  | { type: 'sidecar:error'; message: string }
  | { type: 'chat:reply'; text: string; from: 'sidecar' };

/**
 * Hosts the Ollopa chat webview in the right-side panel of the workbench.
 * The HTML is loaded from the Vite build under `webview/dist/`. In dev we
 * fall back to the Vite dev server (http://localhost:5173) so HMR works.
 */
export class WebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'ollopa.chat';

  private view: vscode.WebviewView | undefined;
  private offSidecar: (() => void) | undefined;

  constructor(
    private readonly extensionPath: string,
    private readonly sidecar: SidecarManager,
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

    // Forward sidecar events → webview.
    this.offSidecar?.();
    this.offSidecar = this.sidecar.on((e) => {
      if (!this.view) return;
      if (e.type === 'status' && e.status === 'ready') {
        this.post({ type: 'sidecar:ready' });
      } else if (e.type === 'status' && e.status === 'closed') {
        this.post({ type: 'sidecar:closed' });
      } else if (e.type === 'status' && e.status === 'error') {
        this.post({ type: 'sidecar:error', message: e.message ?? 'unknown' });
      } else if (e.type === 'message') {
        // Phase 1 contract: sidecar echoes { kind: 'echo', text } back.
        const p = e.payload as { kind?: string; text?: string } | undefined;
        if (p && p.kind === 'echo' && typeof p.text === 'string') {
          this.post({ type: 'chat:reply', text: p.text, from: 'sidecar' });
        }
      }
    });

    // If the sidecar is already up at resolve-time, announce it now.
    if (this.sidecar.isReady()) this.post({ type: 'sidecar:ready' });
  }

  reveal(): void {
    // `workbench.view.ollopa` is contributed by the manifest; if missing, the
    // command still runs but no panel pops. Phase 1 ships the manifest below.
    vscode.commands.executeCommand('workbench.view.ollopa');
  }

  private handleFromWebview(msg: WebviewInbound): void {
    if (msg.type === 'chat:send') {
      if (!this.sidecar.isReady()) {
        this.post({ type: 'chat:reply', text: '[sidecar not ready]', from: 'sidecar' });
        return;
      }
      this.sidecar.send({ kind: 'echo', text: msg.text });
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
    if (devServer) {
      return devHtml();
    }
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
