import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// POST /api/dial  { leadId, phone }
// Verifies the caller is a signed-in WholesaleOS user, logs the call, then
// places an outbound AI call through Vapi. Call outcomes arrive later at
// /api/voice-webhook and update the call log + pipeline stage automatically.
//
// Required env: VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID,
//               NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
export async function POST(req: Request) {
  try {
    const { leadId, phone } = await req.json();
    if (!leadId || !phone) {
      return NextResponse.json(
        { error: "leadId and phone are required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.VAPI_API_KEY;
    const assistantId = process.env.VAPI_ASSISTANT_ID;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    if (!apiKey || !assistantId || !phoneNumberId) {
      return NextResponse.json(
        {
          error:
            "Voice calling isn't configured yet — set VAPI_API_KEY, VAPI_ASSISTANT_ID, and VAPI_PHONE_NUMBER_ID.",
        },
        { status: 503 }
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

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, owner_name")
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
        provider: "vapi",
      })
      .select()
      .single();
    if (logErr || !log) {
      return NextResponse.json({ error: "Could not log call" }, { status: 500 });
    }

    const vapiRes = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: phone, name: lead.owner_name || undefined },
        metadata: {
          wholesaleOsLeadId: leadId,
          wholesaleOsUserId: user.id,
          wholesaleOsCallLogId: log.id,
        },
      }),
    });
    const vapiData = await vapiRes.json().catch(() => ({} as any));
    if (!vapiRes.ok) {
      await supabase
        .from("call_logs")
        .update({
          status: "failed",
          summary: `Provider error: ${vapiData?.message || vapiRes.status}`,
        })
        .eq("id", log.id);
      return NextResponse.json(
        { error: vapiData?.message || "Voice provider rejected the call" },
        { status: 502 }
      );
    }

    await supabase
      .from("call_logs")
      .update({ status: "ringing", provider_call_id: vapiData.id })
      .eq("id", log.id);

    return NextResponse.json({
      ok: true,
      callLogId: log.id,
      providerCallId: vapiData.id,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Dial failed" },
      { status: 500 }
    );
  }
}
