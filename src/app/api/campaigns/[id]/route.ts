import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import {
  getVapiCampaign,
  getVapiCampaignContacts,
  cancelVapiCampaign,
} from "@/lib/vapi";

export const runtime = "nodejs";

async function ownCampaign(req: Request, id: string) {
  const { user, supabase } = await requireApiUser(req);
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (error || !data) {
    const err = new Error("Campaign not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return { user, supabase, campaign: data };
}

// GET /api/campaigns/[id] — our record + live Vapi state (counters, contacts).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { campaign } = await ownCampaign(req, id);

    let live: any = null;
    let liveError: string | null = null;
    if (campaign.vapi_campaign_id) {
      try {
        const [state, contacts] = await Promise.all([
          getVapiCampaign(campaign.vapi_campaign_id),
          getVapiCampaignContacts(campaign.vapi_campaign_id, 100),
        ]);
        live = { ...state, contacts: contacts?.contacts ?? contacts ?? [] };
      } catch (e: any) {
        liveError = e.message || "Could not reach Vapi";
      }
    }

    return NextResponse.json({ campaign, live, liveError });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to load campaign" },
      { status: err.status || 500 }
    );
  }
}

// PATCH /api/campaigns/[id] — { action: "cancel" } stops a running campaign.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, campaign } = await ownCampaign(req, id);
    const body = await req.json().catch(() => ({}));

    if (body.action !== "cancel") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    if (campaign.vapi_campaign_id) {
      await cancelVapiCampaign(campaign.vapi_campaign_id);
    }
    await supabase
      .from("campaigns")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Cancel failed" },
      { status: err.status || 500 }
    );
  }
}
