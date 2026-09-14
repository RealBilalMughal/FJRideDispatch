-- Vehicle Odometer Readings
-- Driver role, storage bucket, vehicle_odometer_logs table, RLS, seeded permissions.

-- ============================================================
-- 1. Driver system role
-- ============================================================
insert into public.roles (key, label)
values ('driver', 'Driver')
on conflict (key) do nothing;

-- ============================================================
-- 2. Storage bucket for odometer photos (public - just numbers)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'odometer-images',
  'odometer-images',
  true,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do nothing;

-- any authenticated user can upload / read (table RLS is the real gate)
create policy "odo_img_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'odometer-images');

create policy "odo_img_select" on storage.objects
  for select using (bucket_id = 'odometer-images');

create policy "odo_img_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'odometer-images' and auth.uid()::text = owner_id::text);

create policy "odo_img_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'odometer-images' and auth.uid()::text = owner_id::text);

-- ============================================================
-- 3. vehicle_odometer_logs
-- ============================================================
create table public.vehicle_odometer_logs (
  id           uuid          default gen_random_uuid() primary key,
  ref_no       bigint        not null unique default nextval('public.ref_no_seq'),
  vehicle_id   uuid          not null references public.vehicles(id) on delete cascade,
  log_date     date          not null,
  city_id      integer       not null references public.cities(id),
  km_reading   numeric(10,1) not null check (km_reading >= 0),
  daily_km     numeric(10,1),          -- today - prev day reading; null if no prev
  image_url    text,
  is_verified  boolean       not null default false,
  verified_by  uuid          references public.profiles(id) on delete set null,
  verified_at  timestamptz,
  notes        text,
  recorded_by  uuid          not null references public.profiles(id) on delete restrict,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

-- one reading per vehicle per date
create unique index odometer_vehicle_date_uniq
  on public.vehicle_odometer_logs (vehicle_id, log_date);

create index odometer_city_date_idx
  on public.vehicle_odometer_logs (city_id, log_date desc);

grant select, insert, update, delete
  on public.vehicle_odometer_logs to authenticated, service_role;

-- ============================================================
-- 4. Helper: is the caller a driver?
-- ============================================================
create or replace function private.is_driver()
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'driver'
  )
$$;

grant execute on function private.is_driver() to authenticated;

-- ============================================================
-- 5. RLS policies
-- ============================================================
alter table public.vehicle_odometer_logs enable row level security;

-- dispatchers with 'odometer' view perm, OR drivers (their own city)
create policy "odo_select" on public.vehicle_odometer_logs
  for select using (
    private.has_city(city_id) and (
      private.has_perm('odometer', 'view')
      or private.is_driver()
    )
  );

-- drivers can insert their own readings; dispatchers need add perm
create policy "odo_insert" on public.vehicle_odometer_logs
  for insert with check (
    private.has_city(city_id)
    and recorded_by = auth.uid()
    and (private.has_perm('odometer', 'add') or private.is_driver())
  );

create policy "odo_update" on public.vehicle_odometer_logs
  for update using (
    private.has_perm('odometer', 'edit') and private.has_city(city_id)
  );

create policy "odo_delete" on public.vehicle_odometer_logs
  for delete using (
    private.has_perm('odometer', 'delete') and private.has_city(city_id)
  );

-- ============================================================
-- 6. Seed admin role permissions
-- ============================================================
insert into public.role_permissions (role, page, action, allowed)
values
  ('admin', 'odometer', 'view',   true),
  ('admin', 'odometer', 'add',    true),
  ('admin', 'odometer', 'edit',   true),
  ('admin', 'odometer', 'delete', false)
on conflict (role, page, action) do nothing;
