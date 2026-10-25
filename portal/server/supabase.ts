import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './env.ts';

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Bypasses row level security. Use only for invitations, sign-in links, signed URLs, notifications and scheduled jobs. */
export function serviceClient(): SupabaseClient {
  const c = config();
  return createClient(c.supabaseUrl, c.serviceKey, opts);
}

/** Unauthenticated client, used to verify sign-in links and refresh sessions. */
export function anonClient(): SupabaseClient {
  const c = config();
  return createClient(c.supabaseUrl, c.anonKey, opts);
}

/** Queries as the signed-in user, so every row level security policy applies. */
export function userClient(accessToken: string): SupabaseClient {
  const c = config();
  return createClient(c.supabaseUrl, c.anonKey, { ...opts, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
}
