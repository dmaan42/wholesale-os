/**
 * Server-only Vapi API helpers (batch campaigns via POST /v2/campaign).
 * Never import from client components — this reads the private API key.
 */

const VAPI_BASE = "https://api.vapi.ai";

function vapiKey(): string {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error("VAPI_API_KEY is not set in Vercel env vars.");
  return key;
}

function vapiIds(): { assistantId: string; phoneNumberId: string } {
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!assistantId || !phoneNumberId) {
    throw new Error(
      "VAPI_ASSISTANT_ID / VAPI_PHONE_NUMBER_ID are not set in Vercel env vars."
    );
  }
  return { assistantId, phoneNumberId };
}

async function vapiFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${vapiKey()}`,
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
  opts: CreateCampaignOptions
): Promise<any> {
  const { assistantId, phoneNumberId } = vapiIds();
  const body: Record<string, unknown> = {
    name: opts.name,
    assistantId,
    phoneNumberId,
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
  return vapiFetch("/v2/campaign", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Live campaign state + counters. */
export async function getVapiCampaign(id: string): Promise<any> {
  return vapiFetch(`/v2/campaign/${encodeURIComponent(id)}?includeCounters=true`);
}

/** Audience members with per-contact status. */
export async function getVapiCampaignContacts(
  id: string,
  limit = 100
): Promise<any> {
  return vapiFetch(
    `/v2/campaign/${encodeURIComponent(id)}/contacts?limit=${limit}`
  );
}

/** Stop a scheduled/running campaign. Calls already in progress may finish. */
export async function cancelVapiCampaign(id: string): Promise<any> {
  return vapiFetch(`/v2/campaign/${encodeURIComponent(id)}`, {
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
