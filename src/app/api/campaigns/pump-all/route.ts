import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { pumpCampaign } from "@/lib/campaign-pump";

export const runtime = "nodejs";
// Vercel Cron can take a while when several campaigns are running;
// allow the max on Pro, harmless on Hobby (capped by platform).
export const maxDuration = 60;

/**
 * GET /api/campaigns/pump-all — Vercel Cron sweeper.
 * Runs every minute (see vercel.json). Pumps every running campaign so
 * dispatch no longer depends on the user's browser tab staying open.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the
 * CRON_SECRET env var is set. Requests without a matching secret are denied.
 * Each campaign is pumped in isolation — one failing campaign never blocks
 * the others.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, user_id, status, max_concurrency")
    .eq("status", "running")
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    console.error("[pump-all] supabase error listing campaigns:", error);
    return NextResponse.json(
      { error: "Failed to list running campaigns" },
      { status: 500 }
    );
  }

  const results: Record<string, any> = {};
  for (const c of campaigns ?? []) {
    try {
      // Bounded slice per campaign so one long campaign can't starve others.
      results[c.id] = await pumpCampaign(supabase, c as any, c.user_id, {
        budgetMs: 20000,
      });
    } catch (e: any) {
      results[c.id] = { ok: false, error: e.message || "pump failed" };
    }
  }

  return NextResponse.json({
    ok: true,
    pumped: Object.keys(results).length,
    results,
  });
}
