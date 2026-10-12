import { NextResponse } from "next/server";
import { requireApiUser, requireActiveSubscription } from "@/lib/api-auth";
import { toE164, resolveBlandCreds } from "@/lib/bland";

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

// POST /api/campaigns — create a Bland batch campaign and queue its audience.
// Body: { name, leadIds: string[], maxConcurrency?: number }
// Bland has no native "campaign" object in v1, so we dispatch individual
// calls and track them via our own campaign row.
//
// Dispatch does NOT happen inside this request: placing dozens of calls
// sequentially takes far longer than a serverless function may run, so the
// request would be killed mid-dispatch and leave the campaign half-started.
// Instead the campaign is created here with status "running", and the
// campaign page's live poll drives POST /api/campaigns/[id]/pump, which
// dispatches a few calls per tick and reconciles in-flight calls with Bland.
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
    // Checked now so a missing connection fails fast, before rows exist.
    // Throws a user-actionable error when Bland isn't connected.
    await resolveBlandCreds(supabase, user.id);

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

    // 1) Our campaign row. Status starts "running" — the pump (driven by the
    //    campaign page's live poll) dispatches the queued audience a few
    //    calls at a time, so a big batch can never be killed mid-dispatch
    //    by a serverless timeout.
    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .insert({
        user_id: user.id,
        name,
        status: "running",
        total_contacts: audience.length,
        max_concurrency: maxConcurrency,
        provider: "bland",
      })
      .select()
      .single();
    if (campErr || !campaign) throw campErr || new Error("Campaign not created");
    campaignId = campaign.id as string;

    // 2) Audience rows, queued for the pump. Call log rows are created by
    //    the pump at dispatch time so every dial has a record even if the
    //    provider call fails.
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

    return NextResponse.json({
      ok: true,
      campaignId,
      queued: audience.length,
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
