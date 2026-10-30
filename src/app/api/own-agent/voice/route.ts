import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  stepPrompt,
  voicemailMessage,
  appendAnswer,
  parseAnswers,
  deriveDisposition,
  buildSummary,
  isDncAnswer,
  twimlEscape,
  nextStep,
  type AgentStep,
  type LeadContext,
} from "@/lib/own-agent";
import { isValidTwilioSignature } from "@/lib/own-dialer";

export const runtime = "nodejs";

/**
 * POST /api/own-agent/voice — our own voice agent, driven by Twilio
 * TwiML <Gather input="speech"> + <Say> only. No ElevenLabs, Bland,
 * Vapi, or any other AI voice platform is involved.
 *
 * Twilio calls this URL when the outbound call answers (see
 * createOwnDialerCall). Query: ?callLogId=<uuid>&step=<agent step>.
 * Each <Gather> posts the seller's spoken answer back here as
 * SpeechResult, one question at a time.
 *
 * Reliability rules, learned from the ElevenLabs failures:
 * - Every spoken answer is appended to call_logs.transcript immediately,
 *   so a mid-call hangup still leaves a partial record.
 * - Dispositions come only from actual answers (own-agent.ts).
 * - This route never sets a fake "completed" outcome: the Twilio
 *   statusCallback (/api/own-agent/status) owns call status/duration,
 *   and this route owns transcript/outcome/summary.
 */

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
}

function twiml(body: string): NextResponse {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { headers: { "Content-Type": "text/xml" } }
  );
}

function say(text: string): string {
  // Natural Neural voice (female, to match Alex), Twilio-only — no
  // ElevenLabs/Bland/Vapi. Every prompt, voicemail, and wrap-up goes
  // through this helper, so the whole agent uses the same voice.
  return `<Say voice="Polly.Joanna-Neural" language="en-US">${twimlEscape(text)}</Say>`;
}

function gather(
  callLogId: string,
  step: AgentStep,
  prompt: string
): string {
  const action = `/api/own-agent/voice?callLogId=${encodeURIComponent(callLogId)}&step=${step}`;
  return (
    `<Gather input="speech" speechTimeout="auto" timeout="8" ` +
    `action="${twimlEscape(action)}" method="POST" actionOnEmptyResult="true">` +
    `${say(prompt)}</Gather>` +
    // If Gather itself times out with no result, Twilio still posts to
    // the action URL (actionOnEmptyResult), so the flow advances instead
    // of hanging up silently.
    say("Thanks, moving on.")
  );
}

function hangupWith(text: string): string {
  return `${say(text)}<Hangup/>`;
}

function isAgentStep(v: string | null): v is AgentStep {
  return (
    v === "greeting" ||
    v === "motivation" ||
    v === "timeline" ||
    v === "price" ||
    v === "condition" ||
    v === "wrapup"
  );
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const callLogId = url.searchParams.get("callLogId") || "";
  const stepParam = url.searchParams.get("step");
  const step: AgentStep = isAgentStep(stepParam) ? stepParam : "greeting";

  const form = await req.formData().catch(() => new FormData());
  const fields: Record<string, string> = {};
  form.forEach((v, k) => {
    fields[k] = String(v);
  });
  const speechResult = (fields.SpeechResult || "").trim();
  const answeredBy = (fields.AnsweredBy || "").toLowerCase();

  const supabase = serviceClient();
  const { data: log } = await supabase
    .from("call_logs")
    .select("id, lead_id, user_id, transcript, outcome")
    .eq("id", callLogId)
    .single();
  if (!log) {
    return twiml(
      hangupWith("Sorry, we're having a technical problem. Goodbye.")
    );
  }

  // Optional Twilio signature enforcement (see own-dialer.ts). Off by
  // default so proxy URL rewriting can't break legitimate callbacks.
  if (process.env.OWN_DIALER_ENFORCE_SIGNATURE === "true") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("twilio_auth_token")
      .eq("id", (log as any).user_id)
      .single();
    const token = (profile as any)?.twilio_auth_token as string | undefined;
    const signature = req.headers.get("x-twilio-signature") || "";
    if (
      token &&
      signature &&
      !isValidTwilioSignature(token, req.url, fields, signature)
    ) {
      return new NextResponse("Invalid Twilio signature", { status: 403 });
    }
  }

  let ctx: LeadContext = { ownerName: "", address: "", city: "" };
  if ((log as any).lead_id) {
    const { data: lead } = await supabase
      .from("leads")
      .select("owner_name, address, city")
      .eq("id", (log as any).lead_id)
      .single();
    if (lead) {
      ctx = {
        ownerName: (lead as any).owner_name || "",
        address: (lead as any).address || "",
        city: (lead as any).city || "",
      };
    }
  }

  // --- Voicemail: machine detection fired on the first request. -------
  if (step === "greeting" && answeredBy.startsWith("machine")) {
    await supabase
      .from("call_logs")
      .update({
        outcome: "voicemail",
        summary:
          "Voicemail: left a callback message with Darren's number (see transcript note).",
        transcript: ((log as any).transcript || "") + "\n[Voicemail message left]",
      })
      .eq("id", callLogId);
    return twiml(hangupWith(voicemailMessage(ctx)));
  }

  // --- Greeting: introduce, then ask the first question. --------------
  if (step === "greeting") {
    return twiml(
      `${say(stepPrompt("greeting", ctx))}${gather(callLogId, "motivation", stepPrompt("motivation", ctx))}`
    );
  }

  // --- Wrap-up reached directly (defensive): finalize from answers. ---
  if (step === "wrapup") {
    const answers = parseAnswers((log as any).transcript as string | null);
    const disposition = deriveDisposition(answers);
    await supabase
      .from("call_logs")
      .update({
        outcome: disposition,
        summary: buildSummary(answers),
      })
      .eq("id", callLogId);
    return twiml(
      hangupWith(
        disposition === "not_interested"
          ? "No problem, thanks for your time. Goodbye."
          : "Thanks, that's helpful. Darren may follow up with you about next steps. Goodbye."
      )
    );
  }

  // --- One qualification question step. --------------------------------
  let transcript = (log as any).transcript as string | null;
  if (speechResult) {
    // Removal requests end the call immediately and politely.
    if (isDncAnswer(speechResult)) {
      transcript = appendAnswer(transcript, step, speechResult);
      await supabase
        .from("call_logs")
        .update({
          transcript,
          outcome: "dnc",
          summary:
            "Seller asked to be removed from the call list. Do not call again — honor this in the CRM.",
        })
        .eq("id", callLogId);
      return twiml(
        hangupWith(
          "Understood, I'll make sure you're removed from our call list. Goodbye."
        )
      );
    }
    transcript = appendAnswer(transcript, step, speechResult);

    // An explicit "not selling" at the motivation step: don't pester the
    // seller with the remaining questions.
    if (
      step === "motivation" &&
      /not interested|not selling|don'?t want to sell|not for sale/i.test(speechResult)
    ) {
      await supabase
        .from("call_logs")
        .update({
          transcript,
          outcome: "not_interested",
          summary: buildSummary(parseAnswers(transcript)),
        })
        .eq("id", callLogId);
      return twiml(hangupWith("No problem, thanks for your time. Goodbye."));
    }
  }
  // Empty SpeechResult (silence / timeout): the question is simply
  // skipped — never guessed. The summary will show only real answers.

  const next = nextStep(step);
  if (next === "wrapup" || next === null) {
    const answers = parseAnswers(transcript);
    const disposition = deriveDisposition(answers);
    await supabase
      .from("call_logs")
      .update({
        transcript,
        outcome: disposition,
        summary: buildSummary(answers),
      })
      .eq("id", callLogId);
    return twiml(
      hangupWith(
        disposition === "not_interested"
          ? "No problem, thanks for your time. Goodbye."
          : "Thanks, that's helpful. Darren may follow up with you about next steps. Goodbye."
      )
    );
  }

  // Persist the answer before asking the next question, so a hangup
  // mid-conversation still leaves a partial transcript.
  await supabase
    .from("call_logs")
    .update({ transcript })
    .eq("id", callLogId);
  return twiml(gather(callLogId, next, stepPrompt(next, ctx)));
}
