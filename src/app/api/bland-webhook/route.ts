import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeDisposition, digitsOnly } from "@/lib/bland";

export const runtime = "nodejs";

// Bland AI post-call webhook.
// In the Bland dashboard, set the webhook URL per call (sent via the API)
// or on the phone number. Format:
//   https://<your-app>/api/bland-webhook?secret=<VOICE_WEBHOOK_SECRET>
//
// Bland fires once when the call ends (may take up to ~60s while audio
// processes). The payload is the full call object.
//
// On each webhook this updates the call log (status, duration, recording,
// summary, outcome/disposition) and moves the lead's pipeline stage forward
// on positive signals only — it never auto-kills a lead.
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

  // Bland webhook payload = full call object.
  const callId = body?.call_id;
  if (!callId) {
    return NextResponse.json({ received: true });
  }

  const meta = body?.metadata ?? {};
  let callLogId: string | undefined = meta.wholesaleOsCallLogId;
  let leadId: string | undefined = meta.wholesaleOsLeadId;
  let userId: string | undefined = meta.wholesaleOsUserId;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );

  // Fallback: match by external_id or dialed number.
  if (!callLogId) {
    const externalId = String(body?.external_id ?? "");
    if (externalId.startsWith("wholesaleos-")) {
      callLogId = externalId.replace("wholesaleos-", "");
    }
  }
  if (!callLogId) {
    const dialed = digitsOnly(String(body?.to ?? ""));
    const tail = dialed.slice(-10);
    if (tail.length === 10 && userId) {
      const { data: openLogs } = await supabase
        .from("call_logs")
        .select("id, lead_id, user_id, phone")
        .eq("user_id", userId)
        .in("status", ["queued", "initiated", "ringing", "in-progress"])
        .order("created_at", { ascending: false })
        .limit(50);
      const match = (openLogs ?? []).find((r: any) =>
        digitsOnly(String(r.phone || "")).endsWith(tail)
      ) as any;
      if (match) {
        callLogId = match.id;
        leadId = match.lead_id ?? leadId;
        userId = match.user_id ?? userId;
      }
    }
  }

  if (!callLogId) return NextResponse.json({ received: true });

  // Map Bland fields to our call log.
  const status = String(body?.status ?? "").toLowerCase();
  const answeredBy = String(body?.answered_by ?? "").toLowerCase();
  const durationSeconds = Math.round(
    Number(body?.corrected_duration ?? 0) || 0
  );
  const recordingUrl = body?.recording_url ?? null;
  const summary = body?.summary ?? null;
  const transcript = body?.concatenated_transcript ?? null;
  const dispositionTag = body?.disposition_tag ?? null;
  const outcome = normalizeDisposition(dispositionTag);

  // Map Bland status to our status vocabulary.
  let callStatus = "completed";
  if (status === "failed" || status === "canceled") callStatus = "failed";
  else if (status === "busy") callStatus = "busy";
  else if (status === "no-answer") callStatus = "no-answer";

  await supabase
    .from("call_logs")
    .update({
      status: callStatus,
      duration_seconds: durationSeconds,
      recording_url: recordingUrl,
      summary,
      outcome,
      transcript,
      provider_call_id: callId,
    })
    .eq("id", callLogId);

  // If this call belonged to a batch campaign, mark its audience row done.
  await supabase
    .from("campaign_contacts")
    .update({ status: callStatus })
    .eq("call_log_id", callLogId);

  // Advance the pipeline on positive signals only.
  const o = outcome.toLowerCase();
  let newStatus: string | null = null;
  if (o === "hot") {
    newStatus = "qualified";
  } else if (o === "follow-up") {
    newStatus = "contacted";
  } else if (o === "not interested" || o === "dnc") {
    newStatus = "contacted";
  } else if (/voicemail/.test(answeredBy)) {
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

  // Honor DNC: if the prospect asked to be removed, tag the lead.
  if (o === "dnc" && leadId && userId) {
    await supabase
      .from("leads")
      .update({ tags: ["dnc"] })
      .eq("id", leadId)
      .eq("user_id", userId);
  }

  return NextResponse.json({ received: true });
}
