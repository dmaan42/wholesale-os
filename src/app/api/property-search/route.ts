import { NextResponse } from "next/server";
import { requireApiUser, requireActiveSubscription } from "@/lib/api-auth";
import {
  resolveBatchDataCreds,
  searchProperties,
  simplifyProperty,
  type PropertySearchCriteria,
} from "@/lib/batchdata";

export const runtime = "nodejs";

// POST /api/property-search
// Search BatchData's property database with XLeads-style distress filters.
// Uses the CALLER'S OWN BatchData account (connected in Settings → Data &
// Skip Tracing); each returned property record is billable to their account.
//
// Body: {
//   zip: string (required), city?: string, state?: string,
//   distress?: string[]   (quickList values, AND-ed),
//   listingStatus?: "any" | "off-market" | "listed" | "expired-failed",
//   minValue?: number, maxValue?: number,
//   propertyType?: string, minBeds?: number,
//   maxResults?: number (default 50, max 100)
// }
//
// Cost guardrail: always runs a count-only query (take: 0) first so the UI
// can show the total before any records are billed. Empty results cost
// nothing; the count query bills the 1-record minimum.
const ALLOWED_DISTRESS = new Set([
  "absentee-owner",
  "in-state-absentee-owner",
  "out-of-state-absentee-owner",
  "vacant",
  "vacant-lot",
  "mailing-address-vacant",
  "preforeclosure",
  "tax-default",
  "notice-of-default",
  "notice-of-sale",
  "notice-of-lis-pendens",
  "active-auction",
  "corporate-owned",
  "inherited",
  "tired-landlord",
  "high-equity",
  "free-and-clear",
  "low-equity",
  "expired-listing",
  "failed-listing",
  "canceled-listing",
  "for-sale-by-owner",
]);

const ALLOWED_LISTING_STATUS = new Set([
  "any",
  "off-market",
  "listed",
  "expired-failed",
]);

// BatchData propertyTypeDetail values offered in the UI.
const ALLOWED_PROPERTY_TYPES = new Set([
  "Single Family Residential",
  "Multi-Family",
  "Condo",
  "Vacant Land",
]);

export async function POST(req: Request) {
  try {
    const { user, supabase } = await requireApiUser(req);

    // Paywall: property searches cost the user money per record.
    try {
      await requireActiveSubscription(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status || 402 }
      );
    }

    // The caller's own BatchData credentials — billed to their account.
    let creds;
    try {
      creds = await resolveBatchDataCreds(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const zip = String(body.zip || "").trim();
    const city = String(body.city || "").trim();
    const state = String(body.state || "").trim().toUpperCase();
    if (!zip && !city) {
      return NextResponse.json(
        { error: "Enter a ZIP code or city to search." },
        { status: 400 }
      );
    }

    const distress: string[] = Array.isArray(body.distress)
      ? body.distress.filter(
          (d: unknown) => typeof d === "string" && ALLOWED_DISTRESS.has(d)
        )
      : [];
    const listingStatus = ALLOWED_LISTING_STATUS.has(body.listingStatus)
      ? body.listingStatus
      : "any";

    const criteria: PropertySearchCriteria = {};
    const address: NonNullable<PropertySearchCriteria["address"]> = {};
    if (zip) address.zip = { equals: zip };
    if (city) address.city = { equals: city };
    if (state) address.state = { equals: state };
    criteria.address = address;

    if (distress.length > 0) criteria.quickLists = distress;

    if (listingStatus === "off-market") {
      criteria.listing = { statusCategory: { equals: "Off Market" } };
    } else if (listingStatus === "listed") {
      criteria.listing = { status: { equals: "Active" } };
    } else if (listingStatus === "expired-failed") {
      criteria.listing = { statusCategory: { equals: "Failed" } };
    }

    const minValue = Number(body.minValue);
    const maxValue = Number(body.maxValue);
    if (Number.isFinite(minValue) || Number.isFinite(maxValue)) {
      criteria.valuation = {
        estimatedValue: {
          ...(Number.isFinite(minValue) ? { min: minValue } : {}),
          ...(Number.isFinite(maxValue) ? { max: maxValue } : {}),
        },
      };
    }

    if (
      typeof body.propertyType === "string" &&
      ALLOWED_PROPERTY_TYPES.has(body.propertyType)
    ) {
      criteria.general = {
        propertyTypeDetail: { equals: body.propertyType },
      };
    }

    const minBeds = Number(body.minBeds);
    if (Number.isFinite(minBeds) && minBeds > 0) {
      criteria.building = { bedroomCount: { min: Math.floor(minBeds) } };
    }

    // Cost guardrail: count-only query first (take: 0 → meta.resultsFound).
    let countResult;
    try {
      countResult = await searchProperties(creds, criteria, { take: 0 });
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message || "Property search failed" },
        { status: e.batchDataStatus === 401 ? 503 : 502 }
      );
    }

    if (countResult.resultsFound === 0) {
      return NextResponse.json({
        ok: true,
        count: 0,
        properties: [],
        billedRecords: 1, // count query bills the 1-record minimum
      });
    }

    const maxResults = Math.min(
      Math.max(Number(body.maxResults) || 50, 1),
      100
    );
    let pageResult;
    try {
      pageResult = await searchProperties(creds, criteria, {
        take: maxResults,
      });
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message || "Property search failed" },
        { status: e.batchDataStatus === 401 ? 503 : 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      count: pageResult.resultsFound,
      properties: pageResult.properties.map(simplifyProperty),
      billedRecords: 1 + pageResult.resultCount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Property search failed" },
      { status: err.status || 500 }
    );
  }
}
