-- 002_campaigns.sql — AI batch dialer (Vapi /v2/campaign)
-- One row per batch run; contacts are the audience; call_logs rows link back.
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS.

-- ============================ campaigns ============================
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  vapi_campaign_id text,
  status text not null default 'draft', -- draft|running|cancelled|completed|failed
  total_contacts int not null default 0,
  max_concurrency int not null default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table campaigns enable row level security;
drop policy if exists "users manage own campaigns" on campaigns;
create policy "users manage own campaigns" on campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists campaigns_user_id_idx on campaigns(user_id);

-- ========================= campaign_contacts ========================
create table if not exists campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  phone text not null default '',
  name text not null default '',
  status text not null default 'queued', -- queued|calling|completed|failed|skipped
  call_log_id uuid references call_logs(id) on delete set null,
  created_at timestamptz default now()
);
alter table campaign_contacts enable row level security;
drop policy if exists "users manage own campaign contacts" on campaign_contacts;
create policy "users manage own campaign contacts" on campaign_contacts
  for all using (
    exists (
      select 1 from campaigns c
      where c.id = campaign_contacts.campaign_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from campaigns c
      where c.id = campaign_contacts.campaign_id and c.user_id = auth.uid()
    )
  );
create index if not exists campaign_contacts_campaign_id_idx on campaign_contacts(campaign_id);

-- Link call logs back to the campaign that placed them (nullable: manual
-- one-off AI calls have no campaign).
alter table call_logs add column if not exists campaign_id uuid references campaigns(id) on delete set null;
create index if not exists call_logs_campaign_id_idx on call_logs(campaign_id);
