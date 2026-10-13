import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDisposition } from "@/lib/elevenlabs";

/**
 * Shared ElevenLabs call-result applier.
 * Used by the post-call webhook AND by the campaign pump's reconcile pass,
 * so both paths write identical outcomes to call_logs, campaign_contacts
 * and the lead pipeline.
 *
 * `call` is an ElevenLabs conversation object (from the webhook payload or
 * GET /convai/conversations/{id}).
 *
 * ElevenLabs conversation shape (relevant fields):
 * - conversation_id
 * - status: "in-progress" | "done" | "failed" | ...
 * - transcript: [{ role, message, time_in_call_secs, ... }] or combined text
 * - metadata: { call_duration_secs, ... }
 * - analysis: { call_successful, transcript_summary, ... }
 * - has_audio / recording_url (via separate endpoint)
 */

/** Flatten an ElevenLabs transcript array into plain text. */
function flattenTranscript(transcript: any): string | null {
  if (!transcript) return null;
  if (typeof transcript === "string") return transcript;
  if (Array.isArray(transcript)) {
    const lines = transcript
      .map((t: any) => {
        const role = t?.role === "agent" ? "Alex" : "Caller";
        const msg = t?.message ?? t?.text ?? "";
        return msg ? `${role}: ${msg}` : "";
      })
      .filter(Boolean);
    return lines.length ? lines.join("\n") : null;
  }
  return null;
}

/**
 * Classify the call outcome from the transcript + analysis.
 * ElevenLabs has no native dispositions, so we do keyword classification
 * webhook-side. Returns one of: hot, follow_up, not_interested, dnc, unknown.
 */
export function classifyElevenLabsOutcome(call: any): string {
  const summary = String(call?.analysis?.transcript_summary ?? "").toLowerCase();
  const evalResult = String(
    call?.analysis?.evaluation_results ?? call?.analysis?.call_successful ?? ""
  ).toLowerCase();
  const transcriptText = (
    flattenTranscript(call?.transcript) ?? ""
  ).toLowerCase();
  const haystack = `${summary} ${evalResult} ${transcriptText}`;

  // DNC / removal requests take priority.
  if (
    /remove me|do not call|don't call|take me off|stop calling|dnc|unsubscribe/.test(
      haystack
    )
  ) {
    return "dnc";
  }
  // Hot: clear buying interest, wants a callback/offer.
  if (
    /very interested|definitely interested|wants an offer|ready to sell|call me back|hot lead|highly motivated|eager to sell/.test(
      haystack
    )
  ) {
    return "hot";
  }
  // Not interested: explicit rejection.
  if (
    /not interested|not selling|don't want to sell|no thanks|leave me alone|hang ?up/.test(
      haystack
    )
  ) {
    return "not_interested";
  }
  // Follow-up: some engagement but not ready now.
  if (
    /call (me |us )?back|follow ?up|maybe later|think about it|not (right )?now|send (me |us )?(more )?info/.test(
      haystack
    )
  ) {
    return "follow_up";
  }
  return "unknown";
}

export async function applyElevenLabsCallUpdate(
  supabase: SupabaseClient,
  callLogId: string,
  call: any
): Promise<void> {
  const status = String(call?.status ?? "").toLowerCase();
  const durationSeconds = Math.round(
    Number(call?.metadata?.call_duration_secs ?? call?.call_duration_secs ?? 0) ||
      0
  );
  const transcript = flattenTranscript(call?.transcript);
  const summary =
    call?.analysis?.transcript_summary ??
    call?.analysis?.summary ??
    null;
  const recordingUrl =
    call?.recording_url ?? call?.has_audio
      ? // Recording is fetched via a separate signed URL; store the
        // conversation id so the UI can request it on demand.
        null
      : null;
  const outcomeTag = classifyElevenLabsOutcome(call);
  const outcome = normalizeDisposition(outcomeTag);
  const conversationId =
    call?.conversation_id ?? call?.conversationId ?? null;

  // Map ElevenLabs status to our status vocabulary.
  let callStatus = "completed";
  if (status === "failed" || status === "error") callStatus = "failed";
  else if (status === "busy") callStatus = "busy";
  else if (status === "no-answer" || status === "no_answer")
    callStatus = "no-answer";
  else if (status === "in-progress" || status === "initiated" || status === "ringing")
    callStatus = "dialing";

  await supabase
    .from("call_logs")
    .update({
      status: callStatus,
      duration_seconds: durationSeconds,
      recording_url: recordingUrl,
      summary,
      outcome,
      transcript,
      provider_call_id: conversationId,
    })
    .eq("id", callLogId);

  // If this call belonged to a batch campaign, mark its audience row done.
  await supabase
    .from("campaign_contacts")
    .update({ status: callStatus })
    .eq("call_log_id", callLogId);

  // Lead + owner come from the log row (webhook metadata is equivalent).
  const { data: log } = await supabase
    .from("call_logs")
    .select("lead_id, user_id")
    .eq("id", callLogId)
    .single();
  const leadId = (log as any)?.lead_id as string | undefined;
  const userId = (log as any)?.user_id as string | undefined;

  // Advance the pipeline on positive signals only — never auto-kills a lead.
  const o = outcome.toLowerCase();
  let newStatus: string | null = null;
  if (o === "hot") {
    newStatus = "qualified";
  } else if (o === "follow-up") {
    newStatus = "contacted";
  } else if (o === "not interested" || o === "dnc") {
    newStatus = "contacted";
  } else if (/voicemail|answering machine/.test(transcript ?? "")) {
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
      .update({ notes: `${(lead as any)?.notes ? (lead as any).notes + "\n" : ""}${line}` })
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
}

/** ElevenLabs conversation statuses that will never change again. */
export function isElevenLabsTerminal(status: string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase();
  return (
    s === "done" ||
    s === "completed" ||
    s === "failed" ||
    s === "error" ||
    s === "busy" ||
    s === "no-answer" ||
    s === "no_answer" ||
    s === "canceled" ||
    s === "cancelled"
  );
}
