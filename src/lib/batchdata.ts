/**
 * Server-only BatchData API helpers (property data + skip tracing).
 * Never import from client components — these handle private API keys.
 *
 * Credentials are per-user: each customer connects their own BatchData
 * account in Settings → Data & Skip Tracing, and lookups are billed to
 * THEIR BatchData account, never the app owner's. Use resolveBatchDataCreds()
 * to load the caller's key.
 *
 * BatchData API docs: https://docs.batchdata.com/
 * Auth: `Authorization: Bearer <api_key>`.
 * Skip trace: POST /api/v1/property/skip-trace
 *   body: { requests: [{ propertyAddress: { street, city, state, zip } }] }
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const BATCHDATA_BASE = "https://api.batchdata.com";

/** Estimated billable cost per matched person record, in cents. */
export const SKIP_TRACE_COST_CENTS_PER_MATCH = 15;

export interface BatchDataCreds {
  apiKey: string;
}

/**
 * Load the calling user's BatchData API key from their profile.
 * Throws a clear, user-actionable error when they haven't connected it.
 */
export async function resolveBatchDataCreds(
  supabase: SupabaseClient,
  userId: string
): Promise<BatchDataCreds> {
  const { data, error } = await supabase
    .from("profiles")
    .select("batchdata_api_key")
    .eq("id", userId)
    .single();
  if (error || !data?.batchdata_api_key) {
    throw new Error(
      "Skip tracing isn't connected — open Settings → Data & Skip Tracing and connect your BatchData account first."
    );
  }
  return { apiKey: data.batchdata_api_key as string };
}

async function batchDataFetch(
  path: string,
  creds: BatchDataCreds,
  init?: RequestInit
): Promise<any> {
  const res = await fetch(`${BATCHDATA_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { message?: string; error?: string })?.message ||
      (data as { error?: string })?.error ||
      `BatchData API error ${res.status}`;
    const err = new Error(msg) as Error & { batchDataStatus?: number };
    err.batchDataStatus = res.status;
    throw err;
  }
  return data;
}

export interface SkipTracePhone {
  number: string;
  type: string | null;
  dnc: boolean;
  litigator: boolean;
}

export interface SkipTracePerson {
  name: string | null;
  phones: SkipTracePhone[];
  emails: string[];
}

export interface SkipTraceResult {
  ownerName: string | null;
  persons: SkipTracePerson[];
  /** Number of matched person records (what BatchData bills on). */
  matchedCount: number;
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || String(v).toLowerCase() === "true";
}

function cleanDigits(raw: string | null | undefined): string {
  return (raw || "").replace(/\D/g, "");
}

/**
 * Normalize BatchData's skip-trace response into a stable shape.
 * The API has shipped v1/v3 variants with slightly different field names,
 * so this checks several known shapes defensively.
 */
export function normalizeSkipTraceResponse(data: any): SkipTraceResult {
  const out: SkipTraceResult = { ownerName: null, persons: [], matchedCount: 0 };

  const root = data?.results?.[0] ?? data?.result ?? data ?? {};
  const owner = root.owner ?? root ?? {};

  // Owner name candidates across API versions.
  out.ownerName =
    owner.name ??
    owner.ownerName ??
    (owner.firstName || owner.lastName
      ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim()
      : null) ??
    null;

  const rawPersons: any[] =
    owner.persons ?? owner.people ?? owner.contacts ?? (Array.isArray(root.persons) ? root.persons : []);

  for (const p of rawPersons) {
    const name =
      p.name ??
      p.fullName ??
      (p.firstName || p.lastName
        ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()
        : null);

    const rawPhones: any[] =
      p.phoneNumbers ?? p.phones ?? p.phone_numbers ?? [];
    const phones: SkipTracePhone[] = [];
    for (const ph of rawPhones) {
      const num = cleanDigits(
        typeof ph === "string" ? ph : (ph.number ?? ph.phoneNumber ?? ph.phone ?? "")
      );
      if (!num) continue;
      phones.push({
        number: num,
        type: (typeof ph === "object" ? (ph.type ?? ph.phoneType ?? null) : null) as string | null,
        dnc: typeof ph === "object" ? toBool(ph.dnc ?? ph.doNotCall ?? ph.DNC) : false,
        litigator: typeof ph === "object" ? toBool(ph.litigator ?? ph.isLitigator) : false,
      });
    }

    const rawEmails: any[] = p.emails ?? p.emailAddresses ?? [];
    const emails: string[] = [];
    for (const e of rawEmails) {
      const addr = typeof e === "string" ? e : (e.email ?? e.emailAddress ?? "");
      if (addr && typeof addr === "string" && addr.includes("@")) emails.push(addr);
    }

    // Only count persons that actually have contact data (billable matches).
    if (phones.length > 0 || emails.length > 0 || name) {
      out.persons.push({ name, phones, emails });
    }
  }

  // Fallback: some responses put phones directly on the owner object.
  if (out.persons.length === 0) {
    const directPhones: any[] = owner.phoneNumbers ?? owner.phones ?? [];
    if (directPhones.length > 0) {
      const phones: SkipTracePhone[] = [];
      for (const ph of directPhones) {
        const num = cleanDigits(
          typeof ph === "string" ? ph : (ph.number ?? ph.phoneNumber ?? "")
        );
        if (!num) continue;
        phones.push({
          number: num,
          type: (typeof ph === "object" ? (ph.type ?? null) : null) as string | null,
          dnc: typeof ph === "object" ? toBool(ph.dnc ?? ph.doNotCall) : false,
          litigator: typeof ph === "object" ? toBool(ph.litigator) : false,
        });
      }
      if (phones.length > 0) {
        out.persons.push({ name: out.ownerName, phones, emails: [] });
      }
    }
  }

  out.matchedCount = out.persons.length;
  if (!out.ownerName && out.persons[0]?.name) {
    out.ownerName = out.persons[0].name;
  }
  return out;
}

export interface SkipTraceAddress {
  street: string;
  city?: string;
  state: string;
  zip?: string;
}

/**
 * Skip trace a property address. Returns normalized owner/contact data.
 * Each matched person record counts as billable usage on the user's
 * BatchData account.
 */
export async function skipTraceProperty(
  creds: BatchDataCreds,
  address: SkipTraceAddress
): Promise<SkipTraceResult> {
  const data = await batchDataFetch("/api/v1/property/skip-trace", creds, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          propertyAddress: {
            street: address.street,
            ...(address.city ? { city: address.city } : {}),
            state: address.state,
            ...(address.zip ? { zip: address.zip } : {}),
          },
        },
      ],
    }),
  });
  return normalizeSkipTraceResponse(data);
}

/** First phone that is neither DNC nor litigator-flagged, or null. */
export function firstCallablePhone(result: SkipTraceResult): string | null {
  for (const person of result.persons) {
    for (const phone of person.phones) {
      if (!phone.dnc && !phone.litigator) return phone.number;
    }
  }
  return null;
}
