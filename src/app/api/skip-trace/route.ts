import { NextResponse } from "next/server";
import { requireApiUser, requireActiveSubscription } from "@/lib/api-auth";
import {
  resolveBatchDataCreds,
  skipTraceProperty,
  firstCallablePhone,
  SKIP_TRACE_COST_CENTS_PER_MATCH,
  type SkipTraceResult,
} from "@/lib/batchdata";

export const runtime = "nodejs";

// GET /api/skip-trace
// Returns the current user's skip-trace usage for the current calendar month.
export async function GET(req: Request) {
  try {
    const { user, supabase } = await requireApiUser(req);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("skip_trace_usage")
      .select("cost_cents")
      .eq("user_id", user.id)
      .gte("created_at", monthStart.toISOString());
    if (error) throw new Error("Could not load usage");

    const traces = data?.length ?? 0;
    const costCents = (data ?? []).reduce(
      (sum, r) => sum + ((r.cost_cents as number) || 0),
      0
    );

    return NextResponse.json({ traces, costCents });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Usage lookup failed" },
      { status: e.status || 500 }
    );
  }
}

// POST /api/skip-trace  { leadId }
// Skip traces the lead's property address through the CALLER'S OWN
// BatchData account (connected in Settings → Data & Skip Tracing).
// Updates the lead with the owner name + best callable phone, logs usage
// for billing, and returns the full normalized result so the UI can let
// the user pick which number to keep.
export async function POST(req: Request) {
  try {
    const { user, supabase } = await requireApiUser(req);

    // Paywall: skip tracing is a chargeable action.
    try {
      await requireActiveSubscription(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status || 402 }
      );
    }

    const body = await req.json();
    const leadId = body.leadId as string;
    if (!leadId) {
      return NextResponse.json(
        { error: "leadId is required" },
        { status: 400 }
      );
    }

    // The caller's own BatchData credentials — billed to their account.
    let creds;
    try {
      creds = await resolveBatchDataCreds(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, address, city, state, zip, owner_name, phone")
      .eq("id", leadId)
      .single();
    if (leadErr || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (!lead.address || !lead.state) {
      return NextResponse.json(
        { error: "Lead needs at least a street address and state to skip trace." },
        { status: 400 }
      );
    }

    let result: SkipTraceResult;
    try {
      result = await skipTraceProperty(creds, {
        street: lead.address,
        city: lead.city || undefined,
        state: lead.state,
        zip: lead.zip || undefined,
      });
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message || "Skip trace failed" },
        { status: e.batchDataStatus === 401 ? 503 : 502 }
      );
    }

    // Persist the best outcome onto the lead: owner name + first callable
    // (non-DNC, non-litigator) phone. Never overwrite an existing phone
    // with a DNC/litigator number.
    const bestPhone = firstCallablePhone(result);
    const updates: Record<string, string | null> = {};
    if (result.ownerName && !lead.owner_name) {
      updates.owner_name = result.ownerName;
    }
    if (bestPhone && !lead.phone) {
      updates.phone = bestPhone;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from("leads").update(updates).eq("id", leadId);
    }

    // Log usage for billing: metered per matched person record.
    const costCents = result.matchedCount * SKIP_TRACE_COST_CENTS_PER_MATCH;
    await supabase.from("skip_trace_usage").insert({
      user_id: user.id,
      lead_id: leadId,
      cost_cents: costCents,
    });

    return NextResponse.json({
      ok: true,
      matchedCount: result.matchedCount,
      ownerName: result.ownerName,
      persons: result.persons,
      savedPhone: updates.phone ?? null,
      savedOwnerName: updates.owner_name ?? null,
      costCents,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Skip trace failed" },
      { status: err.status || 500 }
    );
  }
}
