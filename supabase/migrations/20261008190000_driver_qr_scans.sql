-- QR scan log: every public profile visit logs one row.
create table public.driver_qr_scans (
  id          uuid        primary key default gen_random_uuid(),
  driver_id   uuid        not null references public.drivers(id) on delete cascade,
  scanned_at  timestamptz not null default now()
);

alter table public.driver_qr_scans enable row level security;

-- Anyone (anon) can insert a scan (public profile visit)
create policy "qr_scans_insert_public"
  on public.driver_qr_scans for insert
  with check (true);

-- Authenticated users with drivers view perm can read scans
create policy "qr_scans_select"
  on public.driver_qr_scans for select
  using (private.is_active_user() and private.has_perm('drivers'::text, 'view'::perm_action));
