import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveElevenLabsCreds } from "@/lib/elevenlabs";

export const runtime = "nodejs";

// GET /api/call-logs/recording?providerCallId=<elevenlabs conversation id>
// Streams the ElevenLabs conversation audio for a call log the caller owns.
// ElevenLabs only issues short-lived signed audio URLs, so we proxy the
// bytes server-side with the user's own API key. The frontend fetches this
// with the user's Supabase JWT and plays it from a blob URL (an <audio>
// tag alone can't send the Authorization header).
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const providerCallId = url.searchParams.get("providerCallId");
    if (!providerCallId) {
      return NextResponse.json(
        { error: "providerCallId is required" },
        { status: 400 }
      );
    }

    // Verify the caller via their Supabase JWT.
    const authHeader = req.headers.get("authorization") || "";
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    // The call log must belong to this user.
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string
    );
    const { data: log } = await admin
      .from("call_logs")
      .select("id")
      .eq("provider_call_id", providerCallId)
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (!log) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    const creds = await resolveElevenLabsCreds(admin, user.id);
    const audioRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(providerCallId)}/audio`,
      { headers: { "xi-api-key": creds.apiKey } }
    );
    if (!audioRes.ok) {
      return NextResponse.json(
        { error: "Recording unavailable from provider" },
        { status: 502 }
      );
    }

    const buf = await audioRes.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          audioRes.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Recording failed" },
      { status: 500 }
    );
  }
}
