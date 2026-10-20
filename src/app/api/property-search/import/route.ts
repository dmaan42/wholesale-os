import { NextResponse } from "next/server";
import { requireApiUser, requireActiveSubscription } from "@/lib/api-auth";

export const runtime = "nodejs";

// POST /api/property-search/import
// Save selected Find Deals properties as leads in the caller's pipeline.
// Body: { properties: [{ street, city, state, zip, ownerName, estimatedValue, equityPercent, listingStatus, distressFlags }] }
// Returns: { ok: true, leadIds: string[], created: number }
export async function POST(req: Request) {
  try {
    const { user, supabase } = await requireApiUser(req);

    try {
      await requireActiveSubscription(supabase, user.id);
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status || 402 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const properties: any[] = Array.isArray(body.properties)
      ? body.properties
      : [];
    if (properties.length === 0) {
      return NextResponse.json(
        { error: "Select at least one property to save." },
        { status: 400 }
      );
    }
    if (properties.length > 100) {
      return NextResponse.json(
        { error: "Save at most 100 properties at a time." },
        { status: 400 }
      );
    }

    const rows = properties
      .filter((p) => p && String(p.street || "").trim())
      .map((p) => ({
        user_id: user.id,
        address: String(p.street || "").trim(),
        city: String(p.city || "").trim(),
        state: String(p.state || "").trim(),
        zip: String(p.zip || "").trim(),
        owner_name: String(p.ownerName || "").trim(),
        status: "new",
        source: "Find Deals (BatchData)",
        notes: Array.isArray(p.distressFlags) && p.distressFlags.length > 0
          ? `Distress: ${p.distressFlags.join(", ")}`
          : "",
      }));

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid properties to save." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("leads")
      .insert(rows)
      .select("id");
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      created: data?.length ?? 0,
      leadIds: (data ?? []).map((r: any) => r.id as string),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Import failed" },
      { status: err.status || 500 }
    );
  }
}
