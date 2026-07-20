import * as vscode from 'vscode';
import { SidecarManager } from './sidecarManager';
import { WebviewProvider } from './webviewProvider';
import { SECRET_KEYS, readSidecarCredentials, type SidecarCredentials } from './secrets';

let sidecar: SidecarManager | undefined;
let webview: WebviewProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Eagerly build the webview so it's ready the moment the user opens it.
  webview = new WebviewProvider(context.extensionPath, /* sidecar getter */ () => sidecar);
  context.subscriptions.push(
    webview,
    vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, webview, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('ollopa.openPanel', () => webview?.reveal()),
    vscode.commands.registerCommand('ollopa.configure', () => configureCommand(context)),
  );

  // Boot the sidecar in the background. Don't block activation on it.
  void bootSidecar(context);
}

export function deactivate(): void {
  sidecar?.dispose();
}

async function bootSidecar(context: vscode.ExtensionContext): Promise<void> {
  const creds = await readSidecarCredentials(context.secrets);
  if (!creds) {
    // No credentials yet. SidecarManager can still be constructed but will
    // boot without secrets; the webview will show a configure prompt.
    sidecar = new SidecarManager(context.extensionPath, null);
  } else {
    sidecar = new SidecarManager(context.extensionPath, creds);
  }
  context.subscriptions.push(sidecar);

  try {
    await sidecar.start();
  } catch (err) {
    void vscode.window.showErrorMessage(`Ollopa sidecar failed to start: ${(err as Error).message}`);
  }
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

  // Restart the sidecar with fresh credentials.
  sidecar?.dispose();
  sidecar = new SidecarManager(context.extensionPath, {
    supabaseUrl: url.trim(),
    supabaseServiceKey: serviceKey.trim(),
    openRouterKey: openRouter.trim(),
  });
  context.subscriptions.push(sidecar);
  try {
    await sidecar.start();
  } catch (err) {
    void vscode.window.showErrorMessage(`Ollopa sidecar failed to start: ${(err as Error).message}`);
  }
  return { supabaseUrl: url.trim(), supabaseServiceKey: serviceKey.trim(), openRouterKey: openRouter.trim() };
}
