-- 005_batchdata.sql — per-user BatchData credentials + skip-trace usage metering.
-- Each customer connects their own BatchData account in Settings; lookups
-- are billed to THEIR BatchData account, never the app owner's.
-- Existing RLS policies ("users read own profile" / "users update own profile")
-- already cover the new profiles column: a user can only read/write their own key.
-- Safe to re-run.

alter table profiles add column if not exists batchdata_api_key text;

-- Skip-trace usage log, metered per matched person record for add-on billing.
create table if not exists skip_trace_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  cost_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists skip_trace_usage_user_created_idx
  on skip_trace_usage (user_id, created_at desc);

alter table skip_trace_usage enable row level security;

-- Users can only ever see their own usage rows.
drop policy if exists "users read own skip trace usage" on skip_trace_usage;
create policy "users read own skip trace usage"
  on skip_trace_usage for select
  using (auth.uid() = user_id);

-- Inserts go through the server API route (service context); no direct
-- client inserts allowed.
drop policy if exists "no direct client inserts on skip trace usage" on skip_trace_usage;
create policy "no direct client inserts on skip trace usage"
  on skip_trace_usage for insert
  with check (false);

drop policy if exists "no client updates on skip trace usage" on skip_trace_usage;
create policy "no client updates on skip trace usage"
  on skip_trace_usage for update
  using (false);

drop policy if exists "no client deletes on skip trace usage" on skip_trace_usage;
create policy "no client deletes on skip trace usage"
  on skip_trace_usage for delete
  using (false);
