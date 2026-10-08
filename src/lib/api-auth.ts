import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

/**
 * Verify the caller's Supabase JWT from the Authorization header and return
 * a user-scoped client (RLS applies). Client pages must send:
 *   Authorization: Bearer <session.access_token>
 */
export async function requireApiUser(req: Request): Promise<{
  user: User;
  supabase: SupabaseClient;
}> {
  const authHeader = req.headers.get("authorization") || "";
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { global: { headers: { Authorization: authHeader } } }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const err = new Error("Not signed in") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return { user, supabase };
}
