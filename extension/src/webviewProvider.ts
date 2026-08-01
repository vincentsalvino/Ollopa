import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import { SidecarManager } from './sidecarManager';
import * as tempWorkspace from './tempWorkspace';
import { execute, isKnownTool, type ToolCall, type ToolOutput } from './toolBridge';
import type { ProviderConfig, SidecarCredentials } from './secrets';

type WebviewInbound =
  | { type: 'chat:send'; text: string; mode: 'quick' | 'task' }
  | { type: 'task_accept'; taskId: string }
  | { type: 'task_reject'; taskId: string }
  | { type: 'plan_decision'; taskId: string; decision: 'approve' | 'reject'; comment?: string }
  | { type: 'task_cancel'; taskId: string }
  | { type: 'set_provider_mode'; forceDirect: boolean }
  | { type: 'chat:command'; command: string; args: string }
  | { type: 'list_commands' }
  | { type: 'install_plugin'; spec: string }
  | { type: 'uninstall_plugin'; name: string }
  | { type: 'list_installed_plugins' }
  | { type: 'export_skill'; name: string }
  | { type: 'import_skill'; json: string; path?: string }
  | { type: 'list_skills' };

type WebviewOutbound =
  | { type: 'sidecar:ready' }
  | { type: 'sidecar:closed' }
  | { type: 'sidecar:error'; message: string }
  | { type: 'chat:reply'; text: string; from: 'sidecar' }
  | { type: 'memory_result'; memories: unknown[]; source: 'cloud' | 'cache' }
  | { type: 'memory_error'; message: string }
  | { type: 'task_started'; taskId: string }
  | { type: 'agent_thought'; taskId: string; message: string; agent: 'implementation' | 'architect' | 'frontend' | 'backend' | 'review' }
  | { type: 'tool_call'; taskId: string; toolName: string; toolArgs: unknown; startedAt: number }
  | { type: 'tool_output'; taskId: string; toolName: string; output: string; kind: ToolOutput['kind']; durationMs?: number }
  | { type: 'task_final_diff'; taskId: string; diff: string }
  | { type: 'task_error'; taskId: string; message: string }
  | { type: 'task_complete'; taskId: string; status?: 'success' | 'failed' | 'cancelled' }
  | { type: 'task_applied'; taskId: string; applied: string[] }
  | { type: 'task_rejected'; taskId: string }
  | { type: 'plan_proposed'; taskId: string; contract: { goal: string; files: string[]; risks: string[]; suggestedRole: 'frontend' | 'backend' | 'implementation'; steps: string[]; scopeHash: string }; planText: string; agent: 'architect' }
  | { type: 'review_verdict'; taskId: string; verdict: 'PASS' | 'FAIL'; violated: string[]; feedback: string }
  | { type: 'provider_status'; forceDirect: boolean; omnirouteUp: boolean; omnirouteUrl: string | null; providerCount: number; keyPools?: Array<{ provider: string; current: number; total: number; cooldownUntil?: number }> }
  | { type: 'task_backend'; taskId: string; backend: { kind: 'omniroute' | 'direct'; provider?: string; model: string } }
  | { type: 'command_list'; commands: Array<{ name: string; description: string }> }
  | { type: 'command_result'; taskId: string; command: string; output: string; kind: 'info' | 'success' | 'warning' | 'error' }
  | { type: 'install_result'; ok: boolean; plugin?: { name: string; version: string; dir: string }; error?: string }
  | { type: 'uninstall_result'; ok: boolean; error?: string }
  | { type: 'installed_list'; plugins: Array<{ id: string; name: string; version: string; source: string; integrity: string; installedAt: string }> }
  | { type: 'export_skill_result'; ok: boolean; name?: string; json?: string; error?: string }
  | { type: 'import_skill_result'; ok: boolean; error?: string; path?: string }
  | { type: 'skills_list'; skills: Array<{ name: string; description: string; autoTrigger: boolean; prompt: string; origin: string }> }
  | { type: 'task_token_total'; taskId: string; agent: 'implementation' | 'architect' | 'frontend' | 'backend' | 'review'; total: number }
  | { type: 'focus_prompt' }
  | { type: 'privacy_status'; localOnly: boolean; redactSecrets: boolean };

/**
 * Hosts the Ollopa chat webview in the right-side panel of the workbench.
 * The HTML is loaded from the Vite build under `webview/dist/`. In dev we
 * fall back to the Vite dev server (http://localhost:5173) so HMR works.
 *
 * Phase 3: Quick Mode. The provider now:
 *   - Creates a temp workspace on each `chat:send { mode: 'quick' }`.
 *   - Forwards `tool_call` events from the sidecar to the in-process
 *     tool bridge, then sends `tool_output` back to the sidecar.
 *   - On `task_accept`/`task_reject`, applies the diff or discards.
 */
export class WebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'ollopa.chat';

  private view: vscode.WebviewView | undefined;
  private offSidecar: (() => void) | undefined;

  constructor(
    private readonly extensionPath: string,
    private readonly getSidecar: () => SidecarManager | undefined,
    private readonly getCredentials: () => SidecarCredentials | null,
    private readonly getProviderConfig: () => ProviderConfig | null = () => null,
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
      void this.handleFromWebview(msg);
    });

    this.bindSidecarEvents();

    if (this.getSidecar()?.isReady()) this.post({ type: 'sidecar:ready' });
  }

  private bindSidecarEvents(): void {
    this.offSidecar?.();
    this.offSidecar = undefined;
    const sidecar = this.getSidecar();
    if (!sidecar) return;
    this.offSidecar = sidecar.on((e) => {
      if (!this.view) return;
      if (e.type === 'status' && e.status === 'ready') {
        this.post({ type: 'sidecar:ready' });
      } else if (e.type === 'status' && e.status === 'closed') {
        this.post({ type: 'sidecar:closed' });
      } else if (e.type === 'status' && e.status === 'error') {
        this.post({ type: 'sidecar:error', message: e.message ?? 'unknown' });
      } else if (e.type === 'message') {
        void this.routeSidecarMessage(e.payload, sidecar);
      }
    });
    if (sidecar.isReady()) this.post({ type: 'sidecar:ready' });
  }

  private async routeSidecarMessage(payload: unknown, sidecar: SidecarManager): Promise<void> {
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
      case 'agent_thought': {
        const a = (p as any).agent;
        const agent = (a === 'architect' || a === 'frontend' || a === 'backend' || a === 'review')
          ? a
          : 'implementation';
        this.post({
          type: 'agent_thought',
          taskId: String((p as any).taskId ?? ''),
          message: String((p as any).message ?? ''),
          agent,
        });
        return;
      }
      case 'tool_call': {
        const taskId = String((p as any).taskId ?? '');
        const toolName = String((p as any).toolName ?? '');
        const toolArgs = (p as any).toolArgs ?? {};
        const startedAt = typeof (p as any).startedAt === 'number' ? (p as any).startedAt : Date.now();
        this.post({ type: 'tool_call', taskId, toolName, toolArgs, startedAt });
        if (!isKnownTool(toolName)) {
          sidecar.sendToolOutput(taskId, toolName, `unknown tool: ${toolName}`, 'error');
          return;
        }
        const call: ToolCall = { toolName, args: toolArgs as Record<string, unknown> };
        let out: ToolOutput;
        try { out = await execute(taskId, call); }
        catch (err) {
          out = { toolName, output: `bridge error: ${(err as Error).message}`, kind: 'error' };
        }
        const durationMs = Date.now() - startedAt;
        // Forward a copy of the tool_output to the webview so it can render
        // it under the tool_call card. The sidecar already got its copy via
        // sendToolOutput.
        this.post({ type: 'tool_output', taskId, toolName: out.toolName, output: out.output, kind: out.kind, durationMs });
        sidecar.sendToolOutput(taskId, out.toolName, out.output, out.kind);
        return;
      }
      case 'task_final_diff':
        this.post({ type: 'task_final_diff', taskId: String((p as any).taskId ?? ''), diff: String((p as any).diff ?? '') });
        return;
      case 'task_error':
        this.post({ type: 'task_error', taskId: String((p as any).taskId ?? ''), message: String((p as any).error ?? 'unknown') });
        return;
      case 'task_complete': {
        const s = (p as any).status;
        const status: 'success' | 'failed' | 'cancelled' | undefined =
          s === 'success' || s === 'failed' || s === 'cancelled' ? s : undefined;
        this.post({ type: 'task_complete', taskId: String((p as any).taskId ?? ''), status });
        return;
      }
      case 'plan_proposed': {
        const c = (p as any).contract;
        if (!c || typeof c !== 'object') return;
        this.post({
          type: 'plan_proposed',
          taskId: String((p as any).taskId ?? ''),
          contract: {
            goal: String(c.goal ?? ''),
            files: Array.isArray(c.files) ? c.files.map(String) : [],
            risks: Array.isArray(c.risks) ? c.risks.map(String) : [],
            suggestedRole: (c.suggestedRole === 'frontend' || c.suggestedRole === 'backend' || c.suggestedRole === 'implementation')
              ? c.suggestedRole
              : 'implementation',
            steps: Array.isArray(c.steps) ? c.steps.map(String) : [],
            scopeHash: String(c.scopeHash ?? ''),
          },
          planText: String((p as any).planText ?? ''),
          agent: 'architect',
        });
        return;
      }
      case 'review_verdict': {
        this.post({
          type: 'review_verdict',
          taskId: String((p as any).taskId ?? ''),
          verdict: (p as any).verdict === 'PASS' ? 'PASS' : 'FAIL',
          violated: Array.isArray((p as any).violated) ? ((p as any).violated as unknown[]).map(String) : [],
          feedback: String((p as any).feedback ?? ''),
        });
        return;
      }
      case 'tool_output': {
        // Plugin tool ran in-process on the sidecar and streamed the result
        // as an event. The sidecar did NOT send this to the bridge via
        // sendToolOutput (there is no awaiter), so we forward it to the
        // webview so the user sees the output under the tool card.
        this.post({
          type: 'tool_output',
          taskId: String((p as any).taskId ?? ''),
          toolName: String((p as any).toolName ?? ''),
          output: String((p as any).output ?? ''),
          kind: ((p as any).outputKind ?? 'terminal') as ToolOutput['kind'],
        });
        return;
      }
      case 'command_list': {
        const cmds = Array.isArray((p as any).commands) ? (p as any).commands : [];
        this.post({ type: 'command_list', commands: cmds });
        return;
      }
      case 'command_result': {
        this.post({
          type: 'command_result',
          taskId: String((p as any).taskId ?? ''),
          command: String((p as any).command ?? ''),
          output: String((p as any).output ?? ''),
          kind: ((p as any).kind_ ?? 'info') as 'info' | 'success' | 'warning' | 'error',
        });
        return;
      }
      case 'task_backend': {
        const b = (p as any).backend;
        if (!b || typeof b !== 'object') return;
        this.post({
          type: 'task_backend',
          taskId: String((p as any).taskId ?? ''),
          backend: {
            kind: b.kind === 'direct' ? 'direct' : 'omniroute',
            provider: typeof b.provider === 'string' ? b.provider : undefined,
            model: String(b.model ?? ''),
          },
        });
        return;
      }
      case 'install_result': {
        this.post({
          type: 'install_result',
          ok: Boolean((p as any).ok),
          plugin: (p as any).plugin,
          error: typeof (p as any).error === 'string' ? (p as any).error : undefined,
        });
        return;
      }
      case 'uninstall_result': {
        this.post({
          type: 'uninstall_result',
          ok: Boolean((p as any).ok),
          error: typeof (p as any).error === 'string' ? (p as any).error : undefined,
        });
        return;
      }
      case 'installed_list': {
        this.post({ type: 'installed_list', plugins: Array.isArray((p as any).plugins) ? (p as any).plugins : [] });
        return;
      }
      case 'export_skill_result': {
        this.post({
          type: 'export_skill_result',
          ok: Boolean((p as any).ok),
          name: typeof (p as any).name === 'string' ? (p as any).name : undefined,
          json: typeof (p as any).json === 'string' ? (p as any).json : undefined,
          error: typeof (p as any).error === 'string' ? (p as any).error : undefined,
        });
        return;
      }
      case 'import_skill_result': {
        this.post({
          type: 'import_skill_result',
          ok: Boolean((p as any).ok),
          error: typeof (p as any).error === 'string' ? (p as any).error : undefined,
          path: typeof (p as any).path === 'string' ? (p as any).path : undefined,
        });
        return;
      }
      case 'skills_list': {
        const raw = Array.isArray((p as any).skills) ? (p as any).skills : [];
        this.post({
          type: 'skills_list',
          skills: raw.map((x: any) => ({
            name: String(x.name ?? ''),
            description: String(x.description ?? ''),
            autoTrigger: x.autoTrigger !== false,
            prompt: String(x.prompt ?? ''),
            origin: String(x.origin ?? ''),
          })),
        });
        return;
      }
      case 'task_token_total': {
        this.post({
          type: 'task_token_total',
          taskId: String((p as any).taskId ?? ''),
          agent: (['implementation', 'architect', 'frontend', 'backend', 'review'] as const).includes((p as any).agent)
            ? (p as any).agent
            : 'implementation',
          total: typeof (p as any).total === 'number' ? (p as any).total : 0,
        });
        return;
      }
      case 'privacy_status': {
        this.post({
          type: 'privacy_status',
          localOnly: Boolean((p as any).localOnly),
          redactSecrets: Boolean((p as any).redactSecrets),
        });
        return;
      }
    }
  }

  reveal(): void {
    void vscode.commands.executeCommand('workbench.view.ollopa');
  }

  rebind(): void {
    this.bindSidecarEvents();
  }

  postProviderStatus(cfg: ProviderConfig | null, opts: { omnirouteUp?: boolean } = {}): void {
    const omnirouteUrl = cfg?.omnirouteUrl ?? null;
    const enabledProviders = (cfg?.directProviders ?? []).filter((p) => p.enabled);
    // Phase 8: surface pool metadata so the chip can render [n/total].
    // The extension doesn't own the cursor — it just declares how many keys
    // are configured. The webview can use the `keyIndex` field from
    // `task_backend` events for the live cursor.
    const keyPools = (cfg?.directProviders ?? [])
      .filter((p) => p.keys && p.keys.length > 0)
      .map((p) => ({
        provider: p.name,
        current: 0,
        total: p.keys!.length,
      }));
    this.post({
      type: 'provider_status',
      forceDirect: cfg?.forceDirect ?? false,
      omnirouteUp: opts.omnirouteUp ?? false,
      omnirouteUrl,
      providerCount: enabledProviders.length,
      keyPools,
    });
  }

  private async handleFromWebview(msg: WebviewInbound): Promise<void> {
    const sidecar = this.getSidecar();
    if (msg.type === 'chat:send') {
      if (!this.getCredentials()?.openRouterKey) {
        this.post({ type: 'task_error', taskId: '', message: 'OpenRouter API key not configured. Run "Ollopa: Configure".' });
        return;
      }
      if (!sidecar?.isReady()) {
        this.post({ type: 'task_error', taskId: '', message: 'Sidecar not ready. Run "Ollopa: Configure" if you have not yet set credentials.' });
        return;
      }
      if (msg.mode !== 'quick' && msg.mode !== 'task') {
        this.post({ type: 'task_error', taskId: '', message: `Mode "${msg.mode}" is not implemented in this build.` });
        return;
      }
      const taskId = randomUUID();
      const workspaceRoot = this.resolveWorkspaceRoot();
      if (!workspaceRoot) {
        this.post({ type: 'task_error', taskId, message: 'No workspace root configured. Set ollopa.workspaceRoot in settings or open a folder.' });
        return;
      }
      let tempPath: string | undefined;
      try {
        const ctx = await tempWorkspace.create(workspaceRoot, taskId);
        tempPath = ctx.tempPath;
      } catch (err) {
        this.post({ type: 'task_error', taskId, message: `Could not create temp workspace: ${(err as Error).message}` });
        return;
      }
      this.post({ type: 'task_started', taskId });
      const payload: Record<string, unknown> = { kind: 'chat:send', mode: msg.mode, text: msg.text, taskId };
      if (tempPath) payload.tempWorkspace = tempPath;
      sidecar.send(payload);
      return;
    }
    if (msg.type === 'plan_decision') {
      sidecar?.send({ kind: 'plan_decision', taskId: msg.taskId, decision: msg.decision, comment: msg.comment });
      return;
    }
    if (msg.type === 'task_cancel') {
      sidecar?.send({ kind: 'task_cancel', taskId: msg.taskId });
      // Phase 8: also reap the temp workspace. The sidecar's cancel handler
      // aborts the running graph, but the temp dir is owned by the extension.
      void tempWorkspace.cleanup(msg.taskId).catch(() => { /* best-effort */ });
      return;
    }
    if (msg.type === 'chat:command') {
      if (!sidecar?.isReady()) {
        this.post({ type: 'command_result', taskId: '', command: msg.command, output: 'Sidecar not ready.', kind: 'error' });
        return;
      }
      const taskId = randomUUID();
      const payload: Record<string, unknown> = { kind: 'chat:command', command: msg.command, args: msg.args, taskId };
      const tempRoot = this.mostRecentTempRoot();
      if (tempRoot) payload.tempWorkspace = tempRoot;
      sidecar.send(payload);
      return;
    }
    if (msg.type === 'list_commands') {
      sidecar?.send({ kind: 'list_commands' });
      return;
    }
    if (msg.type === 'install_plugin') {
      sidecar?.send({ kind: 'install_plugin', spec: msg.spec });
      return;
    }
    if (msg.type === 'uninstall_plugin') {
      sidecar?.send({ kind: 'uninstall_plugin', name: msg.name });
      return;
    }
if (msg.type === 'list_installed_plugins') {
      sidecar?.send({ kind: 'list_installed_plugins' });
      return;
    }
    if (msg.type === 'export_skill') {
      sidecar?.send({ kind: 'export_skill', name: msg.name });
      return;
    }
    if (msg.type === 'import_skill') {
      if (msg.path) sidecar?.send({ kind: 'import_skill', path: msg.path });
      else sidecar?.send({ kind: 'import_skill', json: msg.json });
      return;
    }
    if (msg.type === 'list_skills') {
      sidecar?.send({ kind: 'list_skills' });
      return;
    }
    if (msg.type === 'task_accept') {
      const ctx = tempWorkspace.getContext(msg.taskId);
      if (!ctx) {
        this.post({ type: 'task_error', taskId: msg.taskId, message: 'No temp workspace for this task.' });
        return;
      }
      try {
        const applied = await tempWorkspace.apply(ctx);
        await tempWorkspace.cleanup(msg.taskId);
        this.post({ type: 'task_applied', taskId: msg.taskId, applied });
      } catch (err) {
        this.post({ type: 'task_error', taskId: msg.taskId, message: `Apply failed: ${(err as Error).message}` });
      }
      return;
    }
    if (msg.type === 'task_reject') {
      await tempWorkspace.cleanup(msg.taskId);
      this.post({ type: 'task_rejected', taskId: msg.taskId });
      return;
    }
    if (msg.type === 'set_provider_mode') {
      const cfg = vscode.workspace.getConfiguration('ollopa');
      await cfg.update('forceDirect', msg.forceDirect, vscode.ConfigurationTarget.Global);
      // The configuration listener in extension.ts picks this up and rebinds.
      return;
    }
  }

  private resolveWorkspaceRoot(): string | null {
    const fromConfig = vscode.workspace.getConfiguration('ollopa').get<string>('workspaceRoot');
    if (fromConfig && fromConfig.trim().length > 0) return fromConfig.trim();
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder?.uri.fsPath ?? null;
  }

  /**
   * Best-effort: pick a temp workspace root to give a slash command access
   * to. The most recent task's temp root is the right default — slash
   * commands usually act on whatever the user is currently editing. If no
   * task has run yet, return undefined and the sidecar will see null ctx.
   */
  private mostRecentTempRoot(): string | undefined {
    const tasks = tempWorkspace.listContexts();
    if (tasks.length === 0) return undefined;
    return tasks[tasks.length - 1].tempPath;
  }

  post(msg: WebviewOutbound): void {
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
          content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="${cssUri}" />
    <title>Ollopa</title>
  </head>
  <body style="margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);">
    <div id="root" style="width:100%;height:100%;"></div>
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
