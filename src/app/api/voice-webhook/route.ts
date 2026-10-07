import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Vapi end-of-call webhook.
// In the Vapi dashboard: Assistants -> your assistant -> Server URL, set to:
//   https://<your-app>/api/voice-webhook?secret=<VOICE_WEBHOOK_SECRET>
// and subscribe to the `end-of-call-report` event.
//
// On each report this updates the call log (status, duration, recording,
// summary, outcome) and moves the lead's pipeline stage forward on positive
// signals only — it never auto-kills a lead.
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//               VOICE_WEBHOOK_SECRET (optional but recommended)
export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.VOICE_WEBHOOK_SECRET;
  if (secret && url.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ received: true });
  }

  const msg = body?.message;
  if (msg?.type !== "end-of-call-report") {
    return NextResponse.json({ received: true });
  }

  const call = msg.call ?? {};
  const meta = { ...(call.metadata ?? {}), ...(msg.metadata ?? {}) };
  const callLogId: string | undefined = meta.wholesaleOsCallLogId;
  const leadId: string | undefined = meta.wholesaleOsLeadId;
  const userId: string | undefined = meta.wholesaleOsUserId;
  if (!callLogId) return NextResponse.json({ received: true });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );

  const durationSeconds = Math.round(
    msg.durationSeconds ?? (msg.durationMs ? msg.durationMs / 1000 : 0)
  );
  const recordingUrl = msg.recordingUrl ?? msg.recording?.url ?? null;
  const summary = msg.summary ?? msg.analysis?.summary ?? null;
  const endedReason = msg.endedReason ?? call.endedReason ?? "";
  const outcome = String(
    msg.analysis?.structuredData?.outcome ??
      msg.analysis?.successEvaluation ??
      endedReason ??
      ""
  );

  await supabase
    .from("call_logs")
    .update({
      status: "completed",
      duration_seconds: durationSeconds,
      recording_url: recordingUrl,
      summary,
      outcome,
    })
    .eq("id", callLogId);

  // Advance the pipeline on positive signals only.
  const o = outcome.toLowerCase();
  let newStatus: string | null = null;
  if (/interested|hot|qualified|booked|appointment|wants (to sell|an offer)/.test(o)) {
    newStatus = "qualified";
  } else if (/callback|follow.?up|call back|think (it|about it) over/.test(o)) {
    newStatus = "contacted";
  } else if (/voicemail|no.?answer|busy|didn.?t (pick|answer)/.test(o)) {
    newStatus = "contacted";
  }

  if (leadId && userId && newStatus) {
    await supabase
      .from("leads")
      .update({ status: newStatus })
      .eq("id", leadId)
      .eq("user_id", userId);
    const { data: lead } = await supabase
      .from("leads")
      .select("notes")
      .eq("id", leadId)
      .single();
    const line = `AI call ${new Date().toLocaleDateString()}: ${outcome} (${durationSeconds}s)`;
    await supabase
      .from("leads")
      .update({ notes: `${lead?.notes ? lead.notes + "\n" : ""}${line}` })
      .eq("id", leadId)
      .eq("user_id", userId);
  }

  return NextResponse.json({ received: true });
}
