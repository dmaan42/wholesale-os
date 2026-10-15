import type { SupabaseClient } from "@supabase/supabase-js";
import { requireActiveSubscription } from "@/lib/api-auth";
import {
  resolveElevenLabsCreds,
  createElevenLabsCall,
  getElevenLabsCall,
} from "@/lib/elevenlabs";
import {
  applyElevenLabsCallUpdate,
  isElevenLabsTerminal,
} from "@/lib/elevenlabs-sync";

/**
 * Server-side campaign pump — shared by the per-campaign endpoint and the
 * Vercel Cron sweeper. Dispatches calls independently of any browser tab.
 *
 * Reliability guards:
 * - MAX_ATTEMPTS: a contact that fails to place 3 times is marked permanently
 *   failed instead of being redialed forever (this previously burned through
 *   the provider's daily call limit via the reconcile re-queue loop).
 * - DAILY_CALL_CAP: never dispatch when the user is near their provider daily
 *   call limit (ElevenLabs Creator ≈ 100 convos/day); reconcile still runs.
 * - Rate-limit errors (429 / quota messages) re-queue the contact WITHOUT
 *   consuming an attempt and halt dispatch for the tick.
 * - STALE_INFLIGHT_MINUTES: a provider-side call stuck in a non-terminal
 *   status (e.g. "initiated") for 30+ minutes is marked failed and the
 *   contact re-queued, so dead calls can't wedge the reconcile queue.
 * - Bounded work per invocation so serverless timeouts can't kill a batch
 *   mid-dispatch.
 */

export const MAX_ATTEMPTS = 3;
export const DAILY_CALL_CAP = 90;
const STALE_DISPATCH_MINUTES = 15;
// A provider-side call that never reaches a terminal status (e.g. stuck at
// "initiated") is dead — stop waiting and re-queue the contact instead of
// leaving it "dialing" forever and blocking the reconcile queue behind it.
const STALE_INFLIGHT_MINUTES = 30;
const PER_TICK_MAX = 5;

export interface PumpResult {
  ok: boolean;
  skipped?: string;
  reconciled: number;
  dispatched: number;
  requeued: number;
  gaveUp: number;
  rateLimited: boolean;
  campaignStatus: string;
  /** Per-tick ElevenLabs sync failures (non-404) — surfaced so stale
   *  "dialing" labels are diagnosable from the pump-all response. */
  syncErrors: string[];
  /** Provider statuses seen this tick that were NOT terminal (e.g. how
   *  many in-flight conversations ElevenLabs still reports as
   *  in-progress/processing). Distinguishes "API failing" from
   *  "provider never reports terminal". */
  providerStatusCounts: Record<string, number>;
}

function isRateLimitError(e: any): boolean {
  if (e?.elevenLabsStatus === 429) return true;
  const msg = String(e?.message ?? "").toLowerCase();
  return /rate.?limit|too many requests|daily limit|quota|429/.test(msg);
}

async function markGaveUp(
  supabase: SupabaseClient,
  contactId: string,
  logId: string | null,
  reason: string
): Promise<void> {
  if (logId) {
    await supabase
      .from("call_logs")
      .update({ status: "failed", summary: reason })
      .eq("id", logId);
  }
  await supabase
    .from("campaign_contacts")
    .update({ status: "failed" })
    .eq("id", contactId);
}

export async function pumpCampaign(
  supabase: SupabaseClient,
  campaign: {
    id: string;
    user_id: string;
    status: string;
    max_concurrency?: number | null;
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

  // Paywall: placing calls requires an active subscription or trial.
  await requireActiveSubscription(supabase, userId);

  let creds;
  try {
    creds = await resolveElevenLabsCreds(supabase, userId);
  } catch (e: any) {
    const err = new Error(e.message) as Error & { status?: number };
    err.status = 503;
    throw err;
  }

  // Note: ElevenLabs post-call webhooks are configured on the agent in the
  // ElevenLabs dashboard (not per call). The webhook endpoint is:
  //   <app-origin>/api/elevenlabs-webhook[?secret=<VOICE_WEBHOOK_SECRET>]
  // Configure it once on the agent; no per-call webhook needed here.

  let reconciled = 0;
  let redispatched = 0;
  let requeued = 0;
  let gaveUp = 0;
  let rateLimited = false;
  const syncErrors: string[] = [];
  const providerStatusCounts: Record<string, number> = {};

  // ---- 1) Reconcile in-flight contacts against ElevenLabs -------------
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
        .select("id, provider_call_id, created_at")
        .eq("id", c.call_log_id)
        .single();
      log = data;
    }
    const providerCallId = log?.provider_call_id as string | undefined;

    if (!providerCallId) {
      // ElevenLabs never accepted this call. If it's stale, re-queue it —
      // unless it's exhausted its attempts, in which case give up for good.
      const refTime = log?.created_at ?? c.created_at;
      const ageMin = (Date.now() - new Date(refTime).getTime()) / 60000;
      if (ageMin > STALE_DISPATCH_MINUTES) {
        if ((c.attempts ?? 0) >= MAX_ATTEMPTS) {
          await markGaveUp(
            supabase,
            c.id,
            log?.id ?? null,
            `Gave up after ${MAX_ATTEMPTS} dispatch attempts — the provider never accepted the call.`
          );
          gaveUp++;
          console.warn(
            `[pump] campaign ${id}: contact ${c.id} gave up after ${MAX_ATTEMPTS} dispatch attempts (no provider call id)`
          );
        } else {
          if (log) {
            await supabase
              .from("call_logs")
              .update({
                status: "failed",
                summary:
                  "Dispatch interrupted before ElevenLabs accepted the call — re-queued.",
              })
              .eq("id", log.id);
          }
          await supabase
            .from("campaign_contacts")
            .update({ status: "queued", call_log_id: null })
            .eq("id", c.id);
          requeued++;
        }
      }
      reconciled++;
      continue;
    }

    try {
      const call = await getElevenLabsCall(creds, providerCallId);
      const rawStatus = String(call?.status ?? "").toLowerCase();
      if (isElevenLabsTerminal(call?.status)) {
        await applyElevenLabsCallUpdate(supabase, log.id, call);
      } else {
        // Not terminal yet — count it so the pump-all response shows
        // whether the provider is lagging vs the API failing.
        providerStatusCounts[rawStatus || "(no status)"] =
          (providerStatusCounts[rawStatus || "(no status)"] ?? 0) + 1;
        // A call stuck in a non-terminal provider status for too long will
        // never complete (observed: "initiated" for 90+ minutes). Fail it and
        // re-queue the contact so the campaign keeps moving; attempts were
        // already consumed when the call was dispatched, so MAX_ATTEMPTS
        // still bounds total retries.
        const refTime = log?.created_at ?? c.created_at;
        const ageMin = (Date.now() - new Date(refTime).getTime()) / 60000;
        if (ageMin > STALE_INFLIGHT_MINUTES) {
          if ((c.attempts ?? 0) >= MAX_ATTEMPTS) {
            await markGaveUp(
              supabase,
              c.id,
              log?.id ?? null,
              `Gave up after ${MAX_ATTEMPTS} attempts — the provider never completed the call (stuck at "${rawStatus}").`
            );
            gaveUp++;
          } else {
            await supabase
              .from("call_logs")
              .update({
                status: "failed",
                summary: `Call stuck at provider status "${rawStatus || "unknown"}" for ${Math.round(ageMin)} min — never started, re-queued.`,
              })
              .eq("id", log.id);
            await supabase
              .from("campaign_contacts")
              .update({ status: "queued", call_log_id: null })
              .eq("id", c.id);
            requeued++;
          }
        } else {
          console.warn(
            `[pump] campaign ${id}: contact ${c.id} conv ${providerCallId} ` +
              `provider status "${rawStatus || "(missing)"}" — not terminal, leaving in flight`
          );
        }
      }
    } catch (e: any) {
      const errStatus = e?.elevenLabsStatus ?? "?";
      const errMsg = e?.message ?? String(e);
      if (errStatus === 404) {
        // ElevenLabs has no record of this conversation in the user's
        // account — it will never complete. Re-queue unless attempts are
        // exhausted.
        if ((c.attempts ?? 0) >= MAX_ATTEMPTS) {
          await markGaveUp(
            supabase,
            c.id,
            log?.id ?? null,
            `Gave up after ${MAX_ATTEMPTS} attempts — the provider has no record of this call.`
          );
          gaveUp++;
        } else {
          await supabase
            .from("call_logs")
            .update({
              status: "failed",
              summary:
                "Call not found in your ElevenLabs account (stale dispatch) — re-queued.",
            })
            .eq("id", log.id);
          await supabase
            .from("campaign_contacts")
            .update({ status: "queued", call_log_id: null })
            .eq("id", c.id);
          requeued++;
        }
        console.warn(
          `[pump] campaign ${id}: contact ${c.id} conv ${providerCallId} ` +
            `not found in ElevenLabs account (404) — ` +
            `${(c.attempts ?? 0) >= MAX_ATTEMPTS ? "gave up" : "re-queued"}`
        );
      } else {
        // Previously these were swallowed silently, leaving the contact
        // stuck on "dialing" with no trace. Surface them in the pump
        // result and Vercel logs so the sync failure is diagnosable.
        const entry =
          `contact ${c.id} conv ${providerCallId}: [${errStatus}] ${errMsg}`;
        syncErrors.push(entry);
        console.error(`[pump] campaign ${id}: ElevenLabs sync error ${entry}`);
      }
    }
    reconciled++;
  }

  // ---- 2) Dispatch a few queued contacts -------------------------------
  // Honor the campaign's chosen pace (set at launch), capped so one tick
  // stays well under the serverless timeout.
  const perTick = Math.min(
    Math.max(Number(campaign.max_concurrency) || 2, 1),
    PER_TICK_MAX
  );

  if (hasBudget() && campaign.status === "running" && !rateLimited) {
    // Daily provider cap: don't dispatch when the user is near their
    // ElevenLabs daily conversation limit. Reconcile still ran above.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: callsToday } = await supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("provider", "elevenlabs")
      .gte("created_at", dayAgo);
    if ((callsToday ?? 0) >= DAILY_CALL_CAP) {
      rateLimited = true;
    } else {
      const remaining_quota = DAILY_CALL_CAP - (callsToday ?? 0);
      const { data: queued } = await supabase
        .from("campaign_contacts")
        .select("id, lead_id, phone, name, attempts")
        .eq("campaign_id", id)
        .eq("status", "queued")
        .lt("attempts", MAX_ATTEMPTS)
        .order("created_at", { ascending: true })
        .limit(Math.min(perTick, remaining_quota));

      for (const q of (queued ?? []) as any[]) {
        if (!hasBudget()) break;

        // Atomic claim: only one pumper can take this row.
        const { data: claimed } = await supabase
          .from("campaign_contacts")
          .update({ status: "dispatching" })
          .eq("id", q.id)
          .eq("status", "queued")
          .select("id");
        if (!claimed || (claimed as any[]).length === 0) continue;

        // Log first so there's a record even if the provider call fails.
        const { data: log, error: logErr } = await supabase
          .from("call_logs")
          .insert({
            user_id: userId,
            lead_id: q.lead_id,
            campaign_id: id,
            phone: q.phone,
            direction: "outbound",
            status: "queued",
            provider: "elevenlabs",
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
          const res = await createElevenLabsCall(creds, {
            customerNumber: q.phone,
            customerName: q.name || undefined,
            metadata: {
              wholesaleOsLeadId: q.lead_id ?? "",
              wholesaleOsUserId: userId,
              wholesaleOsCampaignId: id,
              wholesaleOsCallLogId: logId,
            },
            externalId: `wholesaleos-${logId}`,
          });
          const conversationId = (res as any)?.conversation_id;
          if (!conversationId)
            throw new Error("ElevenLabs did not return a conversation id");
          await supabase
            .from("call_logs")
            .update({ status: "ringing", provider_call_id: conversationId })
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
          if (isRateLimitError(e)) {
            // Transient provider limit — re-queue WITHOUT consuming an
            // attempt, and stop dispatching this tick.
            await supabase
              .from("call_logs")
              .update({
                status: "failed",
                summary: `Provider rate limit — will retry automatically: ${e.message || "limit reached"}`,
              })
              .eq("id", logId);
            await supabase
              .from("campaign_contacts")
              .update({ status: "queued", call_log_id: null })
              .eq("id", q.id);
            rateLimited = true;
            break;
          }
          await supabase
            .from("call_logs")
            .update({
              status: "failed",
              summary: `Provider error: ${e.message || "ElevenLabs API error"}`,
            })
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

  // ---- 3) Complete the campaign when nothing is left --------------------
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
    rateLimited,
    campaignStatus,
    syncErrors,
    providerStatusCounts,
  });
}
