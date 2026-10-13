import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireActiveSubscription } from "@/lib/api-auth";
import { resolveElevenLabsCreds, createElevenLabsCall, toE164 } from "@/lib/elevenlabs";

export const runtime = "nodejs";

// POST /api/dial  { leadId, phone }
// Verifies the caller is a signed-in WholesaleOS user, logs the call, then
// places an outbound AI call through the CALLER'S OWN ElevenLabs account
// (connected in Settings → AI Calling). Usage is billed to their ElevenLabs
// account, never to the app owner's.
// Call outcomes arrive later at /api/elevenlabs-webhook and update the call
// log + pipeline stage automatically.
//
// Required: the user must have connected ElevenLabs in Settings.
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

    // The caller's own ElevenLabs credentials — billed to their account.
    let creds;
    try {
      creds = await resolveElevenLabsCreds(supabase, user.id);
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
        provider: "elevenlabs",
      })
      .select()
      .single();
    if (logErr || !log) {
      return NextResponse.json({ error: "Could not log call" }, { status: 500 });
    }

    // Note: ElevenLabs post-call webhooks are configured on the agent in the
    // ElevenLabs dashboard (per-agent webhook URL), not per call. Point the
    // agent's webhook at:
    //   https://<your-app>/api/elevenlabs-webhook
    // (optionally with ?secret=<VOICE_WEBHOOK_SECRET>).
    // Dynamic variables below personalize this specific call's agent prompt.
    const elevenData = await createElevenLabsCall(creds, {
      customerNumber: e164,
      customerName: lead.owner_name || undefined,
      contactCity: (lead as any).city || undefined,
      propertyAddress: (lead as any).address || undefined,
      metadata: {
        wholesaleOsLeadId: leadId,
        wholesaleOsUserId: user.id,
        wholesaleOsCallLogId: log.id,
      },
      externalId: `wholesaleos-${log.id}`,
    }).catch((e: any) => ({ __elevenError: e.message || "Voice provider error" }));

    if ((elevenData as any).__elevenError) {
      await supabase
        .from("call_logs")
        .update({
          status: "failed",
          summary: `Provider error: ${(elevenData as any).__elevenError}`,
        })
        .eq("id", log.id);
      return NextResponse.json(
        { error: (elevenData as any).__elevenError },
        { status: 502 }
      );
    }

    const conversationId = (elevenData as any).conversation_id;
    if (!conversationId) {
      await supabase
        .from("call_logs")
        .update({
          status: "failed",
          summary: "Provider error: ElevenLabs did not return a conversation id",
        })
        .eq("id", log.id);
      return NextResponse.json(
        { error: "ElevenLabs did not return a conversation id" },
        { status: 502 }
      );
    }

    await supabase
      .from("call_logs")
      .update({ status: "ringing", provider_call_id: conversationId })
      .eq("id", log.id);

    return NextResponse.json({
      ok: true,
      callLogId: log.id,
      providerCallId: conversationId,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Dial failed" },
      { status: 500 }
    );
  }
}
