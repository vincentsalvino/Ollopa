/**
 * Credential resolution.
 *
 * Two sources, in priority order:
 *   1. Process env (set by the VS Code extension host from SecretStorage).
 *   2. A `.env` file in the sidecar/ directory, loaded via dotenv. Used when
 *      the sidecar is started standalone (e.g. `npm run dev:sidecar`).
 *
 * Returns `null` for any key that isn't available. Callers decide whether
 * missing keys are fatal (memory service) or a soft degradation (sidecar can
 * still echo even without Supabase).
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

let dotenvLoaded = false;
function ensureDotenv(): void {
  if (dotenvLoaded) return;
  // dist/credentials.js → ../.env ; src/credentials.ts → ../.env
  const here = __dirname;
  const envPath = path.resolve(here, '..', '.env');
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath, quiet: true });
  }
  dotenvLoaded = true;
}

export interface Credentials {
  supabaseUrl: string | null;
  supabaseServiceKey: string | null;
  openRouterKey: string | null;
}

export function loadCredentials(): Credentials {
  ensureDotenv();
  return {
    supabaseUrl: process.env.SUPABASE_URL ?? null,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY ?? null,
    openRouterKey: process.env.OPENROUTER_API_KEY ?? null,
  };
}

export function hasSupabase(
  c: Credentials,
): c is { supabaseUrl: string; supabaseServiceKey: string; openRouterKey: string | null } {
  return c.supabaseUrl !== null && c.supabaseServiceKey !== null;
}
