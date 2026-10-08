-- 003_per_user_vapi.sql — each customer connects their own Vapi account.
-- Adds per-user Vapi credentials to profiles. Existing RLS policies
-- ("users read own profile" / "users update own profile") already cover
-- the new columns: a user can only ever read/write their own keys.
-- Safe to re-run.

alter table profiles add column if not exists vapi_api_key text;
alter table profiles add column if not exists vapi_assistant_id text;
alter table profiles add column if not exists vapi_phone_number_id text;
