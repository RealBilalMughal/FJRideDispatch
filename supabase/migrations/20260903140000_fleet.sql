-- =============================================================================
-- FJ Ride Dispatch - Fleet: vendors, drivers, vehicles
-- Project ref: dyjgrxeqdvnxwcbwzkql
--
--   vendors   - name, contact (PK phone), city   (Crew-style, city-scoped)
--   drivers   - name, contact, city, vendor (required)
--   vehicles  - vehicle_no (unique), company, model, year, color, city,
--               driver (optional, but a driver can be on ONE vehicle only)
--
-- All three: `ref_no` from public.ref_no_seq, `city_id NOT NULL`, RLS =
-- has_perm('<page>', <action>) AND has_city(city_id).
-- =============================================================================

-- ------------------------------------------------------------------ vendors ---
create table if not exists public.vendors (
  id          uuid primary key default gen_random_uuid(),
  ref_no      bigint not null unique default nextval('public.ref_no_seq'),
  name        text not null,
  contact     text,
  city_id     integer not null references public.cities(id),
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists vendors_city_idx on public.vendors (city_id);

-- ------------------------------------------------------------------ drivers ---
create table if not exists public.drivers (
  id          uuid primary key default gen_random_uuid(),
  ref_no      bigint not null unique default nextval('public.ref_no_seq'),
  name        text not null,
  contact     text,
  city_id     integer not null references public.cities(id),
  vendor_id   uuid not null references public.vendors(id) on delete restrict,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists drivers_city_idx   on public.drivers (city_id);
create index if not exists drivers_vendor_idx on public.drivers (vendor_id);

-- ----------------------------------------------------------------- vehicles ---
create table if not exists public.vehicles (
  id          uuid primary key default gen_random_uuid(),
  ref_no      bigint not null unique default nextval('public.ref_no_seq'),
  vehicle_no  text not null unique,
  company     text,
  model       text,
  year        integer,
  color       text,
  city_id     integer not null references public.cities(id),
  driver_id   uuid references public.drivers(id) on delete set null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists vehicles_city_idx on public.vehicles (city_id);
-- a driver can be assigned to at most one vehicle
create unique index if not exists vehicles_driver_uniq
  on public.vehicles (driver_id) where driver_id is not null;

-- ------------------------------------------------------------- updated_at ----
drop trigger if exists trg_vendors_updated  on public.vendors;
drop trigger if exists trg_drivers_updated  on public.drivers;
drop trigger if exists trg_vehicles_updated on public.vehicles;
create trigger trg_vendors_updated  before update on public.vendors  for each row execute function public.set_updated_at();
create trigger trg_drivers_updated  before update on public.drivers  for each row execute function public.set_updated_at();
create trigger trg_vehicles_updated before update on public.vehicles for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.vendors  enable row level security;
alter table public.drivers  enable row level security;
alter table public.vehicles enable row level security;

do $$
declare t text;
begin
  foreach t in array array['vendors', 'drivers', 'vehicles'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);

    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (private.is_active_user() and private.has_perm('%1$s', 'view') and private.has_city(city_id))
    $f$, t);
    execute format($f$
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((private.is_admin() or private.has_perm('%1$s', 'add')) and private.has_city(city_id))
    $f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((private.is_admin() or private.has_perm('%1$s', 'edit')) and private.has_city(city_id))
        with check ((private.is_admin() or private.has_perm('%1$s', 'edit')) and private.has_city(city_id))
    $f$, t);
    execute format($f$
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using ((private.is_admin() or private.has_perm('%1$s', 'delete')) and private.has_city(city_id))
    $f$, t);
  end loop;
end $$;

-- =============================================================================
-- Grants
-- =============================================================================
grant select, insert, update, delete on public.vendors  to authenticated, service_role;
grant select, insert, update, delete on public.drivers  to authenticated, service_role;
grant select, insert, update, delete on public.vehicles to authenticated, service_role;

-- =============================================================================
-- Seed: permission defaults for the built-in admin (super_admin bypasses)
-- =============================================================================
insert into public.role_permissions (role, page, action, allowed)
select 'admin', page, action, true
from (values ('vendors'), ('drivers'), ('vehicles')) as p(page)
cross join (values ('view'::public.perm_action), ('add'), ('edit'), ('delete')) as a(action)
on conflict (role, page, action) do nothing;
