-- Track per-contact dial attempts so the campaign pump can give up on
-- chronically failing contacts instead of redialing them forever
-- (which previously burned through the provider's daily call limit).
alter table campaign_contacts
  add column if not exists attempts integer not null default 0;
