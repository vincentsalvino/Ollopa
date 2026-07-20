/**
 * Supabase client (sidecar-side).
 *
 * The `auth: { persistSession: false }` flag is mandatory for a server-side
 * client: there's no browser to persist into, and persistence would attempt
 * writes to a location that doesn't exist.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

export function initSupabase(url: string, serviceKey: string): void {
  if (client) return;
  client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getSupabase(): SupabaseClient {
  if (!client) throw new Error('Supabase not initialised');
  return client;
}

export function hasSupabase(): boolean {
  return client !== undefined;
}
