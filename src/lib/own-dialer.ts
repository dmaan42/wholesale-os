/**
 * Server-only "own dialer" helpers — Twilio REST, no ElevenLabs, Bland,
 * Vapi, or any other AI voice platform.
 *
 * Why this exists: on 2026-10-29 an ElevenLabs call failed with a
 * quota error (0 seconds, no transcript) and wholesaleOS could only show
 * "failed / unknown". Twilio itself dialed fine. This provider dials
 * directly through Twilio, so the call, its status callbacks, its
 * recording, and its spoken answers all live in our own tables — and a
 * failure always carries a verbatim Twilio reason instead of "unknown".
 *
 * Credentials are per-user, exactly like the ElevenLabs path: a user
 * connects their own Twilio account in Settings (profiles columns added
 * by migration 008), and calls are billed to THEIR Twilio account, never
 * to the app owner's. Server env vars are a fallback for a single-owner
 * deployment. NEVER hardcode a SID, token, or phone number here.
 *
 * The callback number spoken in voicemails is Darren's own number. It is
 * configurable via OWN_DIALER_CALLBACK_NUMBER; the default below is the
 * number already on file for him. It is a callback number, not a secret.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface TwilioCreds {
  accountSid: string;
  authToken: string;
  /** E.164 caller ID shown to the seller. */
  callerNumber: string;
}

/** Number the agent leaves in voicemails. Never an invented number. */
export const CALLBACK_NUMBER =
  process.env.OWN_DIALER_CALLBACK_NUMBER || "+18054757616";

/**
 * Normalize a phone number to E.164 (US-centric, matching the existing
 * dialer). Returns null when the number is not dialable — callers must
 * fail the call with that reason, never dial a malformed number.
 */
export function toE164Own(phone: string): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * Load the calling user's Twilio credentials from their profile, falling
 * back to server env vars. Throws a clear, user-actionable error when
 * neither is configured.
 */
export async function resolveOwnDialerCreds(
  supabase: SupabaseClient,
  userId: string
): Promise<TwilioCreds> {
  const { data } = await supabase
    .from("profiles")
    .select("twilio_account_sid, twilio_auth_token, twilio_caller_number")
    .eq("id", userId)
    .single();

  const accountSid =
    (data?.twilio_account_sid as string | undefined) ||
    process.env.TWILIO_ACCOUNT_SID ||
    "";
  const authToken =
    (data?.twilio_auth_token as string | undefined) ||
    process.env.TWILIO_AUTH_TOKEN ||
    "";
  const callerNumber =
    (data?.twilio_caller_number as string | undefined) ||
    process.env.TWILIO_CALLER_NUMBER ||
    "";

  if (!accountSid || !authToken || !callerNumber) {
    throw new Error(
      "Own dialer isn't connected — add your Twilio Account SID, Auth Token, " +
        "and caller number in Settings (or set TWILIO_ACCOUNT_SID, " +
        "TWILIO_AUTH_TOKEN, and TWILIO_CALLER_NUMBER on the server) first."
    );
  }
  return { accountSid, authToken, callerNumber };
}

/** Public base URL of this app, used to build Twilio webhook URLs. */
export function appOrigin(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = (process.env.VERCEL_URL || "").trim();
  if (vercel) return `https://${vercel}`;
  throw new Error(
    "Cannot build own-dialer webhook URLs: set NEXT_PUBLIC_APP_URL."
  );
}

export interface TwilioCallResult {
  callSid: string;
}

/** Twilio API error, kept verbatim — never collapsed into "unknown". */
export class TwilioApiError extends Error {
  code?: number | string;
  httpStatus?: number;
  constructor(message: string, code?: number | string, httpStatus?: number) {
    super(message);
    this.name = "TwilioApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
  /** One-line verbatim reason for call_logs.summary, e.g. "[21211] ...". */
  get verbatim(): string {
    return this.code !== undefined
      ? `Twilio error [${this.code}]: ${this.message}`
      : `Twilio error: ${this.message}`;
  }
}

export interface OwnDialerCallOptions {
  /** E.164 number to call. */
  to: string;
  /** Call log row id — carried in webhook query params. */
  callLogId: string;
  /**
   * Lead fields known at dial time (from the leads row the caller just
   * loaded). Carried in the voice webhook query as a fallback, because
   * the 2026-10-30 Eden/test calls proved the voice route's DB lookup
   * can come up blank for a row the UI shows as populated — and a
   * silent blank context used to be spoken as a fake value, then as a
   * generic greeting. The voice route prefers the DB row; it only uses
   * these params when the DB row is missing or blank. Never a secret.
   */
  leadName?: string;
  leadAddress?: string;
  leadCity?: string;
}

/**
 * Create an outbound Twilio call whose conversation is driven by our own
 * TwiML agent at /api/own-agent/voice (no third-party voice platform).
 * Recording is on; status + recording callbacks land on our own routes.
 * On a Twilio rejection this throws TwilioApiError with the verbatim
 * Twilio code/message — callers must store that on the call log.
 */
export async function createOwnDialerCall(
  creds: TwilioCreds,
  opts: OwnDialerCallOptions
): Promise<TwilioCallResult> {
  const origin = appOrigin();
  const voiceParams = new URLSearchParams({
    callLogId: opts.callLogId,
    step: "greeting",
  });
  if (opts.leadName) voiceParams.set("leadName", opts.leadName);
  if (opts.leadAddress) voiceParams.set("leadAddress", opts.leadAddress);
  if (opts.leadCity) voiceParams.set("leadCity", opts.leadCity);
  const voiceUrl = `${origin}/api/own-agent/voice?${voiceParams.toString()}`;
  const statusUrl = `${origin}/api/own-agent/status`;
  const recordingUrl = `${origin}/api/own-agent/recording`;

  const params = new URLSearchParams({
    To: opts.to,
    From: creds.callerNumber,
    Url: voiceUrl,
    Method: "POST",
    StatusCallback: statusUrl,
    StatusCallbackMethod: "POST",
    // Report every leg state so a failure is never silent.
    StatusCallbackEvent: "initiated",
    MachineDetection: "Enable",
    MachineDetectionTimeout: "30",
    AsyncAmd: "true",
    AsyncAmdStatusCallback: statusUrl,
    AsyncAmdStatusCallbackMethod: "POST",
    Record: "true",
    RecordingStatusCallback: recordingUrl,
    RecordingStatusCallbackMethod: "POST",
  });
  // Twilio accepts repeated StatusCallbackEvent values; the single value
  // above keeps the form simple — the status route also handles the
  // AsyncAmd callback, which reports answered/machine states.
  params.append("StatusCallbackEvent", "ringing");
  params.append("StatusCallbackEvent", "answered");
  params.append("StatusCallbackEvent", "completed");

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TwilioApiError(
      String(
        (data as { message?: string })?.message ||
          `Twilio API error ${res.status}`
      ),
      (data as { code?: number })?.code,
      res.status
    );
  }
  const callSid = String((data as { sid?: string })?.sid || "");
  if (!callSid) {
    throw new TwilioApiError("Twilio did not return a call SID", undefined, res.status);
  }
  return { callSid };
}

/**
 * Validate an X-Twilio-Signature header (Twilio's HMAC-SHA1 scheme).
 * Callers should enforce this only when OWN_DIALER_ENFORCE_SIGNATURE=true,
 * because the public URL Twilio called must match req.url exactly and
 * proxy rewriting can otherwise break legitimate callbacks. When the
 * flag is on, a bad signature is a hard reject.
 */
export function isValidTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  try {
    const data = Object.keys(params)
      .sort()
      .reduce((acc, k) => acc + k + params[k], url);
    const expected = createHmac("sha1", authToken).update(data).digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Constant-time-ish helper kept for tests/consumers; not a secret. */
export function sha1Hex(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}
