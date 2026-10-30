import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveElevenLabsCreds } from "@/lib/elevenlabs";
import { resolveOwnDialerCreds } from "@/lib/own-dialer";

export const runtime = "nodejs";

// GET /api/call-logs/recording?providerCallId=<provider call id>
// Streams the conversation audio for a call log the caller owns.
// The frontend fetches this with the user's Supabase JWT and plays it
// from a blob URL (an <audio> tag alone can't send the Authorization
// header, and a raw provider URL can't be played directly either).
//
// Provider branch — this is what fixed own-dialer playback (2026-10-29
// test call showed 0:00 / blank tab):
// - ElevenLabs: conversation audio via the user's ElevenLabs key (the
//   original path; ElevenLabs only issues short-lived signed URLs).
// - Own dialer: the stored recording_url is a Twilio api.twilio.com URL
//   that requires Basic Auth with the user's Twilio credentials, so a
//   browser <audio> tag or plain link to it always 401s. Proxy it here
//   with those credentials instead. Twilio recording media without a
//   format suffix can come back as resource JSON rather than audio, so
//   if the first fetch isn't audio, retry with a .mp3 suffix.
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
      .select("id, provider, recording_url")
      .eq("provider_call_id", providerCallId)
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (!log) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    // Own dialer: stream the stored Twilio recording with the user's
    // own Twilio credentials (the stored URL itself is not playable
    // from a browser — it needs Basic Auth).
    if ((log as any).provider === "own-dialer") {
      const recordingUrl = (log as any).recording_url as string | null;
      if (!recordingUrl) {
        return NextResponse.json(
          { error: "Recording unavailable from provider" },
          { status: 502 }
        );
      }
      const twilio = await resolveOwnDialerCreds(admin, user.id);
      const auth = `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64")}`;
      let audioRes = await fetch(recordingUrl, {
        headers: { Authorization: auth },
      });
      if (
        audioRes.ok &&
        (audioRes.headers.get("content-type") || "").includes("json")
      ) {
        // Twilio returned the recording resource, not media — retry as mp3.
        const mp3Url = recordingUrl.endsWith(".mp3")
          ? recordingUrl
          : `${recordingUrl}.mp3`;
        audioRes = await fetch(mp3Url, {
          headers: { Authorization: auth },
        });
      }
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
