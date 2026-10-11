import { NextResponse } from "next/server";
import { requireApiUser, requireActiveSubscription } from "@/lib/api-auth";
import {
  dispatchBlandCalls,
  toE164,
  resolveBlandCreds,
} from "@/lib/bland";

export const runtime = "nodejs";

// GET /api/campaigns — list the signed-in user's campaigns.
export async function GET(req: Request) {
  try {
    const { supabase } = await requireApiUser(req);
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ campaigns: data ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to load campaigns" },
      { status: err.status || 500 }
    );
  }
}

// POST /api/campaigns — create + immediately launch a Bland batch campaign.
// Body: { name, leadIds: string[], maxConcurrency?: number }
// Bland has no native "campaign" object in v1, so we dispatch individual
// calls with concurrency control and track them via our own campaign row.
export async function POST(req: Request) {
  // Track rows we inserted so we can roll back if the launch fails.
  let campaignId: string | null = null;
  let supabase: Awaited<ReturnType<typeof requireApiUser>>["supabase"] | null =
    null;

  try {
    const auth = await requireApiUser(req);
    supabase = auth.supabase;
    const { user } = auth;

    // Paywall: launching campaigns requires an active subscription or trial.
    await requireActiveSubscription(supabase, user.id);

    // The caller's own Bland credentials — billed to their account.
    // Throws a user-actionable error when Bland isn't connected.
    const creds = await resolveBlandCreds(supabase, user.id);

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "Untitled campaign").slice(0, 120);
    const leadIds: string[] = Array.isArray(body.leadIds) ? body.leadIds : [];
    const maxConcurrency = Math.min(
      Math.max(Number(body.maxConcurrency) || 2, 1),
      10
    );

    if (leadIds.length === 0) {
      return NextResponse.json(
        { error: "Pick at least one lead for the campaign." },
        { status: 400 }
      );
    }
    if (leadIds.length > 1000) {
      return NextResponse.json(
        { error: "Campaigns are limited to 1,000 leads at a time." },
        { status: 400 }
      );
    }

    // Load the user's leads and keep only ones with dialable numbers.
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("id, owner_name, phone, city, address")
      .eq("user_id", user.id)
      .in("id", leadIds);
    if (leadsErr) throw leadsErr;

    const seen = new Set<string>();
    const audience: {
      leadId: string;
      phone: string;
      name: string;
      city?: string;
      address?: string;
    }[] = [];
    for (const lead of leads ?? []) {
      const e164 = toE164(lead.phone || "");
      if (!e164 || seen.has(e164)) continue; // skip bad + duplicate numbers
      seen.add(e164);
      audience.push({
        leadId: lead.id,
        phone: e164,
        name: lead.owner_name || "",
        city: (lead as any).city || undefined,
        address: (lead as any).address || undefined,
      });
    }
    if (audience.length === 0) {
      return NextResponse.json(
        { error: "None of the selected leads have a usable phone number." },
        { status: 400 }
      );
    }

    // 1) Our campaign row (draft until Bland confirms the launch).
    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .insert({
        user_id: user.id,
        name,
        status: "draft",
        total_contacts: audience.length,
        max_concurrency: maxConcurrency,
        provider: "bland",
      })
      .select()
      .single();
    if (campErr || !campaign) throw campErr || new Error("Campaign not created");
    campaignId = campaign.id as string;
    const cid: string = campaignId;

    // 2) Audience rows.
    const { error: contactsErr } = await supabase
      .from("campaign_contacts")
      .insert(
        audience.map((a) => ({
          campaign_id: campaignId,
          lead_id: a.leadId,
          phone: a.phone,
          name: a.name,
          status: "queued",
        }))
      );
    if (contactsErr) throw contactsErr;

    // 3) Pre-create call log rows so every dial has a record even if the
    //    provider call fails, and so the webhook can correlate by number.
    const { data: logs, error: logsErr } = await supabase
      .from("call_logs")
      .insert(
        audience.map((a) => ({
          user_id: user.id,
          lead_id: a.leadId,
          campaign_id: campaignId,
          phone: a.phone,
          direction: "outbound",
          status: "queued",
          provider: "bland",
        }))
      )
      .select("id, lead_id");
    if (logsErr || !logs) throw logsErr || new Error("Call logs not created");

    const logByLead = new Map<string, string>();
    for (const log of logs as { id: string; lead_id: string }[]) {
      logByLead.set(log.lead_id, log.id);
    }
    // Link contacts -> their log rows (best effort; RLS-safe).
    for (const a of audience) {
      const logId = logByLead.get(a.leadId);
      if (!logId) continue;
      await supabase
        .from("campaign_contacts")
        .update({ call_log_id: logId })
        .eq("campaign_id", campaignId)
        .eq("lead_id", a.leadId);
    }

    // 4) Dispatch via Bland. This is the point of no return for real calls.
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://www.realestatesolutionz.com";
    const webhookSecret = process.env.VOICE_WEBHOOK_SECRET;
    const webhookUrl =
      `${appUrl}/api/bland-webhook` +
      (webhookSecret ? `?secret=${encodeURIComponent(webhookSecret)}` : "");

    // Mark campaign as running before dispatch so the UI reflects it.
    await supabase
      .from("campaigns")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", campaignId);

    const { placed, failed } = await dispatchBlandCalls(
      creds,
      audience.map((a) => ({
        phone_number: a.phone,
        metadata: {
          wholesaleOsLeadId: a.leadId,
          wholesaleOsUserId: user.id,
          wholesaleOsCampaignId: cid,
          wholesaleOsCallLogId: logByLead.get(a.leadId) ?? "",
        },
        external_id: `wholesaleos-${logByLead.get(a.leadId) ?? a.leadId}`,
      })),
      {
        webhookUrl,
        maxConcurrency,
        onCallPlaced: async (index, callId) => {
          const a = audience[index];
          const logId = logByLead.get(a.leadId);
          if (!logId || !supabase) return;
          await supabase
            .from("call_logs")
            .update({ status: "ringing", provider_call_id: callId })
            .eq("id", logId);
          await supabase
            .from("campaign_contacts")
            .update({ status: "dialing" })
            .eq("campaign_id", cid)
            .eq("lead_id", a.leadId);
        },
        onCallFailed: async (index, error) => {
          const a = audience[index];
          const logId = logByLead.get(a.leadId);
          if (!logId || !supabase) return;
          await supabase
            .from("call_logs")
            .update({ status: "failed", summary: `Provider error: ${error}` })
            .eq("id", logId);
          await supabase
            .from("campaign_contacts")
            .update({ status: "failed" })
            .eq("campaign_id", cid)
            .eq("lead_id", a.leadId);
        },
      }
    );

    // If every call failed to dispatch, mark the campaign failed.
    if (placed === 0 && failed > 0) {
      await supabase
        .from("campaigns")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", campaignId);
    }

    return NextResponse.json({
      ok: true,
      campaignId,
      launched: placed,
      failed,
    });
  } catch (err: any) {
    // Roll back our rows so a failed launch leaves no orphan campaign.
    if (supabase && campaignId) {
      await supabase.from("call_logs").delete().eq("campaign_id", campaignId);
      await supabase.from("campaign_contacts").delete().eq("campaign_id", campaignId);
      await supabase.from("campaigns").delete().eq("id", campaignId);
    }
    const status = err.status || (err.blandStatus ? 502 : 500);
    return NextResponse.json(
      { error: err.message || "Campaign launch failed" },
      { status }
    );
  }
}
