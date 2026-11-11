-- Who the own dialer is calling for this lead: the property owner
-- (default) or the listing agent. The agent greets listing agents
-- differently -- "your listing at ..." with seller-directed questions --
-- and never addresses an agent as the owner ("your property", "are you
-- considering selling").
-- Safe to run before or after the app code that reads it lands: the
-- code treats a missing column as "owner" and never fails a call.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS recipient_type text NOT NULL DEFAULT 'owner'
  CHECK (recipient_type IN ('owner', 'agent'));
