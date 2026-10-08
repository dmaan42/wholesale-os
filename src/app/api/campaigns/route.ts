import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { createVapiCampaign, toE164 } from "@/lib/vapi";

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

// POST /api/campaigns — create + immediately launch a Vapi batch campaign.
// Body: { name, leadIds: string[], maxConcurrency?: number,
//         earliestAt?: string (ISO), latestAt?: string (ISO) }
// Campaigns launch on creation (Vapi behavior) unless earliestAt is future.
export async function POST(req: Request) {
  // Track rows we inserted so we can roll back if the Vapi launch fails.
  let campaignId: string | null = null;
  let supabase: Awaited<ReturnType<typeof requireApiUser>>["supabase"] | null =
    null;

  try {
    const auth = await requireApiUser(req);
    supabase = auth.supabase;
    const { user } = auth;

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "Untitled campaign").slice(0, 120);
    const leadIds: string[] = Array.isArray(body.leadIds) ? body.leadIds : [];
    const maxConcurrency = Math.min(
      Math.max(Number(body.maxConcurrency) || 1, 1),
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
      .select("id, owner_name, phone")
      .eq("user_id", user.id)
      .in("id", leadIds);
    if (leadsErr) throw leadsErr;

    const seen = new Set<string>();
    const audience: { leadId: string; phone: string; name: string }[] = [];
    for (const lead of leads ?? []) {
      const e164 = toE164(lead.phone || "");
      if (!e164 || seen.has(e164)) continue; // skip bad + duplicate numbers
      seen.add(e164);
      audience.push({
        leadId: lead.id,
        phone: e164,
        name: lead.owner_name || "",
      });
    }
    if (audience.length === 0) {
      return NextResponse.json(
        { error: "None of the selected leads have a usable phone number." },
        { status: 400 }
      );
    }

    // 1) Our campaign row (draft until Vapi confirms the launch).
    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .insert({
        user_id: user.id,
        name,
        status: "draft",
        total_contacts: audience.length,
        max_concurrency: maxConcurrency,
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
          provider: "vapi",
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

    // 4) Launch on Vapi. This is the point of no return for real calls —
    //    a timeout/5xx here does NOT prove failure, so we verify by reading
    //    the campaign back before claiming success (see vapi.ts notes).
    const vapiCampaign = await createVapiCampaign({
      name,
      customers: audience.map((a) => ({ number: a.phone, name: a.name })),
      maxConcurrency,
      earliestAt: body.earliestAt || undefined,
      latestAt: body.latestAt || undefined,
      metadata: {
        wholesaleOsUserId: user.id,
        wholesaleOsCampaignId: cid,
      },
    });

    const { error: updErr } = await supabase
      .from("campaigns")
      .update({
        vapi_campaign_id: vapiCampaign.id,
        status: "running",
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
    if (updErr) throw updErr;

    return NextResponse.json({
      ok: true,
      campaignId,
      vapiCampaignId: vapiCampaign.id,
      launched: audience.length,
    });
  } catch (err: any) {
    // Roll back our rows so a failed launch leaves no orphan campaign.
    // (If Vapi actually created the campaign despite the error, the user
    // can cancel it from the Vapi dashboard — we never auto-retry a launch.)
    if (supabase && campaignId) {
      await supabase.from("call_logs").delete().eq("campaign_id", campaignId);
      await supabase.from("campaign_contacts").delete().eq("campaign_id", campaignId);
      await supabase.from("campaigns").delete().eq("id", campaignId);
    }
    const status = err.status || (err.vapiStatus ? 502 : 500);
    return NextResponse.json(
      { error: err.message || "Campaign launch failed" },
      { status }
    );
  }
}
