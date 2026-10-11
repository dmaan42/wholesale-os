-- 004_per_user_bland.sql — each customer connects their own Bland AI account.
-- Adds per-user Bland credentials to profiles. Existing RLS policies
-- ("users read own profile" / "users update own profile") already cover
-- the new columns: a user can only ever read/write their own keys.
-- Replaces the Vapi integration (003). Vapi columns are kept for now
-- for backwards compatibility but are no longer read by the app.
-- Safe to re-run.

alter table profiles add column if not exists bland_api_key text;
alter table profiles add column if not exists bland_from_number text;

-- Campaigns now track the provider (was Vapi-only).
alter table campaigns add column if not exists provider text default 'bland';

-- Call logs: add transcript column for Bland's full transcript.
alter table call_logs add column if not exists transcript text;
