-- =============================================================================
-- FJ Ride Dispatch - flights
-- Project ref: dyjgrxeqdvnxwcbwzkql
--
--   flight_no   e.g. 9P841
--   flight_code e.g. LHE-DXB
--   route       e.g. Lahore - Dubai
--   city_id     mandatory (city-scoped like every other list table)
--
-- ref_no from public.ref_no_seq. RLS = has_perm('flights', <action>) AND
-- has_city(city_id).
-- =============================================================================

create table if not exists public.flights (
  id          uuid primary key default gen_random_uuid(),
  ref_no      bigint not null unique default nextval('public.ref_no_seq'),
  flight_no   text not null,
  flight_code text,
  route       text,
  city_id     integer not null references public.cities(id),
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists flights_city_idx on public.flights (city_id);

drop trigger if exists trg_flights_updated on public.flights;
create trigger trg_flights_updated before update on public.flights
  for each row execute function public.set_updated_at();

alter table public.flights enable row level security;

drop policy if exists flights_select on public.flights;
drop policy if exists flights_insert on public.flights;
drop policy if exists flights_update on public.flights;
drop policy if exists flights_delete on public.flights;

create policy flights_select on public.flights for select to authenticated
  using (private.is_active_user() and private.has_perm('flights', 'view') and private.has_city(city_id));
create policy flights_insert on public.flights for insert to authenticated
  with check ((private.is_admin() or private.has_perm('flights', 'add')) and private.has_city(city_id));
create policy flights_update on public.flights for update to authenticated
  using ((private.is_admin() or private.has_perm('flights', 'edit')) and private.has_city(city_id))
  with check ((private.is_admin() or private.has_perm('flights', 'edit')) and private.has_city(city_id));
create policy flights_delete on public.flights for delete to authenticated
  using ((private.is_admin() or private.has_perm('flights', 'delete')) and private.has_city(city_id));

grant select, insert, update, delete on public.flights to authenticated, service_role;

insert into public.role_permissions (role, page, action, allowed)
select 'admin', 'flights', action, true
from (values ('view'::public.perm_action), ('add'), ('edit'), ('delete')) as a(action)
on conflict (role, page, action) do nothing;
