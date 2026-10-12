import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDisposition } from "@/lib/bland";

/**
 * Shared Bland call-result applier.
 * Used by the post-call webhook AND by the campaign pump's reconcile pass,
 * so both paths write identical outcomes to call_logs, campaign_contacts
 * and the lead pipeline.
 *
 * `call` is a Bland call object (from the webhook payload or GET /calls/{id}).
 */
export async function applyBlandCallUpdate(
  supabase: SupabaseClient,
  callLogId: string,
  call: any
): Promise<void> {
  const status = String(call?.status ?? "").toLowerCase();
  const answeredBy = String(call?.answered_by ?? "").toLowerCase();
  const durationSeconds = Math.round(
    Number(call?.corrected_duration ?? 0) || 0
  );
  const recordingUrl = call?.recording_url ?? null;
  const summary = call?.summary ?? null;
  const transcript = call?.concatenated_transcript ?? null;
  const dispositionTag = call?.disposition_tag ?? null;
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
      provider_call_id: call?.call_id ?? null,
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

/** Bland call statuses that will never change again. */
export function isBlandTerminal(status: string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase();
  return (
    s === "completed" ||
    s === "failed" ||
    s === "busy" ||
    s === "no-answer" ||
    s === "canceled" ||
    s === "cancelled"
  );
}
