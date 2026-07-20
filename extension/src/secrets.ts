/**
 * Secret names stored in VS Code's SecretStorage. Kept here so the
 * `ollopa.configure` command and the sidecar launcher use the same keys.
 */
import * as vscode from 'vscode';

export const SECRET_KEYS = {
  supabaseUrl: 'ollopa.supabaseUrl',
  supabaseServiceKey: 'ollopa.supabaseServiceKey',
  openRouterKey: 'ollopa.openRouterKey',
} as const;

export interface SidecarCredentials {
  supabaseUrl: string;
  supabaseServiceKey: string;
  openRouterKey: string;
}

export async function readSidecarCredentials(
  secrets: vscode.SecretStorage,
): Promise<SidecarCredentials | null> {
  const [url, serviceKey, openRouter] = await Promise.all([
    secrets.get(SECRET_KEYS.supabaseUrl),
    secrets.get(SECRET_KEYS.supabaseServiceKey),
    secrets.get(SECRET_KEYS.openRouterKey),
  ]);
  if (!url || !serviceKey) return null;
  return { supabaseUrl: url, supabaseServiceKey: serviceKey, openRouterKey: openRouter ?? '' };
}
