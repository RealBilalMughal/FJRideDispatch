-- Driver documents: photos/scans uploaded per driver, shown on public QR scan page.

-- Storage bucket (public read so QR-scan page can display images without auth)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'driver-docs',
  'driver-docs',
  true,
  10485760,  -- 10 MB per file
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
)
on conflict (id) do nothing;

-- Storage RLS: authenticated users with drivers.edit can upload/delete.
create policy "driver_docs_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'driver-docs'
    and private.has_perm('drivers', 'edit')
  );

create policy "driver_docs_storage_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'driver-docs'
    and private.has_perm('drivers', 'edit')
  );

create policy "driver_docs_storage_select"
  on storage.objects for select
  using (bucket_id = 'driver-docs');

-- driver_docs table
create table public.driver_docs (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references public.drivers(id) on delete cascade,
  city_id     integer not null references public.cities(id),
  label       text,
  storage_path text not null,
  uploaded_at  timestamptz not null default now(),
  uploaded_by  uuid references auth.users(id) on delete set null
);

alter table public.driver_docs enable row level security;

-- Public can view (QR scan page is publicly accessible)
create policy "driver_docs_select_public"
  on public.driver_docs for select
  using (true);

-- Authenticated with drivers.edit + city access can add
create policy "driver_docs_insert"
  on public.driver_docs for insert to authenticated
  with check (
    private.has_perm('drivers', 'edit')
    and private.has_city(city_id)
  );

-- Authenticated with drivers.edit + city access can delete
create policy "driver_docs_delete"
  on public.driver_docs for delete to authenticated
  using (
    private.has_perm('drivers', 'edit')
    and private.has_city(city_id)
  );

-- Grant
grant select, insert, delete on public.driver_docs to authenticated;
grant select on public.driver_docs to anon;
