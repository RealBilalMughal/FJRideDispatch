create table public.account_managers (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  designation text,
  email       text,
  contact     text,
  created_at  timestamptz not null default now()
);

alter table public.account_managers enable row level security;

-- super_admin: full access
create policy "am_all"
  on public.account_managers
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

-- authenticated active users: read only (for Driver card dropdown)
create policy "am_select"
  on public.account_managers
  for select
  using (private.is_active_user());
