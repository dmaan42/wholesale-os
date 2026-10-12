/**
 * Server-only Bland AI API helpers (single calls + batch campaigns).
 * Never import from client components — these handle private API keys.
 *
 * Credentials are per-user: each customer connects their own Bland account
 * in Settings, and calls are billed to THEIR Bland account, never the
 * app owner's. Use resolveBlandCreds() to load the caller's keys.
 *
 * Bland API docs: https://docs.bland.ai
 * Auth: `authorization: <api_key>` header (no Bearer prefix).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const BLAND_BASE = "https://api.bland.ai/v1";

export interface BlandCreds {
  apiKey: string;
  /** E.164 caller ID, e.g. +14785518838. Must be a number on the user's Bland account. */
  fromNumber: string;
}

/**
 * Load the calling user's Bland credentials from their profile.
 * Throws a clear, user-actionable error when they haven't connected Bland.
 */
export async function resolveBlandCreds(
  supabase: SupabaseClient,
  userId: string
): Promise<BlandCreds> {
  const { data, error } = await supabase
    .from("profiles")
    .select("bland_api_key, bland_from_number")
    .eq("id", userId)
    .single();
  if (error || !data?.bland_api_key || !data?.bland_from_number) {
    throw new Error(
      "Voice calling isn't connected — open Settings → AI Calling and connect your Bland AI account first."
    );
  }
  return {
    apiKey: data.bland_api_key as string,
    fromNumber: data.bland_from_number as string,
  };
}

async function blandFetch(
  path: string,
  creds: BlandCreds,
  init?: RequestInit
): Promise<any> {
  const res = await fetch(`${BLAND_BASE}${path}`, {
    ...init,
    headers: {
      authorization: creds.apiKey,
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { message?: string })?.message ||
      `Bland API error ${res.status}`;
    const err = new Error(msg) as Error & { blandStatus?: number };
    err.blandStatus = res.status;
    throw err;
  }
  return data;
}

/**
 * Default seller-qualification prompt sent as `task` on every call.
 * Bland's v1 /calls endpoint does not accept an agent_id, so the prompt
 * lives server-side and is sent per call — every subscriber gets identical
 * behavior with no dashboard dependency at call time.
 */
export function sellerQualificationTask(opts: {
  contactName?: string;
  contactCity?: string;
  propertyAddress?: string;
  ownerName?: string;
}): string {
  const name = opts.contactName || "there";
  const city = opts.contactCity || "your area";
  const address = opts.propertyAddress
    ? ` at ${opts.propertyAddress}`
    : "";
  return [
    `You are Alex, calling on behalf of Darren, a real estate investor who buys houses in ${city}.`,
    `You are calling ${name} about their property${address}.`,
    ``,
    `Your goal is to qualify them as a motivated seller. Have a natural, friendly conversation — one question at a time, never pushy.`,
    ``,
    `Qualify on:`,
    `1. Motivation — why might they consider selling?`,
    `2. Timeline — how soon do they want to sell?`,
    `3. Price — what are they hoping to get for the property?`,
    `4. Condition — what's the general condition of the property?`,
    ``,
    `Rules:`,
    `- Introduce yourself as Alex calling on behalf of Darren, a local real estate investor.`,
    `- Never claim to be Darren. Never quote a specific offer price.`,
    `- If they ask to be removed from the list, acknowledge it politely and end the call.`,
    `- Keep responses short and conversational, like a real phone call.`,
    `- If you reach voicemail, leave a brief message: your name, that you're calling on behalf of Darren about their property, and a callback number.`,
  ].join("\n");
}

/** Outcome tags Bland's AI will pick from — returned as disposition_tag in the webhook. */
export const BLAND_DISPOSITIONS = [
  "hot",
  "follow_up",
  "not_interested",
  "dnc",
] as const;

export interface BlandCallOptions {
  customerNumber: string; // E.164
  customerName?: string;
  contactCity?: string;
  propertyAddress?: string;
  webhookUrl: string;
  metadata?: Record<string, string>;
  externalId?: string;
  maxDurationMinutes?: number;
}

/** Place a single outbound AI call. Returns the Bland call object (with call_id). */
export async function createBlandCall(
  creds: BlandCreds,
  opts: BlandCallOptions
): Promise<any> {
  return blandFetch("/calls", creds, {
    method: "POST",
    body: JSON.stringify({
      phone_number: opts.customerNumber,
      task: sellerQualificationTask({
        contactName: opts.customerName,
        contactCity: opts.contactCity,
        propertyAddress: opts.propertyAddress,
      }),
      voice: "Sophie",
      from: creds.fromNumber,
      webhook: opts.webhookUrl,
      record: true,
      metadata: opts.metadata ?? {},
      ...(opts.externalId ? { external_id: opts.externalId } : {}),
      max_duration: opts.maxDurationMinutes ?? 5,
      answered_by_enabled: true,
      voicemail_action: "hangup",
      dispositions: [...BLAND_DISPOSITIONS],
    }),
  });
}

/** Live call details + status. */
export async function getBlandCall(
  creds: BlandCreds,
  callId: string
): Promise<any> {
  return blandFetch(`/calls/${encodeURIComponent(callId)}`, creds);
}

/** End a live call. */
export async function stopBlandCall(
  creds: BlandCreds,
  callId: string
): Promise<any> {
  return blandFetch(`/calls/${encodeURIComponent(callId)}/stop`, creds, {
    method: "POST",
  });
}

export interface BlandBatchCallObject {
  phone_number: string;
  /** Contact name — personalizes the seller-qualification prompt. */
  name?: string;
  task?: string;
  metadata?: Record<string, string>;
  external_id?: string;
}

/**
 * Place many calls with simple concurrency control.
 * Bland also offers a /v2 batches endpoint, but sequential dispatch with
 * local concurrency (1–3 at a time, matching the existing campaign UX)
 * is simpler and gives per-call error handling.
 */
export async function dispatchBlandCalls(
  creds: BlandCreds,
  calls: BlandBatchCallObject[],
  opts: {
    webhookUrl: string;
    fromNumber?: string;
    maxConcurrency?: number;
    onCallPlaced?: (index: number, callId: string) => Promise<void>;
    onCallFailed?: (index: number, error: string) => Promise<void>;
  }
): Promise<{ placed: number; failed: number }> {
  const concurrency = Math.min(Math.max(opts.maxConcurrency ?? 2, 1), 10);
  let placed = 0;
  let failed = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < calls.length) {
      const i = next++;
      const c = calls[i];
      try {
        const res = await createBlandCall(creds, {
          customerNumber: c.phone_number,
          customerName: c.name || undefined,
          webhookUrl: opts.webhookUrl,
          metadata: c.metadata,
          externalId: c.external_id,
        });
        placed++;
        if (opts.onCallPlaced && res?.call_id) {
          await opts.onCallPlaced(i, res.call_id);
        }
      } catch (e: any) {
        failed++;
        if (opts.onCallFailed) {
          await opts.onCallFailed(i, e.message || "Bland API error");
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, calls.length) }, () =>
      worker()
    )
  );
  return { placed, failed };
}

/**
 * Normalize a loosely-formatted number to E.164. Returns null when the
 * number is unusable (Bland expects E.164).
 */
export function toE164(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Digits only — for matching a dialed number back to a stored one. */
export function digitsOnly(raw: string | null | undefined): string {
  return (raw || "").replace(/\D/g, "");
}

/** Map Bland's disposition_tag to the app's outcome vocabulary. */
export function normalizeDisposition(tag: string | null | undefined): string {
  const t = String(tag || "").toLowerCase();
  if (t === "hot") return "hot";
  if (t === "follow_up" || t === "follow-up") return "follow-up";
  if (t === "not_interested") return "not interested";
  if (t === "dnc") return "dnc";
  return t || "unknown";
}
