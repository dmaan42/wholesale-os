/**
 * Campaign pump branch for provider "own-dialer".
 *
 * Mirrors the ElevenLabs pump's guards (atomic claim, MAX_ATTEMPTS,
 * daily cap, stale in-flight handling, campaign completion) but needs
 * no provider reconciliation API call: Twilio's statusCallback
 * (/api/own-agent/status) already writes every terminal state to
 * call_logs, so reconcile here just reads our own tables.
 *
 * A busy / failed / no-answer Twilio result is a terminal attempt:
 * the contact is marked failed for that attempt and is NOT silently
 * re-queued. Redialing is explicit via the campaign page's
 * retry_failed action, so a bad number can't burn the daily cap.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireActiveSubscription } from "@/lib/api-auth";
import {
  resolveOwnDialerCreds,
  createOwnDialerCall,
  toE164Own,
  TwilioApiError,
} from "@/lib/own-dialer";
import type { PumpResult } from "@/lib/campaign-pump";

export const OWN_DIALER_MAX_ATTEMPTS = 3;
export const OWN_DIALER_DAILY_CALL_CAP = 90;
const STALE_INFLIGHT_MINUTES = 30;
const PER_TICK_MAX = 5;

const TERMINAL_LOG_STATUSES = new Set([
  "completed",
  "failed",
  "busy",
  "no-answer",
  "cancelled",
]);

export async function pumpOwnDialerCampaign(
  supabase: SupabaseClient,
  campaign: {
    id: string;
    user_id: string;
    status: string;
    max_concurrency?: number | null;
    provider?: string | null;
  },
  userId: string,
  opts?: { budgetMs?: number }
): Promise<PumpResult> {
  const started = Date.now();
  const budgetMs = opts?.budgetMs ?? 8000;
  const hasBudget = () => Date.now() - started < budgetMs;
  const id = campaign.id;

  const done = (partial: Partial<PumpResult>): PumpResult => ({
    ok: true,
    reconciled: 0,
    dispatched: 0,
    requeued: 0,
    gaveUp: 0,
    rateLimited: false,
    campaignStatus: campaign.status,
    syncErrors: [],
    providerStatusCounts: {},
    ...partial,
  });

  if (campaign.status === "cancelled" || campaign.status === "completed") {
    return done({ skipped: campaign.status });
  }

  await requireActiveSubscription(supabase, userId);

  let creds;
  try {
    creds = await resolveOwnDialerCreds(supabase, userId);
  } catch (e: any) {
    const err = new Error(e.message) as Error & { status?: number };
    err.status = 503;
    throw err;
  }

  let reconciled = 0;
  let redispatched = 0;
  let requeued = 0;
  let gaveUp = 0;

  // ---- 1) Reconcile in-flight contacts against our own call_logs ----
  const { data: inflight } = await supabase
    .from("campaign_contacts")
    .select("id, lead_id, phone, name, status, call_log_id, attempts, created_at")
    .eq("campaign_id", id)
    .in("status", ["dialing", "dispatching"])
    .order("created_at", { ascending: true })
    .limit(8);

  for (const c of (inflight ?? []) as any[]) {
    if (!hasBudget()) break;
    let log: any = null;
    if (c.call_log_id) {
      const { data } = await supabase
        .from("call_logs")
        .select("id, status, created_at")
        .eq("id", c.call_log_id)
        .single();
      log = data;
    }
    const logStatus = String(log?.status || "");
    if (TERMINAL_LOG_STATUSES.has(logStatus)) {
      // Twilio already reported the end of this call.
      await supabase
        .from("campaign_contacts")
        .update({
          status: logStatus === "completed" ? "completed" : "failed",
        })
        .eq("id", c.id);
      reconciled++;
      continue;
    }
    // Stale in-flight: Twilio never reported a terminal state.
    const refTime = log?.created_at ?? c.created_at;
    const ageMin = (Date.now() - new Date(refTime).getTime()) / 60000;
    if (ageMin > STALE_INFLIGHT_MINUTES) {
      if (log) {
        await supabase
          .from("call_logs")
          .update({
            status: "failed",
            summary:
              "Twilio never reported a terminal call status for 30+ minutes — marked failed so the campaign can move on.",
          })
          .eq("id", log.id);
      }
      await supabase
        .from("campaign_contacts")
        .update({ status: "failed" })
        .eq("id", c.id);
      gaveUp++;
    }
    reconciled++;
  }

  // ---- 2) Dispatch queued contacts ----------------------------------
  const perTick = Math.min(
    Math.max(Number(campaign.max_concurrency) || 2, 1),
    PER_TICK_MAX
  );

  if (hasBudget() && campaign.status === "running") {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count: callsToday } = await supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("provider", "own-dialer")
      .gte("created_at", startOfDay.toISOString());
    if ((callsToday ?? 0) < OWN_DIALER_DAILY_CALL_CAP) {
      const remainingQuota = OWN_DIALER_DAILY_CALL_CAP - (callsToday ?? 0);
      const { data: queued } = await supabase
        .from("campaign_contacts")
        .select("id, lead_id, phone, name, attempts")
        .eq("campaign_id", id)
        .eq("status", "queued")
        .lt("attempts", OWN_DIALER_MAX_ATTEMPTS)
        .order("created_at", { ascending: true })
        .limit(Math.min(perTick, remainingQuota));

      for (const q of (queued ?? []) as any[]) {
        if (!hasBudget()) break;
        const { data: claimed } = await supabase
          .from("campaign_contacts")
          .update({ status: "dispatching" })
          .eq("id", q.id)
          .eq("status", "queued")
          .select("id");
        if (!claimed || (claimed as any[]).length === 0) continue;

        const { data: log, error: logErr } = await supabase
          .from("call_logs")
          .insert({
            user_id: userId,
            lead_id: q.lead_id,
            campaign_id: id,
            phone: q.phone,
            direction: "outbound",
            status: "queued",
            provider: "own-dialer",
          })
          .select("id")
          .single();
        if (logErr || !log) {
          await supabase
            .from("campaign_contacts")
            .update({ status: "queued" })
            .eq("id", q.id);
          continue;
        }
        const logId = (log as any).id as string;
        await supabase
          .from("campaign_contacts")
          .update({ call_log_id: logId })
          .eq("id", q.id);

        try {
          const dialable = toE164Own(q.phone);
          if (!dialable) {
            await supabase
              .from("call_logs")
              .update({
                status: "failed",
                summary: `Phone number is not dialable: "${q.phone ?? ""}"`,
              })
              .eq("id", logId);
            await supabase
              .from("campaign_contacts")
              .update({
                status: "failed",
                attempts: (q.attempts ?? 0) + 1,
              })
              .eq("id", q.id);
            continue;
          }
          const { callSid } = await createOwnDialerCall(creds, {
            to: dialable,
            callLogId: logId,
            leadName: (q as any).name || "",
          });
          await supabase
            .from("call_logs")
            .update({ status: "ringing", provider_call_id: callSid })
            .eq("id", logId);
          await supabase
            .from("campaign_contacts")
            .update({
              status: "dialing",
              attempts: (q.attempts ?? 0) + 1,
            })
            .eq("id", q.id);
          redispatched++;
        } catch (e: any) {
          const verbatim =
            e instanceof TwilioApiError
              ? e.verbatim
              : `Twilio error: ${e?.message || "Dial failed"}`;
          await supabase
            .from("call_logs")
            .update({ status: "failed", summary: verbatim })
            .eq("id", logId);
          await supabase
            .from("campaign_contacts")
            .update({
              status: "failed",
              attempts: (q.attempts ?? 0) + 1,
            })
            .eq("id", q.id);
        }
      }
    }
  }

  // ---- 3) Complete the campaign when nothing is left -----------------
  const { count: remaining } = await supabase
    .from("campaign_contacts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id)
    .in("status", ["queued", "dialing", "dispatching"]);
  let campaignStatus = campaign.status as string;
  if ((remaining ?? 0) === 0 && campaignStatus === "running") {
    await supabase
      .from("campaigns")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", id);
    campaignStatus = "completed";
  }

  return done({
    reconciled,
    dispatched: redispatched,
    requeued,
    gaveUp,
    rateLimited: false,
    campaignStatus,
  });
}
