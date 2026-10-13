-- 006_per_user_elevenlabs.sql — each customer connects their own ElevenLabs account.
-- Adds per-user ElevenLabs credentials to profiles. Existing RLS policies
-- ("users read own profile" / "users update own profile") already cover
-- the new columns: a user can only ever read/write their own keys.
-- Replaces the Bland integration. Bland columns are kept for now
-- for backwards compatibility but are no longer read by the app.
-- Safe to re-run.

alter table profiles add column if not exists elevenlabs_api_key text;
alter table profiles add column if not exists elevenlabs_agent_id text;
alter table profiles add column if not exists elevenlabs_phone_number_id text;

-- Campaigns now track the provider (was Bland).
alter table campaigns add column if not exists provider text default 'elevenlabs';
update campaigns set provider = 'elevenlabs' where provider = 'bland' or provider is null;
