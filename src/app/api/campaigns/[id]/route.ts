import { NextResponse } from "next/server";
import { requireApiUser, requireActiveSubscription } from "@/lib/api-auth";
import {
  resolveBlandCreds,
  createBlandCall,
  getBlandCall,
} from "@/lib/bland";
import { applyBlandCallUpdate, isBlandTerminal } from "@/lib/bland-sync";

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
// tables (Bland has no native campaign object; we dispatch individual calls).
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
      provider: "bland",
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
// With Bland we dispatch individual calls (no provider-side campaign object),
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
// POST /api/campaigns/[id]/pump — advance a running campaign by one tick.
// This is the heart of batch dispatch. The launch endpoint only queues the
// audience; the campaign page calls this on its live poll (every ~5s), and
// each tick does a bounded amount of work (< ~8s) so a serverless timeout
// can never kill a batch mid-dispatch:
//
//  1. Reconcile "dialing"/"dispatching" contacts against Bland's API, so
//     calls update even if the post-call webhook never arrived.
//  2. Re-queue contacts whose calls Bland never saw (stale dispatches,
//     e.g. from an old API key) — they will be redialed with good creds.
//  3. Dispatch a few queued contacts (atomically claimed, so two open tabs
//     can't double-dial).
//  4. Mark the campaign completed when nothing is left in flight.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const started = Date.now();
  const hasBudget = () => Date.now() - started < 8000;

  try {
    const { id } = await params;
    const { user, supabase, campaign } = await ownCampaign(req, id);

    if (campaign.status === "cancelled" || campaign.status === "completed") {
      return NextResponse.json({ ok: true, skipped: campaign.status });
    }

    // Paywall: placing calls requires an active subscription or trial.
    await requireActiveSubscription(supabase, user.id);

    let creds;
    try {
      creds = await resolveBlandCreds(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://www.realestatesolutionz.com";
    const webhookSecret = process.env.VOICE_WEBHOOK_SECRET;
    const webhookUrl =
      `${appUrl}/api/bland-webhook` +
      (webhookSecret ? `?secret=${encodeURIComponent(webhookSecret)}` : "");

    let reconciled = 0;
    let redispatched = 0;
    let requeued = 0;

    // ---- 1) Reconcile in-flight contacts against Bland -------------------
    const { data: inflight } = await supabase
      .from("campaign_contacts")
      .select("id, lead_id, phone, name, status, call_log_id, created_at")
      .eq("campaign_id", id)
      .in("status", ["dialing", "dispatching"])
      .order("created_at", { ascending: true })
      .limit(8);

    for (const c of (inflight ?? []) as any[]) {
      if (!hasBudget()) break;
      let log: any = null;
      if (c.call_log_id) {
        const { data } = await supabase
          .from("call_logs")
          .select("id, provider_call_id, created_at")
          .eq("id", c.call_log_id)
          .single();
        log = data;
      }
      const providerCallId = log?.provider_call_id as string | undefined;

      if (!providerCallId) {
        // Bland never accepted this call. If it's stale, re-queue it so the
        // pump redials it below; fresh ones may still be mid-dispatch.
        const refTime = log?.created_at ?? c.created_at;
        const ageMin = (Date.now() - new Date(refTime).getTime()) / 60000;
        if (ageMin > 15) {
          if (log) {
            await supabase
              .from("call_logs")
              .update({
                status: "failed",
                summary:
                  "Dispatch interrupted before Bland accepted the call — re-queued.",
              })
              .eq("id", log.id);
          }
          await supabase
            .from("campaign_contacts")
            .update({ status: "queued", call_log_id: null })
            .eq("id", c.id);
          requeued++;
        }
        reconciled++;
        continue;
      }

      try {
        const call = await getBlandCall(creds, providerCallId);
        if (isBlandTerminal(call?.status)) {
          await applyBlandCallUpdate(supabase, log.id, call);
        }
      } catch (e: any) {
        if (e?.blandStatus === 404) {
          // Bland has no record of this call in the user's account — it will
          // never complete. Re-queue so it gets dialed with working creds.
          await supabase
            .from("call_logs")
            .update({
              status: "failed",
              summary:
                "Call not found in your Bland account (stale dispatch) — re-queued.",
            })
            .eq("id", log.id);
          await supabase
            .from("campaign_contacts")
            .update({ status: "queued", call_log_id: null })
            .eq("id", c.id);
          requeued++;
        }
        // Other errors (transient): leave the contact in flight; the next
        // tick or the webhook will pick it up.
      }
      reconciled++;
    }

    // ---- 2) Dispatch a few queued contacts -------------------------------
    // Honor the campaign's chosen pace (set at launch), capped so one tick
    // stays well under the serverless timeout.
    const perTick = Math.min(
      Math.max(Number(campaign.max_concurrency) || 2, 1),
      5
    );
    if (hasBudget() && campaign.status === "running") {
      const { data: queued } = await supabase
        .from("campaign_contacts")
        .select("id, lead_id, phone, name")
        .eq("campaign_id", id)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(perTick);

      for (const q of (queued ?? []) as any[]) {
        if (!hasBudget()) break;

        // Atomic claim: only one pumper can take this row.
        const { data: claimed } = await supabase
          .from("campaign_contacts")
          .update({ status: "dispatching" })
          .eq("id", q.id)
          .eq("status", "queued")
          .select("id");
        if (!claimed || (claimed as any[]).length === 0) continue;

        // Log first so there's a record even if the provider call fails.
        const { data: log, error: logErr } = await supabase
          .from("call_logs")
          .insert({
            user_id: user.id,
            lead_id: q.lead_id,
            campaign_id: id,
            phone: q.phone,
            direction: "outbound",
            status: "queued",
            provider: "bland",
          })
          .select("id")
          .single();
        if (logErr || !log) {
          await supabase
            .from("campaign_contacts")
            .update({ status: "queued" })
            .eq("id", q.id);
          continue;
        }
        const logId = (log as any).id as string;
        await supabase
          .from("campaign_contacts")
          .update({ call_log_id: logId })
          .eq("id", q.id);

        try {
          const res = await createBlandCall(creds, {
            customerNumber: q.phone,
            customerName: q.name || undefined,
            webhookUrl,
            metadata: {
              wholesaleOsLeadId: q.lead_id ?? "",
              wholesaleOsUserId: user.id,
              wholesaleOsCampaignId: id,
              wholesaleOsCallLogId: logId,
            },
            externalId: `wholesaleos-${logId}`,
          });
          if (!res?.call_id) throw new Error("Bland did not return a call id");
          await supabase
            .from("call_logs")
            .update({ status: "ringing", provider_call_id: res.call_id })
            .eq("id", logId);
          await supabase
            .from("campaign_contacts")
            .update({ status: "dialing" })
            .eq("id", q.id);
          redispatched++;
        } catch (e: any) {
          await supabase
            .from("call_logs")
            .update({
              status: "failed",
              summary: `Provider error: ${e.message || "Bland API error"}`,
            })
            .eq("id", logId);
          await supabase
            .from("campaign_contacts")
            .update({ status: "failed" })
            .eq("id", q.id);
        }
      }
    }

    // ---- 3) Complete the campaign when nothing is left --------------------
    const { count: remaining } = await supabase
      .from("campaign_contacts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id)
      .in("status", ["queued", "dialing", "dispatching"]);
    let campaignStatus = campaign.status as string;
    if ((remaining ?? 0) === 0 && campaignStatus === "running") {
      await supabase
        .from("campaigns")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", id);
      campaignStatus = "completed";
    }

    return NextResponse.json({
      ok: true,
      reconciled,
      dispatched: redispatched,
      requeued,
      campaignStatus,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Pump failed" },
      { status: err.status || 500 }
    );
  }
}
