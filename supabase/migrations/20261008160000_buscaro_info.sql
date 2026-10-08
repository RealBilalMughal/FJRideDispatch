-- BusCaro company info: singleton table for website, email, contact, address,
-- theme color, logo and watermark image paths. Shown on driver public profile
-- page. Public read (anon); super_admin only for update.

-- Storage bucket for company assets (logo, watermark)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-assets',
  'company-assets',
  true,
  5242880,  -- 5 MB
  array['image/jpeg','image/png','image/webp','image/svg+xml']
)
on conflict (id) do nothing;

create policy "company_assets_select"
  on storage.objects for select
  using (bucket_id = 'company-assets');

create policy "company_assets_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-assets'
    and private.current_user_role() = 'super_admin'
  );

create policy "company_assets_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'company-assets'
    and private.current_user_role() = 'super_admin'
  );

create policy "company_assets_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'company-assets'
    and private.current_user_role() = 'super_admin'
  );

-- Singleton table (id always = 1)
create table public.buscaro_info (
  id          integer primary key default 1 check (id = 1),
  website     text,
  email       text,
  contact     text,
  address     text,
  theme_color text not null default '#fe8c03',
  logo_path   text,
  watermark_path text,
  updated_at  timestamptz not null default now()
);

alter table public.buscaro_info enable row level security;

-- Anyone can read (public profile page is unauthenticated)
create policy "buscaro_info_select"
  on public.buscaro_info for select
  using (true);

-- Only super_admin can update
create policy "buscaro_info_update"
  on public.buscaro_info for update to authenticated
  using  (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

grant select on public.buscaro_info to anon, authenticated;
grant update on public.buscaro_info to authenticated;

-- Seed the one row with defaults
insert into public.buscaro_info (id, website, email, contact, address, theme_color)
values (1, 'www.buscaro.com', 'info@buscaro.com', '+92 300 000 0000', 'Lahore, Pakistan', '#fe8c03')
on conflict (id) do nothing;
