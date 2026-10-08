-- Optional redirect URL: visiting /d/:refNo forwards to this URL when set
alter table public.drivers
  add column if not exists qr_redirect_url text;
