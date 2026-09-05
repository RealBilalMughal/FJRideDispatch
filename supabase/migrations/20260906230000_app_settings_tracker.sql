-- A tiny global (not per-city) settings singleton, starting with the one
-- fleet-wide GPS tracker sharing link (e.g. AI Track) - embedded on the
-- Vehicle Board's Tracker tab. Same "everyone reads, super_admin writes"
-- pattern as cities_select/cities_super.
create table if not exists public.app_settings (
  id boolean primary key default true,
  tracker_url text,
  constraint app_settings_singleton check (id)
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists app_settings_select on public.app_settings;
drop policy if exists app_settings_super  on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated
  using (private.is_active_user());
create policy app_settings_super on public.app_settings for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

grant select, insert, update, delete on public.app_settings to authenticated, service_role;
