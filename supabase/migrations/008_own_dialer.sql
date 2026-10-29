-- 008_own_dialer.sql — per-user Twilio credentials for the "own dialer"
-- (Twilio REST + our own TwiML voice agent, no ElevenLabs/Bland/Vapi).
-- Safe to re-run: uses IF NOT EXISTS.
--
-- SECURITY: these columns hold secrets. Values are set by the user in
-- Settings (or by the deployer in Vercel env vars TWILIO_ACCOUNT_SID /
-- TWILIO_AUTH_TOKEN / TWILIO_CALLER_NUMBER as a fallback). NEVER put a
-- real SID, token, or phone number in code, in a migration, or in git.
-- Existing RLS on profiles already restricts these to the owning user
-- (users read/update own profile only).

alter table profiles add column if not exists twilio_account_sid text;
alter table profiles add column if not exists twilio_auth_token text;
alter table profiles add column if not exists twilio_caller_number text;

-- campaigns.provider already exists (added in 004, defaulted in 006).
-- Own-dialer campaigns simply store provider = 'own-dialer'; no schema
-- change is needed there. call_logs already has transcript, outcome,
-- summary, recording_url, and provider_call_id, which the own-agent
-- callbacks write to — no call_logs change is needed either.
