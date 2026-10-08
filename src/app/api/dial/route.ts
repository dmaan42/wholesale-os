import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveVapiCreds, createVapiCall } from "@/lib/vapi";

export const runtime = "nodejs";

// POST /api/dial  { leadId, phone }
// Verifies the caller is a signed-in WholesaleOS user, logs the call, then
// places an outbound AI call through the CALLER'S OWN Vapi account
// (connected in Settings → AI Calling). Usage is billed to their Vapi
// account, never to the app owner's.
// Call outcomes arrive later at /api/voice-webhook and update the call log +
// pipeline stage automatically.
//
// Required: the user must have connected Vapi in Settings.
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

    // The caller's own Vapi credentials — billed to their account.
    let creds;
    try {
      creds = await resolveVapiCreds(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 503 });
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

    const vapiData = await createVapiCall(creds, {
      customerNumber: phone,
      customerName: lead.owner_name || undefined,
      metadata: {
        wholesaleOsLeadId: leadId,
        wholesaleOsUserId: user.id,
        wholesaleOsCallLogId: log.id,
      },
    }).catch((e: any) => ({ __vapiError: e.message || "Voice provider error" }));
    if ((vapiData as any).__vapiError) {
      await supabase
        .from("call_logs")
        .update({
          status: "failed",
          summary: `Provider error: ${(vapiData as any).__vapiError}`,
        })
        .eq("id", log.id);
      return NextResponse.json(
        { error: (vapiData as any).__vapiError },
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
