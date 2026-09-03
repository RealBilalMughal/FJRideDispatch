-- =============================================================================
-- FJ Ride Dispatch - cities (as a permission dimension), shared ref series, crew
-- Project ref: dyjgrxeqdvnxwcbwzkql
--
--   * public.ref_no_seq   - ONE display-ID sequence for every entity table.
--                           Whatever record is created next gets the next number
--                           (crew 1001 -> vendor 1002 -> ...). Starts at 1001,
--                           shown as a plain number (no prefix / no '#').
--   * public.cities        - Lahore / Karachi / Islamabad (add more later).
--   * role_cities / user_cities - which cities a role / user may see. A user with
--     NO rows anywhere = every city (permissive). Rows present = restricted to
--     exactly those. user_cities overrides role_cities. super_admin = every city.
--   * private.has_city(city_id) - RLS helper. Every city-scoped table ANDs it.
--   * public.crew          - first dispatch table (one stop per crew).
-- =============================================================================

-- ------------------------------------------------------- shared ID series ----
create sequence if not exists public.ref_no_seq as bigint start with 1001 minvalue 1;
grant usage, select on sequence public.ref_no_seq to authenticated, service_role;

-- ---------------------------------------------------------------- cities ------
create table if not exists public.cities (
  id         integer generated always as identity primary key,
  name       text not null unique,
  sort       integer not null default 100,
  created_at timestamptz not null default now()
);

insert into public.cities (name, sort) values
  ('Lahore', 10), ('Karachi', 20), ('Islamabad', 30)
on conflict (name) do nothing;

-- -------------------------------------------------- role / user city access --
create table if not exists public.role_cities (
  role    text    not null references public.roles(key) on delete cascade,
  city_id integer not null references public.cities(id) on delete cascade,
  primary key (role, city_id)
);

create table if not exists public.user_cities (
  user_id uuid    not null references public.profiles(id) on delete cascade,
  city_id integer not null references public.cities(id)   on delete cascade,
  primary key (user_id, city_id)
);

-- super_admin -> every city
-- else if the user has any user_cities rows  -> only those
-- else if any of the user's roles has role_cities rows -> the union of those
-- else (nothing configured) -> every city
create or replace function private.has_city(target integer)
returns boolean language sql stable security definer set search_path = public as $$
  select
    private.current_user_role() = 'super_admin'
    or case
         when exists (select 1 from public.user_cities where user_id = auth.uid()) then
           exists (select 1 from public.user_cities
                    where user_id = auth.uid() and city_id = target)
         when exists (
           select 1 from public.role_cities rc
           join public.user_roles ur on ur.role = rc.role
           where ur.user_id = auth.uid()
         ) then
           exists (
             select 1 from public.role_cities rc
             join public.user_roles ur on ur.role = rc.role
             where ur.user_id = auth.uid() and rc.city_id = target
           )
         else true
       end;
$$;
revoke execute on function private.has_city(integer) from public, anon;
grant  execute on function private.has_city(integer) to authenticated;

-- ------------------------------------------------------------------ crew ------
create table if not exists public.crew (
  id          uuid primary key default gen_random_uuid(),
  ref_no      bigint not null unique default nextval('public.ref_no_seq'),
  name        text not null,
  contact     text,
  designation text,
  city_id     integer not null references public.cities(id),
  stop_name   text,
  stop_lat    numeric(9, 6),
  stop_lng    numeric(9, 6),
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists crew_city_idx on public.crew (city_id);

drop trigger if exists trg_crew_updated on public.crew;
create trigger trg_crew_updated before update on public.crew
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.cities      enable row level security;
alter table public.role_cities enable row level security;
alter table public.user_cities enable row level security;
alter table public.crew        enable row level security;

-- ---- cities: everyone active reads; super_admin manages ----
drop policy if exists cities_select on public.cities;
drop policy if exists cities_super  on public.cities;
create policy cities_select on public.cities for select to authenticated
  using (private.is_active_user());
create policy cities_super on public.cities for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

-- ---- role_cities: readable by any active user; super_admin manages ----
drop policy if exists rc_select on public.role_cities;
drop policy if exists rc_super  on public.role_cities;
create policy rc_select on public.role_cities for select to authenticated
  using (private.is_active_user());
create policy rc_super on public.role_cities for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

-- ---- user_cities: own rows or super_admin; super_admin manages ----
drop policy if exists uc_select on public.user_cities;
drop policy if exists uc_super  on public.user_cities;
create policy uc_select on public.user_cities for select to authenticated
  using (user_id = auth.uid() or private.current_user_role() = 'super_admin');
create policy uc_super on public.user_cities for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

-- ---- crew: page permission AND city access ----
drop policy if exists crew_select on public.crew;
drop policy if exists crew_insert on public.crew;
drop policy if exists crew_update on public.crew;
drop policy if exists crew_delete on public.crew;
create policy crew_select on public.crew for select to authenticated
  using (private.is_active_user() and private.has_perm('crew', 'view') and private.has_city(city_id));
create policy crew_insert on public.crew for insert to authenticated
  with check ((private.is_admin() or private.has_perm('crew', 'add')) and private.has_city(city_id));
create policy crew_update on public.crew for update to authenticated
  using ((private.is_admin() or private.has_perm('crew', 'edit')) and private.has_city(city_id))
  with check ((private.is_admin() or private.has_perm('crew', 'edit')) and private.has_city(city_id));
create policy crew_delete on public.crew for delete to authenticated
  using ((private.is_admin() or private.has_perm('crew', 'delete')) and private.has_city(city_id));

-- =============================================================================
-- Grants (CLI migrations don't get Supabase's auto-grant)
-- =============================================================================
grant select, insert, update, delete on public.cities      to authenticated, service_role;
grant select, insert, update, delete on public.role_cities to authenticated, service_role;
grant select, insert, update, delete on public.user_cities to authenticated, service_role;
grant select, insert, update, delete on public.crew        to authenticated, service_role;

-- =============================================================================
-- Seed: crew permission defaults for the built-in admin (super_admin bypasses)
-- =============================================================================
insert into public.role_permissions (role, page, action, allowed) values
  ('admin','crew','view',true),('admin','crew','add',true),
  ('admin','crew','edit',true),('admin','crew','delete',true)
on conflict (role, page, action) do nothing;
