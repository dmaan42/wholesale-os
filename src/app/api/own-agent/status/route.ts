import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * POST /api/own-agent/status — Twilio statusCallback for own-dialer
 * calls (also the AsyncAmd callback). This is the fix for silent
 * "unknown" failures: every terminal Twilio state is written to
 * call_logs with its duration, and the campaign contact row is moved
 * to match. Nothing here overwrites a disposition the voice agent
 * already recorded from real answers.
 *
 * Twilio CallStatus values: queued, ringing, in-progress, completed,
 * busy, failed, no-answer, canceled.
 * call_logs.status uses the same vocabulary except canceled -> cancelled.
 */
const TERMINAL = new Set(["completed", "busy", "failed", "no-answer", "cancelled"]);

function mapStatus(raw: string): string {
  if (raw === "canceled") return "cancelled";
  return raw;
}

function terminalReason(raw: string, duration: number): string {
  switch (raw) {
    case "busy":
      return "Twilio reported the line busy.";
    case "no-answer":
      return "Twilio reported no answer (call rang out).";
    case "failed":
      return "Twilio reported the call failed before connecting.";
    case "cancelled":
      return "Twilio reported the call was canceled.";
    case "completed":
      return duration > 0
        ? `Twilio reported the call completed (${duration}s).`
        : "Twilio reported the call completed with no talk time.";
    default:
      return `Twilio reported call status "${raw}".`;
  }
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => new FormData());
  const fields: Record<string, string> = {};
  form.forEach((v, k) => {
    fields[k] = String(v);
  });
  const callSid = fields.CallSid || "";
  const rawStatus = (fields.CallStatus || "").toLowerCase();
  const duration = Number(fields.CallDuration || 0) || 0;
  if (!callSid || !rawStatus) {
    return NextResponse.json({ received: true });
  }
  const status = mapStatus(rawStatus);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
  const { data: log } = await supabase
    .from("call_logs")
    .select("id, campaign_id, status, outcome, summary")
    .eq("provider_call_id", callSid)
    .eq("provider", "own-dialer")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (!log) return NextResponse.json({ received: true });

  const update: Record<string, unknown> = {
    status,
    duration_seconds: duration,
  };
  if (TERMINAL.has(status)) {
    // Never overwrite a voice-agent outcome/summary. Only fill the
    // gap when the call never reached a conversation (busy / failed /
    // no-answer), where the Twilio state IS the reason.
    if (!((log as any).outcome) && status !== "completed") {
      update.outcome = status === "cancelled" ? "failed" : status;
    }
    if (!((log as any).summary)) {
      update.summary = terminalReason(rawStatus, duration);
    }
    // A completed call with no answers keeps a null outcome — the
    // voice route's summary already says no qualifying answers were
    // given. Do not invent a disposition here.
  }
  await supabase.from("call_logs").update(update).eq("id", (log as any).id);

  // Move the campaign contact row to match, when this call belongs to
  // one. A completed call (any outcome) counts as completed; a
  // busy/failed/no-answer/cancelled call counts as failed for that
  // attempt — explicit retry_failed is how it gets redialed.
  if ((log as any).campaign_id && TERMINAL.has(status)) {
    const contactStatus = status === "completed" ? "completed" : "failed";
    await supabase
      .from("campaign_contacts")
      .update({ status: contactStatus })
      .eq("campaign_id", (log as any).campaign_id)
      .eq("call_log_id", (log as any).id);
  }

  return NextResponse.json({ received: true });
}
