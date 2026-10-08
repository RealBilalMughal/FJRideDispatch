-- Driver QR link active/inactive toggle with reason.
alter table public.drivers
  add column if not exists qr_active           boolean not null default true,
  add column if not exists qr_inactive_reason  text;
