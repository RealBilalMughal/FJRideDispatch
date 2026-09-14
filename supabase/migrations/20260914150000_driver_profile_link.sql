alter table public.drivers add column if not exists profile_id uuid references auth.users(id) on delete set null;
create index if not exists drivers_profile_id_idx on public.drivers(profile_id);
