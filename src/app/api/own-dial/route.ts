import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireActiveSubscription } from "@/lib/api-auth";
import {
  resolveOwnDialerCreds,
  createOwnDialerCall,
  toE164Own,
  TwilioApiError,
} from "@/lib/own-dialer";

export const runtime = "nodejs";

/**
 * POST /api/own-dial — single own-dialer call (Twilio + our own TwiML
 * agent). Same auth + subscription checks as /api/dial, but no
 * ElevenLabs: the conversation is driven by /api/own-agent/voice.
 *
 * Body: { leadId, phone }
 * - The call is logged BEFORE dialing (provider "own-dialer"), so a
 *   dial failure still leaves a record.
 * - On a Twilio rejection the log is updated to failed with the
 *   verbatim Twilio error code/message, and that same reason is
 *   returned — never "unknown".
 * - On success the log stores the Twilio Call SID and status
 *   "ringing"; status, duration, recording, transcript, and
 *   disposition arrive later via the own-agent callbacks.
 */
export async function POST(req: Request) {
  try {
    const { leadId, phone } = await req.json();
    if (!leadId || !phone) {
      return NextResponse.json(
        { error: "leadId and phone are required" },
        { status: 400 }
      );
    }

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

    try {
      await requireActiveSubscription(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status || 402 }
      );
    }

    let creds;
    try {
      creds = await resolveOwnDialerCreds(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }

    const e164 = toE164Own(phone);
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

    const { data: log, error: logErr } = await supabase
      .from("call_logs")
      .insert({
        user_id: user.id,
        lead_id: leadId,
        phone,
        direction: "outbound",
        status: "initiated",
        provider: "own-dialer",
      })
      .select()
      .single();
    if (logErr || !log) {
      return NextResponse.json(
        { error: "Could not log call" },
        { status: 500 }
      );
    }

    try {
      const { callSid } = await createOwnDialerCall(creds, {
        to: e164,
        callLogId: (log as any).id,
      });
      await supabase
        .from("call_logs")
        .update({ status: "ringing", provider_call_id: callSid })
        .eq("id", (log as any).id);
      return NextResponse.json({
        ok: true,
        callLogId: (log as any).id,
        providerCallId: callSid,
      });
    } catch (e: any) {
      const verbatim =
        e instanceof TwilioApiError
          ? e.verbatim
          : `Twilio error: ${e?.message || "Dial failed"}`;
      await supabase
        .from("call_logs")
        .update({ status: "failed", summary: verbatim })
        .eq("id", (log as any).id);
      return NextResponse.json({ error: verbatim }, { status: 502 });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Dial failed" },
      { status: 500 }
    );
  }
}
