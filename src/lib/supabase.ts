import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Singleton Supabase client for server-side use.
 *
 * Uses service role key to bypass RLS — never expose this to the browser.
 * Auth is handled by our own API key system (cos_ prefix, SHA-256 hashed).
 * We do NOT use Supabase Auth, so @supabase/ssr is not needed.
 */

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) {
    return client;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}

export default getSupabase;
