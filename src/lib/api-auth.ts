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

const TRIAL_DAYS = 14;

/**
 * Server-side twin of the client-side hasActiveAccess() in lib/db.ts.
 * Throws 402 when the user has no active subscription or trial.
 * Call this in every API route that performs a chargeable action
 * (placing calls, launching campaigns) — the client-side
 * <SubscriptionGate> alone can be bypassed with a direct API call.
 */
export async function requireActiveSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, created_at")
    .eq("id", userId)
    .single();
  const denied = new Error(
    "Subscription required — your trial has ended. Subscribe in Settings to keep calling."
  ) as Error & { status?: number };
  denied.status = 402;
  const s = ((profile?.subscription_status as string) || "").toLowerCase();
  if (s === "active" || s === "trialing") return;
  if (
    s === "canceled" ||
    s === "cancelled" ||
    s === "past_due" ||
    s === "unpaid"
  ) {
    throw denied;
  }
  const createdAt = profile?.created_at
    ? new Date(profile.created_at).getTime()
    : NaN;
  if (!Number.isNaN(createdAt) && Date.now() - createdAt < TRIAL_DAYS * 24 * 3600 * 1000)
    return;
  throw denied;
}
