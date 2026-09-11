-- =============================================================================
-- FJ Ride Dispatch - Ride Plan import (plan-vs-actual)
--
--   A dispatcher uploads a day's plan (an Excel export from the planning
--   team: Date/Base/Car/Ad-hoc Car/Block Type/Trip ID/Flight No/Origin/
--   Destination/Start Time/End Time/Distance (km)/Crew Count/Crew) as one
--   `ride_plan_imports` row + many `ride_plan_rows`. Marking a row "Followed"
--   opens the normal Add Ride form pre-filled from it and links the real
--   `rides` row back via `ride_id`, so planned vs actual KM can be reported.
--
--   `trip_id` is the sheet's own pairing key: a deadhead row and its pickup
--   share one Trip ID, as do a return leg and its dropoff (confirmed against
--   the sample data - counts matched exactly). Deadhead/return-leg rows are
--   not dispatched directly - they ride along on the ALREADY-BUILT "Also
--   create a Deadhead" (Pickup) / "Create Ride -> Return Leg" (Dropoff)
--   features, so `ride_plan_rows` only needs pending/followed/skipped state
--   and a link, not its own dispatch logic.
-- =============================================================================

-- Crew CSV/plan matching key: the sheet always carries an Employee No
-- alongside the name (e.g. "107386 Arfa IJAZ (CC)"). Optional/unique like
-- `contact` - not every existing crew row will have one until re-imported.
alter table public.crew add column if not exists employee_no text;
create unique index if not exists crew_employee_no_uniq
  on public.crew (employee_no)
  where employee_no is not null and employee_no <> '';

-- --------------------------------------------------------------- imports ------
create table if not exists public.ride_plan_imports (
  id         uuid primary key default gen_random_uuid(),
  ref_no     bigint not null unique default nextval('public.ref_no_seq'),
  city_id    integer not null references public.cities(id),
  file_name  text,
  row_count  integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ride_plan_imports_city_idx on public.ride_plan_imports (city_id);

-- ------------------------------------------------------------------- rows -----
create table if not exists public.ride_plan_rows (
  id        uuid primary key default gen_random_uuid(),
  ref_no    bigint not null unique default nextval('public.ref_no_seq'),
  import_id uuid not null references public.ride_plan_imports(id) on delete cascade,
  city_id   integer not null references public.cities(id),

  plan_date  date not null,
  trip_id    text not null,
  block_type text not null check (block_type in ('deadhead', 'pickup', 'dropoff', 'return_leg')),

  car          text,    -- planned vehicle_no, from the sheet
  is_adhoc_car boolean not null default false,
  flight_no    text,
  origin       text,
  destination  text,
  start_time   time,
  end_time     time,
  planned_km   numeric(8, 2),
  crew_count   integer,
  crew_raw     text,               -- the sheet's own "Crew" cell, verbatim
  crew_matches jsonb not null default '[]'::jsonb, -- [{raw, employee_no, name, designation, crew_id, tier}]

  matched_flight_id  uuid references public.flights(id) on delete set null,
  matched_vehicle_id uuid references public.vehicles(id) on delete set null,

  status      text not null default 'pending' check (status in ('pending', 'followed', 'skipped')),
  skip_reason text,
  ride_id     uuid references public.rides(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ride_plan_rows_import_idx     on public.ride_plan_rows (import_id);
create index if not exists ride_plan_rows_trip_idx       on public.ride_plan_rows (trip_id);
create index if not exists ride_plan_rows_city_date_idx  on public.ride_plan_rows (city_id, plan_date);
create index if not exists ride_plan_rows_ride_idx       on public.ride_plan_rows (ride_id);

drop trigger if exists trg_ride_plan_rows_updated on public.ride_plan_rows;
create trigger trg_ride_plan_rows_updated before update on public.ride_plan_rows
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.ride_plan_imports enable row level security;
alter table public.ride_plan_rows    enable row level security;

drop policy if exists rpi_select on public.ride_plan_imports;
drop policy if exists rpi_insert on public.ride_plan_imports;
drop policy if exists rpi_delete on public.ride_plan_imports;
create policy rpi_select on public.ride_plan_imports for select to authenticated
  using (private.is_active_user() and private.has_perm('ride_plan', 'view') and private.has_city(city_id));
create policy rpi_insert on public.ride_plan_imports for insert to authenticated
  with check ((private.is_admin() or private.has_perm('ride_plan', 'add')) and private.has_city(city_id));
create policy rpi_delete on public.ride_plan_imports for delete to authenticated
  using ((private.is_admin() or private.has_perm('ride_plan', 'delete')) and private.has_city(city_id));

drop policy if exists rpr_select on public.ride_plan_rows;
drop policy if exists rpr_insert on public.ride_plan_rows;
drop policy if exists rpr_update on public.ride_plan_rows;
drop policy if exists rpr_delete on public.ride_plan_rows;
create policy rpr_select on public.ride_plan_rows for select to authenticated
  using (private.is_active_user() and private.has_perm('ride_plan', 'view') and private.has_city(city_id));
create policy rpr_insert on public.ride_plan_rows for insert to authenticated
  with check ((private.is_admin() or private.has_perm('ride_plan', 'add')) and private.has_city(city_id));
create policy rpr_update on public.ride_plan_rows for update to authenticated
  using ((private.is_admin() or private.has_perm('ride_plan', 'edit')) and private.has_city(city_id))
  with check ((private.is_admin() or private.has_perm('ride_plan', 'edit')) and private.has_city(city_id));
create policy rpr_delete on public.ride_plan_rows for delete to authenticated
  using ((private.is_admin() or private.has_perm('ride_plan', 'delete')) and private.has_city(city_id));

-- =============================================================================
-- Grants
-- =============================================================================
grant select, insert, update, delete on public.ride_plan_imports to authenticated, service_role;
grant select, insert, update, delete on public.ride_plan_rows    to authenticated, service_role;

-- =============================================================================
-- Seed: ride_plan permission defaults for the built-in admin (super_admin bypasses)
-- =============================================================================
insert into public.role_permissions (role, page, action, allowed)
select 'admin', 'ride_plan', action, true
from (values ('view'::public.perm_action), ('add'), ('edit'), ('delete')) as a(action)
on conflict (role, page, action) do nothing;
