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
 * Property search: POST /api/v1/property/search
 *   body: { searchCriteria: {...}, options: { take, skip, sort, datasets } }
 *   Multiple searchCriteria are AND-ed. take: 0 returns count only
 *   (meta.resultsFound), billed at the 1-record minimum.
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

// ==================== Property Search ====================

/** String operators accepted by BatchData search filters. */
export interface StringFilter {
  equals?: string;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  inList?: string[];
}

/** Number operators accepted by BatchData search filters. */
export interface NumberFilter {
  min?: number;
  max?: number;
}

/** Boolean operator accepted by BatchData search filters. */
export interface BooleanFilter {
  equals?: boolean;
}

/**
 * BatchData property-search criteria. Multiple criteria are AND-ed.
 * See https://docs.batchdata.com/ for the full filter reference.
 */
export interface PropertySearchCriteria {
  quickLists?: string[];
  orQuickLists?: string[];
  address?: {
    zip?: StringFilter;
    city?: StringFilter;
    state?: StringFilter;
    county?: StringFilter;
  };
  listing?: {
    status?: StringFilter;
    statusCategory?: StringFilter;
    price?: NumberFilter;
    daysOnMarket?: NumberFilter;
  };
  valuation?: {
    estimatedValue?: NumberFilter;
    equityPercent?: NumberFilter;
    ltv?: NumberFilter;
  };
  building?: {
    bedroomCount?: NumberFilter;
    bathroomCount?: NumberFilter;
    livingAreaSquareFeet?: NumberFilter;
    yearBuilt?: NumberFilter;
  };
  general?: {
    propertyTypeCategory?: StringFilter;
    propertyTypeDetail?: StringFilter;
  };
  tax?: {
    taxDelinquentYear?: NumberFilter;
  };
  foreclosure?: {
    status?: StringFilter;
    recordingDate?: { minDate?: string; maxDate?: string };
    auctionDate?: { minDate?: string; maxDate?: string };
  };
  owner?: {
    ownerOccupied?: BooleanFilter;
  };
  sale?: {
    lastSalePrice?: NumberFilter;
    lastSaleDate?: { minDate?: string; maxDate?: string };
  };
}

export interface PropertySearchOptions {
  /** 0-100, default 25. Use 0 for count-only (returns meta.resultsFound). */
  take?: number;
  skip?: number;
  sort?: Record<string, "asc" | "desc">;
  datasets?: string[];
}

export interface PropertySearchResult {
  /** Raw property objects as returned by BatchData. */
  properties: any[];
  /** Number of properties in this page. */
  resultCount: number;
  /** Total matches across all pages (from meta.resultsFound). */
  resultsFound: number;
}

/**
 * Search BatchData's property database with distress/investor filters.
 * Each returned property record is billable on the user's BatchData
 * account; use take: 0 first for a count-only check (1-record minimum).
 */
export async function searchProperties(
  creds: BatchDataCreds,
  searchCriteria: PropertySearchCriteria,
  options?: PropertySearchOptions
): Promise<PropertySearchResult> {
  const data = await batchDataFetch("/api/v1/property/search", creds, {
    method: "POST",
    body: JSON.stringify({
      searchCriteria,
      options: {
        take: 25,
        ...(options ?? {}),
      },
    }),
  });
  const properties: any[] = data?.results?.properties ?? [];
  return {
    properties,
    resultCount:
      typeof data?.meta?.resultCount === "number"
        ? data.meta.resultCount
        : properties.length,
    resultsFound:
      typeof data?.meta?.resultsFound === "number"
        ? data.meta.resultsFound
        : properties.length,
  };
}

/** UI-friendly property shape for the Find Deals screen. */
export interface SimplifiedProperty {
  street: string;
  city: string;
  state: string;
  zip: string;
  ownerName: string;
  estimatedValue: number | null;
  equityPercent: number | null;
  listingStatus: string | null;
  /** Human-readable distress labels derived from quickLists flags. */
  distressFlags: string[];
  apn: string | null;
}

const QUICKLIST_LABELS: Record<string, string> = {
  "absentee-owner": "Absentee Owner",
  "in-state-absentee-owner": "In-State Absentee",
  "out-of-state-absentee-owner": "Out-of-State Owner",
  vacant: "Vacant",
  "vacant-lot": "Vacant Lot",
  "mailing-address-vacant": "Vacant Mailing Address",
  preforeclosure: "Pre-Foreclosure",
  "tax-default": "Tax Delinquent",
  "notice-of-default": "Notice of Default",
  "notice-of-sale": "Notice of Sale",
  "notice-of-lis-pendens": "Lis Pendens",
  "active-auction": "Active Auction",
  "corporate-owned": "Corporate Owned",
  inherited: "Inherited",
  "tired-landlord": "Tired Landlord",
  "high-equity": "High Equity",
  "free-and-clear": "Free & Clear",
  "low-equity": "Low Equity",
  "on-market": "On Market",
  "active-listing": "Active Listing",
  "expired-listing": "Expired Listing",
  "failed-listing": "Failed Listing",
  "canceled-listing": "Canceled Listing",
  "pending-listing": "Pending",
  "for-sale-by-owner": "FSBO",
  "owner-occupied": "Owner Occupied",
  "cash-buyer": "Cash Buyer",
  "senior-owner": "Senior Owner",
  "trust-owned": "Trust Owned",
  "has-hoa": "Has HOA",
  "recently-sold": "Recently Sold",
};

/**
 * Reduce a raw BatchData property object to the fields the Find Deals
 * UI needs. Defensive: the API has shipped field-name variants, so this
 * checks several known shapes.
 */
export function simplifyProperty(raw: any): SimplifiedProperty {
  const address = raw?.address ?? {};
  const owner = raw?.owner ?? {};
  const valuation = raw?.valuation ?? {};
  const listing = raw?.listing ?? {};
  const quickLists = raw?.quickLists ?? {};

  const distressFlags: string[] = [];
  for (const [key, label] of Object.entries(QUICKLIST_LABELS)) {
    if (quickLists[key] === true) distressFlags.push(label);
  }

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    street: String(address.street ?? address.streetAddress ?? ""),
    city: String(address.city ?? ""),
    state: String(address.state ?? ""),
    zip: String(address.zip ?? address.zipCode ?? address.postalCode ?? ""),
    ownerName: String(
      owner.fullName ?? owner.name ?? owner.ownerName ?? ""
    ),
    estimatedValue: num(
      valuation.estimatedValue ?? valuation.avm ?? valuation.marketValue
    ),
    equityPercent: num(valuation.equityPercent ?? valuation.equity),
    listingStatus: listing.status
      ? String(listing.status)
      : listing.statusCategory
        ? String(listing.statusCategory)
        : null,
    distressFlags,
    apn: raw?.apn ?? address.apn ?? null,
  };
}
