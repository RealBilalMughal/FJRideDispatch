-- =============================================================================
-- FJ Ride Dispatch - rides (the dispatch board)
-- Project ref: dyjgrxeqdvnxwcbwzkql
--
--   A ride is built from a flight + a block type + crew + a vehicle.
--   Route (ordered coords) depends on the block:
--     pickup      crew1 -> crew2 -> ... -> crewN -> Airport
--     dropoff     Airport -> crew1 -> ... -> crewN
--     deadhead    'airport' mode: Airport -> 1 crew ; 'crew' mode: crew1 -> crew2
--     return_leg  1 crew -> Airport
--   distance_km / duration_min come from OpenRouteService (road distance).
--
--   A vehicle can't be on two overlapping rides: EXCLUDE USING gist on
--   (vehicle_id, tstzrange(start_at, end_at)).
-- =============================================================================

create extension if not exists btree_gist;

-- ---- per-city airport (origin/destination anchor for airport-side legs) ------
alter table public.cities
  add column if not exists airport_name text,
  add column if not exists airport_lat  numeric(9, 6),
  add column if not exists airport_lng  numeric(9, 6);

-- --------------------------------------------------------------- rides --------
create table if not exists public.rides (
  id           uuid primary key default gen_random_uuid(),
  ref_no       bigint not null unique default nextval('public.ref_no_seq'),
  city_id      integer not null references public.cities(id),

  flight_id    uuid references public.flights(id) on delete set null,
  flight_no    text,          -- snapshot (survives flight deletion / edits)
  flight_code  text,          -- snapshot

  block_type    text not null check (block_type in ('deadhead', 'pickup', 'dropoff', 'return_leg')),
  deadhead_mode text check (deadhead_mode in ('airport', 'crew')),  -- only for block_type = deadhead

  ride_date     date not null default current_date,
  checkin_old   time, checkin_new   time,
  checkout_old  time, checkout_new  time,
  start_at      timestamptz,
  end_at        timestamptz,

  vehicle_id   uuid references public.vehicles(id) on delete set null,

  airport_name text,
  airport_lat  numeric(9, 6), airport_lng numeric(9, 6),
  origin_label text, origin_lat numeric(9, 6), origin_lng numeric(9, 6),
  dest_label   text, dest_lat   numeric(9, 6), dest_lng   numeric(9, 6),
  waypoints    jsonb not null default '[]'::jsonb,  -- ordered [{seq,kind,crew_id?,label,lat,lng}]

  distance_km  numeric(8, 2),
  duration_min integer,

  status       text not null default 'scheduled'
               check (status in ('scheduled', 'dispatched', 'enroute', 'completed', 'cancelled')),
  return_of_ride_id uuid references public.rides(id) on delete set null,
  notes        text,

  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  check (end_at is null or start_at is null or end_at > start_at)
);
create index if not exists rides_city_idx    on public.rides (city_id);
create index if not exists rides_date_idx    on public.rides (ride_date);
create index if not exists rides_vehicle_idx on public.rides (vehicle_id);

-- one vehicle, one time window
alter table public.rides drop constraint if exists rides_vehicle_window_excl;
alter table public.rides
  add constraint rides_vehicle_window_excl
  exclude using gist (
    vehicle_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (vehicle_id is not null and start_at is not null and end_at is not null);

-- --------------------------------------------------------- ride <-> crew ------
create table if not exists public.ride_crew (
  ride_id uuid not null references public.rides(id) on delete cascade,
  crew_id uuid not null references public.crew(id)  on delete restrict,
  seq     integer not null default 0,
  primary key (ride_id, crew_id)
);
create index if not exists ride_crew_crew_idx on public.ride_crew (crew_id);

drop trigger if exists trg_rides_updated on public.rides;
create trigger trg_rides_updated before update on public.rides
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.rides     enable row level security;
alter table public.ride_crew enable row level security;

drop policy if exists rides_select on public.rides;
drop policy if exists rides_insert on public.rides;
drop policy if exists rides_update on public.rides;
drop policy if exists rides_delete on public.rides;
create policy rides_select on public.rides for select to authenticated
  using (private.is_active_user() and private.has_perm('rides', 'view') and private.has_city(city_id));
create policy rides_insert on public.rides for insert to authenticated
  with check ((private.is_admin() or private.has_perm('rides', 'add')) and private.has_city(city_id));
create policy rides_update on public.rides for update to authenticated
  using ((private.is_admin() or private.has_perm('rides', 'edit')) and private.has_city(city_id))
  with check ((private.is_admin() or private.has_perm('rides', 'edit')) and private.has_city(city_id));
create policy rides_delete on public.rides for delete to authenticated
  using ((private.is_admin() or private.has_perm('rides', 'delete')) and private.has_city(city_id));

-- ride_crew: gated through the parent ride (its RLS already scopes city + perm)
drop policy if exists rc_select on public.ride_crew;
drop policy if exists rc_write  on public.ride_crew;
create policy rc_select on public.ride_crew for select to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id));
create policy rc_write on public.ride_crew for all to authenticated
  using (
    exists (select 1 from public.rides r where r.id = ride_id)
    and (private.is_admin() or private.has_perm('rides', 'add') or private.has_perm('rides', 'edit'))
  )
  with check (
    exists (select 1 from public.rides r where r.id = ride_id)
    and (private.is_admin() or private.has_perm('rides', 'add') or private.has_perm('rides', 'edit'))
  );

-- =============================================================================
-- Grants
-- =============================================================================
grant select, insert, update, delete on public.rides     to authenticated, service_role;
grant select, insert, update, delete on public.ride_crew to authenticated, service_role;

-- =============================================================================
-- Seed: rides permission defaults for the built-in admin (super_admin bypasses)
-- =============================================================================
insert into public.role_permissions (role, page, action, allowed)
select 'admin', 'rides', action, true
from (values ('view'::public.perm_action), ('add'), ('edit'), ('delete')) as a(action)
on conflict (role, page, action) do nothing;
