# Own dialer + own voice agent (no ElevenLabs)

Built 2026-10-29 on branch `feat/own-dialer`, after an ElevenLabs call
failed with a quota error (0 seconds, no transcript) and wholesaleOS
could only show "failed / unknown". Twilio itself dialed fine — so this
dialer dials through Twilio directly and runs the conversation with our
own TwiML state machine. No ElevenLabs, Bland, Vapi, or other AI voice
platform is in the loop. The ElevenLabs path is untouched and still
works for campaigns created with `provider: "elevenlabs"`.

## How a call flows, step by step

1. **Single call:** `POST /api/own-dial` with `{ leadId, phone }`
   (same auth + subscription checks as `/api/dial`). The call is logged
   first (`call_logs`, `provider: "own-dialer"`, status `initiated`), then
   Twilio is asked to dial. On a Twilio rejection the log becomes
   `failed` with the **verbatim Twilio error code + message** (e.g.
   `[21211] ...`), and that reason is returned — never "unknown".
   On success the log stores the Twilio Call SID and status `ringing`.
2. **Campaign call:** create a campaign with
   `POST /api/campaigns` and `"provider": "own-dialer"`. The campaign
   pump (`/api/campaigns/pump-all`, or the campaign page's pump tick)
   branches to `pumpOwnDialerCampaign` before any ElevenLabs lookup:
   atomic claim of a queued contact, log-first, Twilio dial, contact
   marked `dialing`, attempts counted (max 3, daily cap 90, same as
   ElevenLabs). A busy / failed / no-answer result is a terminal
   attempt — it is **not** silently re-queued; use the campaign page's
   "retry failed" action to redial explicitly.
3. **Answer:** Twilio calls `POST /api/own-agent/voice?callLogId=…&step=greeting`.
   Machine detection (`AsyncAmd`) routes a voicemail to the voicemail
   message; a human hears the greeting, then one question at a time:
   motivation → timeline → asking price → condition → wrap-up.
   Each spoken answer is appended to `call_logs.transcript` immediately,
   so a mid-call hangup still leaves a partial record.
4. **Agent rules (same job Alex did):**
   - Introduces as an automated call **on behalf of Darren**, a real
     estate investor. It never claims to be Darren.
   - Never quotes a specific offer price — it only asks what price the
     seller is hoping for.
   - A removal request ("do not call", "remove me", …) ends the call
     politely with disposition `dnc`. Do not call that lead again —
     honor it in the CRM; the code does not auto-delete leads.
   - Voicemail leaves Darren's real callback number
     (see `CALLBACK_NUMBER` in `src/lib/own-dialer.ts`, overridable via
     `OWN_DIALER_CALLBACK_NUMBER`). Never an invented number.
5. **Dispositions — only from real answers:** `interested` requires
   explicit interest language ("I'm interested", "I want to sell", …).
   A price quote alone is **not** "interested". Engaged but not ready
   (callback / "think about it") is `follow_up`. Explicit rejection is
   `not_interested`. A call that ends with no qualifying answer gets
   **no disposition** — its summary says so plainly — instead of a
   guessed "hot" tag. (AI outcome tags were previously verified wrong
   against real summaries; that must not happen again.)
6. **Status / recording:** Twilio's statusCallback hits
   `POST /api/own-agent/status`, which writes queued → ringing →
   in-progress → completed / busy / failed / no-answer with duration,
   and moves the campaign contact row to match. It never overwrites a
   disposition the voice agent already recorded. The recording callback
   (`POST /api/own-agent/recording`) stores `recording_url`, so the
   campaign page's player has a real recording instead of
   "Recording unavailable".
7. **Stale calls:** a contact still in-flight after 30 minutes with no
   terminal Twilio status is marked failed with that reason, so a dead
   call can't wedge a campaign (the same guard the ElevenLabs pump has).

## What Darren must supply before this goes live

1. **Run migration `008_own_dialer.sql`** in the Supabase SQL editor
   (after merging; the repo also has unmerged migrations 008–011 from
   earlier feature branches — check numbering if those land first).
2. **Twilio credentials, per user** — either in Settings (profiles
   columns `twilio_account_sid`, `twilio_auth_token`,
   `twilio_caller_number`) or as server env vars `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `TWILIO_CALLER_NUMBER`. The caller number is
   the Twilio number shown to sellers (Darren's is the number already
   on his account). Never commit these values.
3. **App URL:** set `NEXT_PUBLIC_APP_URL` to the production origin
   (e.g. `https://www.realestatesolutionz.com`), so Twilio webhook
   URLs are built correctly. Twilio itself needs no per-number webhook
   configuration for this design — the dial request carries the voice,
   status, and recording callback URLs per call.
4. **Merge + deploy** this branch (PR, as usual — no push was made
   from this build), then test (below) before pointing a real
   campaign at it.
5. **Optional hardening:** set `OWN_DIALER_ENFORCE_SIGNATURE=true`
   once the production URL is stable, to reject Twilio callbacks with
   a bad `X-Twilio-Signature`. It is off by default because proxy URL
   rewriting can otherwise break legitimate callbacks.

## How to test without calling a real seller

- **Do not test-call any seller lead.** The only live test call that
  is safe is to Darren's own number, and only with his explicit
  go-ahead at the time ("call me now to test").
- Safe dry runs without any dial: run `npm run build` (typecheck +
  build), and exercise the voice route logic by inspecting the TwiML
  it returns for a test `callLogId` in a staging deployment — no
  Twilio call is placed unless `POST /api/own-dial` or the pump runs
  with a queued contact.
- First live test (with Darren's go-ahead): `POST /api/own-dial` for a
  lead whose phone is Darren's own number, then verify in the app:
  the call log shows a Twilio Call SID, a status progression, a
  duration, a recording URL, and a transcript/disposition from the
  answers given — and that a voicemail path leaves the correct
  callback number.

## Files

- `src/lib/own-dialer.ts` — Twilio REST helper, credential resolution,
  E.164, verbatim Twilio errors, signature validation.
- `src/lib/own-agent.ts` — agent script, disposition rules, transcript
  helpers, TwiML escaping.
- `src/lib/own-dialer-pump.ts` — campaign pump branch for own-dialer.
- `src/app/api/own-dial/route.ts` — single-call endpoint.
- `src/app/api/own-agent/voice/route.ts` — TwiML conversation.
- `src/app/api/own-agent/status/route.ts` — statusCallback.
- `src/app/api/own-agent/recording/route.ts` — recording callback.
- `src/lib/campaign-pump.ts` — branches to own-dialer when
  `campaign.provider === "own-dialer"`; ElevenLabs path unchanged.
- `src/app/api/campaigns/route.ts` — accepts `provider: "own-dialer"`.
- `src/app/api/campaigns/pump-all/route.ts` — selects `provider`.
- `src/app/api/campaigns/[id]/route.ts` — reports the real provider
  instead of hardcoding "elevenlabs".
- `supabase/migrations/008_own_dialer.sql` — profiles Twilio columns.

## UI (added on feat/own-dialer-ui — no console or API POST needed)

- Settings → "Own Dialer (Twilio)" card: Account SID, Auth Token,
  and caller number, saved to the profiles columns from migration
  008 (same pattern as the ElevenLabs / BatchData cards).
- Lead detail (LeadModal): a second button, "Call with Own Dialer",
  posts to `/api/own-dial` with the lead's id and saved phone and
  shows the server's error verbatim. The original "Call with AI"
  button still posts to `/api/dial` (ElevenLabs), unchanged.
- New campaign modal: a "Dialer" selector (ElevenLabs (Alex) /
  Own Dialer) that posts `provider` to `/api/campaigns`. It defaults
  to ElevenLabs, so existing behaviour is unchanged unless
  Own Dialer is chosen.

## Not built yet (follow-ups, not blockers for a first test)
- The agent is a scripted one-question-at-a-time TwiML flow using
  Twilio's own speech recognition and voice — deliberately, for
  reliability. It is not a free-form LLM conversation; if Darren wants
  free-form replies later, that is a separate build on top of the
  transcript/state machine here, not a return to ElevenLabs.
