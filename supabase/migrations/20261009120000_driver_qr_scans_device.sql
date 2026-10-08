-- Add device info and IP columns to QR scan log
alter table public.driver_qr_scans
  add column if not exists user_agent text,
  add column if not exists ip_address text;
