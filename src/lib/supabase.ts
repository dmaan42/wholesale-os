import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Lazily-created Supabase client. Throws a clear error if env vars are missing.
 * Lazy so that pages which don't need auth (e.g. the marketing landing page)
 * and `next build` prerendering never crash when env vars aren't set.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  cached = createClient(url, anonKey);
  return cached;
}
