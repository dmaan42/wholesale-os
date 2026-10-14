import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { pumpCampaign } from "@/lib/campaign-pump";

export const runtime = "nodejs";

async function ownCampaign(req: Request, id: string) {
  const { user, supabase } = await requireApiUser(req);
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (error || !data) {
    const err = new Error("Campaign not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return { user, supabase, campaign: data };
}

// GET /api/campaigns/[id] — our record + live status aggregated from our own
// tables (ElevenLabs has no native campaign object; we dispatch individual calls).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, campaign } = await ownCampaign(req, id);

    // Aggregate per-contact status from our own tables.
    const { data: contacts } = await supabase
      .from("campaign_contacts")
      .select("id, lead_id, phone, name, status")
      .eq("campaign_id", id)
      .order("created_at", { ascending: true });

    const { data: logs } = await supabase
      .from("call_logs")
      .select("id, lead_id, status, duration_seconds, outcome, summary")
      .eq("campaign_id", id);

    const counters: Record<string, number> = {};
    for (const c of contacts ?? []) {
      const s = String((c as any).status || "queued");
      counters[s] = (counters[s] ?? 0) + 1;
    }

    const live = {
      contacts: contacts ?? [],
      callLogs: logs ?? [],
      counters,
      provider: "elevenlabs",
    };

    return NextResponse.json({ campaign, live, liveError: null });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to load campaign" },
      { status: err.status || 500 }
    );
  }
}

// PATCH /api/campaigns/[id] — { action: "cancel" } stops a running campaign.
// With ElevenLabs we dispatch individual calls (no provider-side campaign object),
// so cancelling marks our campaign cancelled and stops dispatching any
// remaining queued calls. Calls already in progress will finish.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, campaign } = await ownCampaign(req, id);
    const body = await req.json().catch(() => ({}));

    if (body.action === "resume") {
      // Re-open a cancelled/failed/stalled campaign. The pump (below)
      // reconciles any stale "dialing" contacts on its next tick, so this
      // only needs to flip the campaign back to running.
      await supabase
        .from("campaigns")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "retry_failed") {
      // Reset failed contacts to queued so the pump redials them.
      // Also flip the campaign back to running if it had completed.
      const { count } = await supabase
        .from("campaign_contacts")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", id)
        .eq("status", "failed");
      await supabase
        .from("campaign_contacts")
        .update({ status: "queued", call_log_id: null })
        .eq("campaign_id", id)
        .eq("status", "failed");
      await supabase
        .from("campaigns")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", id);
      return NextResponse.json({ ok: true, retried: count ?? 0 });
    }

    if (body.action !== "cancel") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    // Mark any still-queued contacts as cancelled so no further dispatch happens.
    await supabase
      .from("campaign_contacts")
      .update({ status: "cancelled" })
      .eq("campaign_id", id)
      .eq("status", "queued");

    await supabase
      .from("call_logs")
      .update({ status: "cancelled" })
      .eq("campaign_id", id)
      .eq("status", "queued");

    await supabase
      .from("campaigns")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Cancel failed" },
      { status: err.status || 500 }
    );
  }
}
// POST /api/campaigns/[id] — advance a running campaign by one tick.
// (Kept for backward compatibility; the Vercel Cron sweeper at
// /api/campaigns/pump-all is now the primary driver, so dispatch no longer
// depends on the browser tab staying open. Both paths share pumpCampaign().)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, supabase, campaign } = await ownCampaign(req, id);
    const result = await pumpCampaign(supabase, campaign, user.id);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Pump failed" },
      { status: err.status || 500 }
    );
  }
}
