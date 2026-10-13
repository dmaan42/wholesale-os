import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireActiveSubscription } from "@/lib/api-auth";
import { resolveBlandCreds, createBlandCall, toE164 } from "@/lib/bland";

export const runtime = "nodejs";

// POST /api/dial  { leadId, phone }
// Verifies the caller is a signed-in WholesaleOS user, logs the call, then
// places an outbound AI call through the CALLER'S OWN Bland AI account
// (connected in Settings → AI Calling). Usage is billed to their Bland
// account, never to the app owner's.
// Call outcomes arrive later at /api/bland-webhook and update the call log +
// pipeline stage automatically.
//
// Required: the user must have connected Bland in Settings.
export async function POST(req: Request) {
  try {
    const { leadId, phone } = await req.json();
    if (!leadId || !phone) {
      return NextResponse.json(
        { error: "leadId and phone are required" },
        { status: 400 }
      );
    }

    // Verify the caller via their Supabase JWT (RLS keeps everything scoped).
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
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    // Paywall: placing calls requires an active subscription or trial.
    try {
      await requireActiveSubscription(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status || 402 }
      );
    }

    // The caller's own Bland credentials — billed to their account.
    let creds;
    try {
      creds = await resolveBlandCreds(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }

    const e164 = toE164(phone);
    if (!e164) {
      return NextResponse.json(
        { error: "Phone number is not dialable." },
        { status: 400 }
      );
    }

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, owner_name, city, address")
      .eq("id", leadId)
      .single();
    if (leadErr || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Log first so there's a record even if the provider call fails.
    const { data: log, error: logErr } = await supabase
      .from("call_logs")
      .insert({
        user_id: user.id,
        lead_id: leadId,
        phone,
        direction: "outbound",
        status: "initiated",
        provider: "bland",
      })
      .select()
      .single();
    if (logErr || !log) {
      return NextResponse.json({ error: "Could not log call" }, { status: 500 });
    }

    // Derive the origin from the live request, not the build-time env var —
    // NEXT_PUBLIC_* is inlined at Vercel build time and can go stale.
    const appUrl = new URL(req.url).origin;
    const webhookSecret = process.env.VOICE_WEBHOOK_SECRET;
    const webhookUrl =
      `${appUrl}/api/bland-webhook` +
      (webhookSecret ? `?secret=${encodeURIComponent(webhookSecret)}` : "");

    const blandData = await createBlandCall(creds, {
      customerNumber: e164,
      customerName: lead.owner_name || undefined,
      contactCity: (lead as any).city || undefined,
      propertyAddress: (lead as any).address || undefined,
      webhookUrl,
      metadata: {
        wholesaleOsLeadId: leadId,
        wholesaleOsUserId: user.id,
        wholesaleOsCallLogId: log.id,
      },
      externalId: `wholesaleos-${log.id}`,
    }).catch((e: any) => ({ __blandError: e.message || "Voice provider error" }));

    if ((blandData as any).__blandError) {
      await supabase
        .from("call_logs")
        .update({
          status: "failed",
          summary: `Provider error: ${(blandData as any).__blandError}`,
        })
        .eq("id", log.id);
      return NextResponse.json(
        { error: (blandData as any).__blandError },
        { status: 502 }
      );
    }

    await supabase
      .from("call_logs")
      .update({ status: "ringing", provider_call_id: blandData.call_id })
      .eq("id", log.id);

    return NextResponse.json({
      ok: true,
      callLogId: log.id,
      providerCallId: blandData.call_id,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Dial failed" },
      { status: 500 }
    );
  }
}
