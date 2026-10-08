/**
 * Server-only Vapi API helpers (single calls + batch campaigns).
 * Never import from client components — these handle private API keys.
 *
 * Credentials are per-user: each customer connects their own Vapi account
 * in Settings, and calls are billed to THEIR Vapi account, never the
 * app owner's. Use resolveVapiCreds() to load the caller's keys.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const VAPI_BASE = "https://api.vapi.ai";

export interface VapiCreds {
  apiKey: string;
  assistantId: string;
  phoneNumberId: string;
}

/**
 * Load the calling user's Vapi credentials from their profile.
 * Throws a clear, user-actionable error when they haven't connected Vapi.
 */
export async function resolveVapiCreds(
  supabase: SupabaseClient,
  userId: string
): Promise<VapiCreds> {
  const { data, error } = await supabase
    .from("profiles")
    .select("vapi_api_key, vapi_assistant_id, vapi_phone_number_id")
    .eq("id", userId)
    .single();
  if (error || !data?.vapi_api_key || !data?.vapi_assistant_id || !data?.vapi_phone_number_id) {
    throw new Error(
      "Voice calling isn't connected — open Settings → AI Calling and connect your Vapi account first."
    );
  }
  return {
    apiKey: data.vapi_api_key as string,
    assistantId: data.vapi_assistant_id as string,
    phoneNumberId: data.vapi_phone_number_id as string,
  };
}

async function vapiFetch(
  path: string,
  creds: VapiCreds,
  init?: RequestInit
): Promise<any> {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { message?: string })?.message || `Vapi API error ${res.status}`;
    const err = new Error(msg) as Error & { vapiStatus?: number };
    err.vapiStatus = res.status;
    throw err;
  }
  return data;
}

/** Place a single outbound AI call. Returns the Vapi call object. */
export async function createVapiCall(
  creds: VapiCreds,
  opts: {
    customerNumber: string;
    customerName?: string;
    metadata?: Record<string, string>;
  }
): Promise<any> {
  return vapiFetch("/call", creds, {
    method: "POST",
    body: JSON.stringify({
      assistantId: creds.assistantId,
      phoneNumberId: creds.phoneNumberId,
      customer: {
        number: opts.customerNumber,
        ...(opts.customerName ? { name: opts.customerName } : {}),
      },
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    }),
  });
}

export interface VapiCustomer {
  number: string; // E.164, e.g. +13125550100
  name?: string;
}

export interface CreateCampaignOptions {
  name: string;
  customers: VapiCustomer[];
  maxConcurrency?: number;
  earliestAt?: string; // ISO 8601
  latestAt?: string; // ISO 8601
  metadata?: Record<string, string>;
}

/**
 * Create + launch a Vapi outbound campaign. Campaigns launch immediately
 * unless schedulePlan is provided. Returns the Vapi campaign object.
 */
export async function createVapiCampaign(
  creds: VapiCreds,
  opts: CreateCampaignOptions
): Promise<any> {
  const body: Record<string, unknown> = {
    name: opts.name,
    assistantId: creds.assistantId,
    phoneNumberId: creds.phoneNumberId,
    customers: opts.customers,
    maxConcurrency: opts.maxConcurrency ?? 1,
  };
  if (opts.metadata) body.metadata = opts.metadata;
  if (opts.earliestAt || opts.latestAt) {
    body.schedulePlan = {
      ...(opts.earliestAt ? { earliestAt: opts.earliestAt } : {}),
      ...(opts.latestAt ? { latestAt: opts.latestAt } : {}),
    };
  }
  return vapiFetch("/v2/campaign", creds, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Live campaign state + counters. */
export async function getVapiCampaign(
  creds: VapiCreds,
  id: string
): Promise<any> {
  return vapiFetch(
    `/v2/campaign/${encodeURIComponent(id)}?includeCounters=true`,
    creds
  );
}

/** Audience members with per-contact status. */
export async function getVapiCampaignContacts(
  creds: VapiCreds,
  id: string,
  limit = 100
): Promise<any> {
  return vapiFetch(
    `/v2/campaign/${encodeURIComponent(id)}/contacts?limit=${limit}`,
    creds
  );
}

/** Stop a scheduled/running campaign. Calls already in progress may finish. */
export async function cancelVapiCampaign(
  creds: VapiCreds,
  id: string
): Promise<any> {
  return vapiFetch(`/v2/campaign/${encodeURIComponent(id)}`, creds, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled" }),
  });
}

/**
 * Normalize a loosely-formatted number to E.164. Returns null when the
 * number is unusable (Vapi expects E.164 for campaign audiences).
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
