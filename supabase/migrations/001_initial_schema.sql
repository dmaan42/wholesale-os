-- WholesaleOS initial schema
-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS.

-- ============================ profiles ============================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  stripe_customer_id text,
  subscription_status text default 'triage',
  created_at timestamptz default now()
);
alter table profiles enable row level security;
drop policy if exists "users read own profile" on profiles;
create policy "users read own profile" on profiles
  for select using (auth.uid() = id);
drop policy if exists "users update own profile" on profiles;
create policy "users update own profile" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================ leads ============================
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text default '',
  city text default '',
  state text default '',
  zip text default '',
  owner_name text default '',
  phone text default '',
  email text default '',
  motivation text default '',
  status text default 'new',
  source text default '',
  arv numeric default 0,
  repair_estimate numeric default 0,
  offer_price numeric default 0,
  notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table leads enable row level security;
drop policy if exists "users manage own leads" on leads;
create policy "users manage own leads" on leads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists leads_user_id_idx on leads (user_id);
create index if not exists leads_status_idx on leads (status);

-- ============================ buyers ============================
create table if not exists buyers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text default '',
  phone text default '',
  email text default '',
  buy_box text default '',
  preferred_areas text default '',
  proof_of_funds boolean default false,
  notes text default '',
  created_at timestamptz default now()
);
alter table buyers enable row level security;
drop policy if exists "users manage own buyers" on buyers;
create policy "users manage own buyers" on buyers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists buyers_user_id_idx on buyers (user_id);

-- ============================ call_logs ============================
-- Powers the AI dialer: every outbound/inbound call lands here, and the
-- dialer webhook updates the linked lead's pipeline stage from the outcome.
create table if not exists call_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  phone text default '',
  direction text default 'outbound',
  status text default 'initiated',
  duration_seconds integer default 0,
  recording_url text,
  summary text,
  outcome text,
  provider text default '',
  provider_call_id text,
  created_at timestamptz default now()
);
alter table call_logs enable row level security;
drop policy if exists "users manage own call_logs" on call_logs;
create policy "users manage own call_logs" on call_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists call_logs_user_id_idx on call_logs (user_id);
create index if not exists call_logs_lead_id_idx on call_logs (lead_id);

-- ============================ updated_at trigger ============================
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_touch_updated_at on leads;
create trigger leads_touch_updated_at
  before update on leads
  for each row execute procedure public.touch_updated_at();
