import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'node:child_process';
import { SidecarManager } from './sidecarManager';
import { WebviewProvider } from './webviewProvider';
import {
  SECRET_KEYS,
  readSidecarCredentials,
  readProviderConfig,
  type SidecarCredentials,
  type ProviderConfig,
} from './secrets';
import * as tempWorkspace from './tempWorkspace';

let sidecar: SidecarManager | undefined;
let webview: WebviewProvider | undefined;
let cachedCredentials: SidecarCredentials | null = null;
let cachedProviderConfig: ProviderConfig | null = null;
let omnirouteProcess: ChildProcess | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  cachedCredentials = await readSidecarCredentials(context.secrets);
  cachedProviderConfig = await readProviderConfig(
    context.secrets,
    vscode.workspace.getConfiguration('ollopa'),
  );

  webview = new WebviewProvider(
    context.extensionPath,
    () => sidecar,
    () => cachedCredentials,
    () => cachedProviderConfig,
  );
  context.subscriptions.push(
    webview,
    vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, webview, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('ollopa.openPanel', () => webview?.reveal()),
    vscode.commands.registerCommand('ollopa.configure', () => configureCommand(context)),
    vscode.commands.registerCommand('ollopa.startOmniRoute', () => startOmniRoute(context)),
    vscode.commands.registerCommand('ollopa.addProviderKey', () => addProviderKeyCommand(context)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('ollopa.omnirouteUrl')
        && !e.affectsConfiguration('ollopa.forceDirect')
        && !e.affectsConfiguration('ollopa.directProviders')) return;
      void rebindProviderConfig(context);
    }),
    { dispose: () => tempWorkspace.cleanupAll() },
  );

  void bootSidecar(context);
  void pingOmniRouteAndNotify();
}

export function deactivate(): void {
  sidecar?.dispose();
  omnirouteProcess?.kill();
}

async function bootSidecar(context: vscode.ExtensionContext): Promise<void> {
  sidecar = new SidecarManager(context.extensionPath, cachedCredentials, cachedProviderConfig);
  context.subscriptions.push(sidecar);

  try {
    await sidecar.start();
  } catch (err) {
    void vscode.window.showErrorMessage(`Ollopa sidecar failed to start: ${(err as Error).message}`);
  }
}

async function rebindProviderConfig(context: vscode.ExtensionContext): Promise<void> {
  cachedProviderConfig = await readProviderConfig(
    context.secrets,
    vscode.workspace.getConfiguration('ollopa'),
  );
  sidecar?.dispose();
  await bootSidecar(context);
  webview?.rebind();
  webview?.postProviderStatus(cachedProviderConfig);
  void pingOmniRouteAndNotify();
}

/** Quick probe used to drive the UI's "OmniRoute · up/down" chip. */
async function pingOmniRouteAndNotify(): Promise<void> {
  const url = cachedProviderConfig?.omnirouteUrl;
  let up = false;
  if (url) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${url.replace(/\/+$/, '')}/v1/models`, { method: 'GET', signal: ctrl.signal });
      clearTimeout(t);
      up = res.ok;
    } catch { up = false; }
  }
  webview?.postProviderStatus(cachedProviderConfig, { omnirouteUp: up });
}

async function startOmniRoute(context: vscode.ExtensionContext): Promise<void> {
  if (omnirouteProcess) {
    void vscode.window.showInformationMessage('OmniRoute is already running (managed by Ollopa).');
    return;
  }
  let cmd = 'npx';
  let args = ['omniroute'];
  if (process.platform === 'win32') {
    cmd = 'npx.cmd';
  }
  try {
    omnirouteProcess = spawn(cmd, args, {
      cwd: context.extensionPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not spawn OmniRoute: ${(err as Error).message}`);
    return;
  }
  omnirouteProcess.on('exit', (code: number | null) => {
    void vscode.window.showWarningMessage(`OmniRoute exited (code ${code ?? 'null'}). Configure a direct provider as fallback.`);
    omnirouteProcess = undefined;
    void pingOmniRouteAndNotify();
  });
  void vscode.window.showInformationMessage('OmniRoute started. Waiting for it to be healthy…');
  // Poll briefly so the UI flips to "up" without a full settings change.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    if (omnirouteProcess && !omnirouteProcess.killed) await pingOmniRouteAndNotify();
    else break;
  }
}

async function addProviderKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  const alias = await vscode.window.showInputBox({
    title: 'Ollopa: Add Provider API Key',
    prompt: 'Alias for this key (matches keyAlias in ollopa.directProviders).',
    placeHolder: 'deepseek_key1',
    ignoreFocusOut: true,
  });
  if (!alias) return;
  const key = await vscode.window.showInputBox({
    title: `Ollopa: API Key for "${alias}"`,
    prompt: 'Stored in OS keychain.',
    password: true,
    ignoreFocusOut: true,
  });
  if (!key) return;
  await context.secrets.store(`ollopa.providerKey.${alias}`, key.trim());
  void vscode.window.showInformationMessage(`Saved provider key "${alias}".`);
  await rebindProviderConfig(context);
}

async function configureCommand(context: vscode.ExtensionContext): Promise<SidecarCredentials | undefined> {
  const existing = await readSidecarCredentials(context.secrets);

  const url = await vscode.window.showInputBox({
    title: 'Ollopa: Configure — Supabase URL',
    prompt: 'Your Supabase project URL (https://<id>.supabase.co)',
    value: existing?.supabaseUrl ?? 'https://',
    ignoreFocusOut: true,
    validateInput: (v) => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(v.trim()) ? null : 'Must be a Supabase URL',
  });
  if (url === undefined) return undefined; // user cancelled

  const serviceKey = await vscode.window.showInputBox({
    title: 'Ollopa: Configure — Supabase Service Key',
    prompt: 'The service_role JWT (or sb_secret_…) for the project. Stored in OS keychain.',
    value: existing?.supabaseServiceKey ?? '',
    password: true,
    ignoreFocusOut: true,
  });
  if (serviceKey === undefined) return undefined;

  const openRouter = await vscode.window.showInputBox({
    title: 'Ollopa: Configure — OpenRouter API Key',
    prompt: 'For text-embedding-3-small. Optional for offline-only use.',
    value: existing?.openRouterKey ?? '',
    password: true,
    ignoreFocusOut: true,
  });
  if (openRouter === undefined) return undefined;

  await Promise.all([
    context.secrets.store(SECRET_KEYS.supabaseUrl, url.trim()),
    context.secrets.store(SECRET_KEYS.supabaseServiceKey, serviceKey.trim()),
    context.secrets.store(SECRET_KEYS.openRouterKey, openRouter.trim()),
  ]);

  void vscode.window.showInformationMessage('Ollopa credentials saved. Restarting sidecar…');

  // Refresh cached credentials and restart the sidecar.
  cachedCredentials = { supabaseUrl: url.trim(), supabaseServiceKey: serviceKey.trim(), openRouterKey: openRouter.trim() };
  sidecar?.dispose();
  await bootSidecar(context);
  webview?.rebind();
  webview?.postProviderStatus(cachedProviderConfig);
  return cachedCredentials;
}
