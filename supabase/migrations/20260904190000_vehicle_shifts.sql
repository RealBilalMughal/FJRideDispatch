-- =============================================================================
-- FJ Ride Dispatch - two drivers per vehicle (day / night shift)
--
--   A vehicle runs 24h with a day driver and a night driver.
--   `vehicles.driver_id` stays = the DAY driver; `night_driver_id` is new
--   (nullable - single-shift vehicles leave it empty).
--   `dispatch_settings` holds ONE global shift window (default 08:00 / 20:00).
--   A ride snapshots which `shift` it ran and the `driver_id` that covered it.
-- =============================================================================

alter table public.vehicles
  add column if not exists night_driver_id uuid references public.drivers(id) on delete set null;

create unique index if not exists vehicles_night_driver_uniq
  on public.vehicles (night_driver_id) where night_driver_id is not null;

do $$ begin
  alter table public.vehicles
    add constraint vehicles_day_night_distinct
    check (night_driver_id is null or night_driver_id is distinct from driver_id);
exception when duplicate_object then null; end $$;

-- ---- global day/night shift window (single row) ----
create table if not exists public.dispatch_settings (
  id          boolean primary key default true check (id),
  day_start   time not null default '08:00',
  night_start time not null default '20:00',
  updated_at  timestamptz not null default now()
);
insert into public.dispatch_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists trg_dispatch_settings_updated on public.dispatch_settings;
create trigger trg_dispatch_settings_updated before update on public.dispatch_settings
  for each row execute function public.set_updated_at();

alter table public.dispatch_settings enable row level security;
grant select, insert, update on public.dispatch_settings to authenticated, service_role;

drop policy if exists ds_select on public.dispatch_settings;
drop policy if exists ds_manage on public.dispatch_settings;
create policy ds_select on public.dispatch_settings for select to authenticated
  using (private.is_active_user());
create policy ds_manage on public.dispatch_settings for all to authenticated
  using (private.is_admin() or private.has_perm('vehicles', 'edit'))
  with check (private.is_admin() or private.has_perm('vehicles', 'edit'));

-- ---- ride: snapshot the shift + the driver that covered it ----
alter table public.rides
  add column if not exists shift     text check (shift in ('day', 'night')),
  add column if not exists driver_id uuid references public.drivers(id) on delete set null;
