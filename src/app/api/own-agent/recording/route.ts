import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * POST /api/own-agent/recording — Twilio RecordingStatusCallback.
 * Stores the recording URL on the own-dialer call log so the campaign
 * page's recording player has something real to play (previously
 * "Recording unavailable" with no URL stored at all).
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => new FormData());
  const fields: Record<string, string> = {};
  form.forEach((v, k) => {
    fields[k] = String(v);
  });
  const callSid = fields.CallSid || "";
  const recordingUrl = fields.RecordingUrl || "";
  if (!callSid || !recordingUrl) {
    return NextResponse.json({ received: true });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
  await supabase
    .from("call_logs")
    .update({ recording_url: recordingUrl })
    .eq("provider_call_id", callSid)
    .eq("provider", "own-dialer");
  return NextResponse.json({ received: true });
}
