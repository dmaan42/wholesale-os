/**
 * Server-only ElevenLabs Conversational AI API helpers (single calls + batch campaigns).
 * Never import from client components — these handle private API keys.
 *
 * Credentials are per-user: each customer connects their own ElevenLabs account
 * in Settings, and calls are billed to THEIR ElevenLabs account, never the
 * app owner's. Use resolveElevenLabsCreds() to load the caller's keys.
 *
 * ElevenLabs API docs: https://elevenlabs.io/docs
 * Auth: `xi-api-key: <api_key>` header (server-side only).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export interface ElevenLabsCreds {
  apiKey: string;
  /** ElevenLabs Conversational AI agent ID, e.g. agent_xxxx. */
  agentId: string;
  /** ElevenLabs phone number ID (imported Twilio number), e.g. phnum_xxxx. */
  phoneNumberId: string;
}

/**
 * Load the calling user's ElevenLabs credentials from their profile.
 * Throws a clear, user-actionable error when they haven't connected ElevenLabs.
 */
export async function resolveElevenLabsCreds(
  supabase: SupabaseClient,
  userId: string
): Promise<ElevenLabsCreds> {
  const { data, error } = await supabase
    .from("profiles")
    .select("elevenlabs_api_key, elevenlabs_agent_id, elevenlabs_phone_number_id")
    .eq("id", userId)
    .single();
  if (
    error ||
    !data?.elevenlabs_api_key ||
    !data?.elevenlabs_agent_id ||
    !data?.elevenlabs_phone_number_id
  ) {
    throw new Error(
      "Voice calling isn't connected — open Settings → AI Calling and connect your ElevenLabs account first."
    );
  }
  return {
    apiKey: data.elevenlabs_api_key as string,
    agentId: data.elevenlabs_agent_id as string,
    phoneNumberId: data.elevenlabs_phone_number_id as string,
  };
}

async function elevenLabsFetch(
  path: string,
  creds: ElevenLabsCreds,
  init?: RequestInit
): Promise<any> {
  const res = await fetch(`${ELEVENLABS_BASE}${path}`, {
    ...init,
    headers: {
      "xi-api-key": creds.apiKey,
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { detail?: string; message?: string })?.detail ||
      (data as { message?: string })?.message ||
      `ElevenLabs API error ${res.status}`;
    const err = new Error(msg) as Error & { elevenLabsStatus?: number };
    err.elevenLabsStatus = res.status;
    throw err;
  }
  return data;
}

/**
 * Default seller-qualification prompt. ElevenLabs agents are configured in
 * the ElevenLabs dashboard (agent_id), but per-call dynamic variables
 * (customer_name, contact_city, property_address) personalize the agent's
 * first message and prompt at call time — every subscriber gets identical
 * behavior with no dashboard dependency per call.
 *
 * The agent's system prompt in the dashboard should reference these
 * variables, e.g. {{customer_name}} and {{contact_city}}.
 */
export function sellerQualificationPrompt(opts: {
  contactName?: string;
  contactCity?: string;
  propertyAddress?: string;
  ownerName?: string;
}): string {
  const name = opts.contactName || "there";
  const city = opts.contactCity || "your area";
  const address = opts.propertyAddress ? ` at ${opts.propertyAddress}` : "";
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

/** Outcome tags for classification — applied webhook-side from the transcript/analysis. */
export const ELEVENLABS_DISPOSITIONS = [
  "hot",
  "follow_up",
  "not_interested",
  "dnc",
] as const;

export interface ElevenLabsCallOptions {
  customerNumber: string; // E.164
  customerName?: string;
  contactCity?: string;
  propertyAddress?: string;
  metadata?: Record<string, string>;
  externalId?: string;
}

/**
 * Place a single outbound AI call via ElevenLabs Conversational AI.
 * Returns { conversation_id, callSid, success }.
 */
export async function createElevenLabsCall(
  creds: ElevenLabsCreds,
  opts: ElevenLabsCallOptions
): Promise<{ conversation_id: string; callSid?: string; success: boolean }> {
  return elevenLabsFetch("/convai/twilio/outbound-call", creds, {
    method: "POST",
    body: JSON.stringify({
      agent_id: creds.agentId,
      agent_phone_number_id: creds.phoneNumberId,
      to_number: opts.customerNumber,
      call_recording_enabled: true,
      conversation_initiation_client_data: {
        dynamic_variables: {
          customer_name: opts.customerName || "there",
          contact_city: opts.contactCity || "your area",
          property_address: opts.propertyAddress || "",
        },
      },
    }),
  });
}

/** Live conversation details + status (transcript, analysis, recording). */
export async function getElevenLabsCall(
  creds: ElevenLabsCreds,
  conversationId: string
): Promise<any> {
  return elevenLabsFetch(
    `/convai/conversations/${encodeURIComponent(conversationId)}`,
    creds
  );
}

export interface ElevenLabsBatchRecipient {
  phone_number: string;
  customerName?: string;
  contactCity?: string;
  propertyAddress?: string;
}

/**
 * Submit a batch of outbound calls via ElevenLabs batch calling.
 * Returns the batch object (with batch id for status polling).
 */
export async function submitElevenLabsBatch(
  creds: ElevenLabsCreds,
  opts: {
    callName: string;
    recipients: ElevenLabsBatchRecipient[];
  }
): Promise<any> {
  return elevenLabsFetch("/convai/batch-calling/submit", creds, {
    method: "POST",
    body: JSON.stringify({
      call_name: opts.callName,
      agent_id: creds.agentId,
      agent_phone_number_id: creds.phoneNumberId,
      recipients: opts.recipients.map((r) => ({
        phone_number: r.phone_number,
        conversation_initiation_client_data: {
          dynamic_variables: {
            customer_name: r.customerName || "there",
            contact_city: r.contactCity || "your area",
            property_address: r.propertyAddress || "",
          },
        },
      })),
    }),
  });
}

/**
 * Normalize a loosely-formatted number to E.164. Returns null when the
 * number is unusable.
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

/**
 * Map an outcome tag to the app's outcome vocabulary.
 * ElevenLabs has no native dispositions like Bland — classification happens
 * webhook-side from the transcript/analysis, stored as one of these tags.
 */
export function normalizeDisposition(tag: string | null | undefined): string {
  const t = String(tag || "").toLowerCase();
  if (t === "hot") return "hot";
  if (t === "follow_up" || t === "follow-up") return "follow-up";
  if (t === "not_interested") return "not interested";
  if (t === "dnc") return "dnc";
  return t || "unknown";
}

/**
 * Verify an ElevenLabs webhook signature.
 * Header: `elevenlabs-signature: t=<timestamp>,v0=<hmac>`
 * HMAC-SHA256 of `${t}.${rawBody}` using the API key as the secret.
 */
export async function verifyElevenLabsSignature(
  rawBody: string,
  signatureHeader: string | null,
  apiKey: string
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.trim().split("="))
  );
  const t = parts["t"];
  const v0 = parts["v0"];
  if (!t || !v0) return false;

  const { createHmac } = await import("crypto");
  const expected = createHmac("sha256", apiKey)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  return (
    expected.length === v0.length &&
    (typeof crypto !== "undefined" && (crypto as any).timingSafeEqual
      ? (crypto as any).timingSafeEqual(
          Buffer.from(expected),
          Buffer.from(v0)
        )
      : expected === v0)
  );
}
