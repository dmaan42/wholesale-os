import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { digitsOnly } from "@/lib/elevenlabs";
import { applyElevenLabsCallUpdate } from "@/lib/elevenlabs-sync";

export const runtime = "nodejs";

// ElevenLabs Conversational AI post-call webhook.
// Configure this URL on your ElevenLabs agent (dashboard → agent →
// webhooks), format:
//   https://<your-app>/api/elevenlabs-webhook?secret=<VOICE_WEBHOOK_SECRET>
//
// ElevenLabs fires a `post_call_transcription` event when the call ends,
// carrying the transcript, analysis, and recording metadata.
//
// On each webhook this updates the call log (status, duration, recording,
// summary, outcome) and moves the lead's pipeline stage forward on positive
// signals only — it never auto-kills a lead.
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//               VOICE_WEBHOOK_SECRET (optional but recommended)
export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.VOICE_WEBHOOK_SECRET;
  if (secret && url.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ received: true });
  }

  // ElevenLabs wraps the payload: { type: "post_call_transcription", data: {...} }
  const type = body?.type;
  const data = body?.data ?? body;

  // Only process post-call events.
  if (type && type !== "post_call_transcription" && type !== "call_ended") {
    return NextResponse.json({ received: true });
  }

  const conversationId =
    data?.conversation_id ?? data?.conversationId ?? null;
  if (!conversationId) {
    return NextResponse.json({ received: true });
  }

  const meta = data?.metadata ?? data?.conversation_initiation_client_data ?? {};
  let callLogId: string | undefined = meta.wholesaleOsCallLogId;
  let leadId: string | undefined = meta.wholesaleOsLeadId;
  let userId: string | undefined = meta.wholesaleOsUserId;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );

  // Fallback: match by external_id or provider_call_id.
  if (!callLogId) {
    const { data: byProvider } = await supabase
      .from("call_logs")
      .select("id, lead_id, user_id")
      .eq("provider_call_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (byProvider) {
      callLogId = (byProvider as any).id;
      leadId = (byProvider as any).lead_id ?? leadId;
      userId = (byProvider as any).user_id ?? userId;
    }
  }

  if (!callLogId) return NextResponse.json({ received: true });

  // Shared updater (also used by the campaign pump's reconcile pass).
  await applyElevenLabsCallUpdate(supabase, callLogId, data);

  return NextResponse.json({ received: true });
}
