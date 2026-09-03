-- =============================================================================
-- FJ Ride Dispatch - initial auth + permission schema
-- Project ref: dyjgrxeqdvnxwcbwzkql
--
-- Ported/consolidated from GraphicSpark CRM migrations 001/002/003/020:
--   * profiles (1:1 with auth.users)
--   * roles           - 4 system rows + Super-Admin-added custom rows
--   * user_roles      - many-to-many; a user gets the UNION of every role
--   * role_permissions (role text -> roles.key, page, action, allowed)
--   * user_permissions (per-user override, wins outright)
--   * private.* RLS helpers + has_perm() ORing across the caller's roles
--   * profiles.role = derived "primary" system role, kept in sync by a trigger
--
-- Idempotent (safe to re-run).
-- =============================================================================

-- ------------------------------------------------------------------ enums ----
do $$ begin
  create type public.user_role as enum ('super_admin', 'admin', 'agent', 'ops');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.perm_action as enum ('view', 'add', 'edit', 'delete');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------- profiles ----
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text        not null default '',
  email       text        not null,
  phone       text,
  role        public.user_role not null default 'agent',
  avatar_url  text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------ role catalogue -
create table if not exists public.roles (
  key        text primary key,
  label      text not null,
  is_system  boolean not null default false,
  sort       integer not null default 100,
  created_at timestamptz not null default now()
);

insert into public.roles (key, label, is_system, sort) values
  ('super_admin', 'Super Admin', true, 0),
  ('admin',       'Admin',       true, 10),
  ('agent',       'Agent',       true, 20),
  ('ops',         'Ops',         true, 30)
on conflict (key) do nothing;

-- --------------------------------------------------- user <-> role (multi) ---
create table if not exists public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role    text not null references public.roles(key)   on delete cascade,
  primary key (user_id, role)
);
create index if not exists user_roles_role_idx on public.user_roles (role);

-- ------------------------------------------------------- role_permissions ----
create table if not exists public.role_permissions (
  role    text               not null references public.roles(key) on delete cascade,
  page    text               not null,
  action  public.perm_action not null,
  allowed boolean            not null default false,
  primary key (role, page, action)
);

-- ------------------------------------------------------- user_permissions ----
create table if not exists public.user_permissions (
  user_id uuid               not null references public.profiles(id) on delete cascade,
  page    text               not null,
  action  public.perm_action not null,
  allowed boolean            not null,
  primary key (user_id, page, action)
);

-- =============================================================================
-- Trigger functions (public schema, NOT exposed as REST RPC)
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

-- A service-role connection (auth.uid() null) may set role / is_active.
-- A logged-in non-admin still cannot change their own role or is_active.
create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not private.is_admin() then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Not allowed to change role or is_active';
    end if;
  end if;
  return new;
end $$;

-- keep profiles.role as the most-privileged system role the user holds
create or replace function public.sync_primary_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := coalesce(new.user_id, old.user_id);
  best text;
begin
  select ur.role into best
    from public.user_roles ur
    join public.roles r on r.key = ur.role
   where ur.user_id = uid
     and ur.role in ('super_admin', 'admin', 'agent', 'ops')
   order by r.sort
   limit 1;

  update public.profiles
     set role = coalesce(best, 'agent')::public.user_role
   where id = uid;

  return null;
end $$;

create or replace function public.protect_system_roles()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'System roles cannot be deleted';
    end if;
    return old;
  end if;
  if old.is_system and (new.key is distinct from old.key
                        or new.is_system is distinct from old.is_system) then
    raise exception 'A system role''s key cannot be changed';
  end if;
  return new;
end $$;

revoke execute on function public.set_updated_at()                    from anon, authenticated, public;
revoke execute on function public.handle_new_user()                   from anon, authenticated, public;
revoke execute on function public.protect_profile_privileged_fields() from anon, authenticated, public;
revoke execute on function public.sync_primary_role()                 from anon, authenticated, public;
revoke execute on function public.protect_system_roles()              from anon, authenticated, public;

-- ------------------------------------------------------------- triggers ----
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();

drop trigger if exists trg_user_roles_sync on public.user_roles;
create trigger trg_user_roles_sync after insert or delete on public.user_roles
  for each row execute function public.sync_primary_role();

drop trigger if exists trg_roles_protect on public.roles;
create trigger trg_roles_protect before update or delete on public.roles
  for each row execute function public.protect_system_roles();

-- =============================================================================
-- RLS helper functions in `private` (PostgREST does not expose the schema)
-- =============================================================================
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.current_user_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','admin') from public.profiles where id = auth.uid()), false);
$$;

-- super_admin -> true; else user override; else ANY of the caller's roles grants it; else false
create or replace function private.has_perm(p_page text, p_action public.perm_action)
returns boolean language sql stable security definer set search_path = public as $$
  select
    private.current_user_role() = 'super_admin'
    or coalesce(
      (select allowed from public.user_permissions
         where user_id = auth.uid() and page = p_page and action = p_action),
      (select bool_or(rp.allowed)
         from public.role_permissions rp
         join public.user_roles ur on ur.role = rp.role
        where ur.user_id = auth.uid()
          and rp.page = p_page and rp.action = p_action),
      false
    );
$$;

revoke execute on function private.current_user_role()               from public, anon;
revoke execute on function private.is_active_user()                   from public, anon;
revoke execute on function private.is_admin()                         from public, anon;
revoke execute on function private.has_perm(text, public.perm_action) from public, anon;
grant  execute on function private.current_user_role()               to authenticated;
grant  execute on function private.is_active_user()                   to authenticated;
grant  execute on function private.is_admin()                         to authenticated;
grant  execute on function private.has_perm(text, public.perm_action) to authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles         enable row level security;
alter table public.roles            enable row level security;
alter table public.user_roles       enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;

-- ---- profiles ----
drop policy if exists profiles_select     on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_admin_all  on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (private.is_active_user());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on public.profiles
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- ---- roles ----
drop policy if exists roles_select on public.roles;
drop policy if exists roles_super  on public.roles;
create policy roles_select on public.roles for select to authenticated
  using (private.is_active_user());
create policy roles_super on public.roles for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

-- ---- user_roles ----
drop policy if exists ur_select on public.user_roles;
drop policy if exists ur_super  on public.user_roles;
create policy ur_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or private.current_user_role() = 'super_admin');
create policy ur_super on public.user_roles for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

-- ---- role_permissions ----
drop policy if exists rp_select      on public.role_permissions;
drop policy if exists rp_super_admin on public.role_permissions;
create policy rp_select on public.role_permissions for select to authenticated
  using (private.is_active_user());
create policy rp_super_admin on public.role_permissions for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

-- ---- user_permissions ----
drop policy if exists up_select      on public.user_permissions;
drop policy if exists up_super_admin on public.user_permissions;
create policy up_select on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or private.current_user_role() = 'super_admin');
create policy up_super_admin on public.user_permissions for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

-- =============================================================================
-- Table privilege grants (MCP/CLI migrations don't get Supabase's auto-grant)
-- =============================================================================
grant select, insert, update, delete on public.profiles         to authenticated, service_role;
grant select, insert, update, delete on public.roles            to authenticated, service_role;
grant select, insert, update, delete on public.user_roles       to authenticated, service_role;
grant select, insert, update, delete on public.role_permissions to authenticated, service_role;
grant select, insert, update, delete on public.user_permissions to authenticated, service_role;
grant select on public.profiles to anon;  -- anon still never passes RLS

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant select on tables to anon;

-- =============================================================================
-- Seed: role permission defaults (super_admin bypasses, not stored)
-- Pages: dashboard, users, roles  (keep in sync with src/lib/permissions.js)
-- =============================================================================
insert into public.role_permissions (role, page, action, allowed) values
  ('admin','dashboard','view',true),
  ('admin','users','view',true),('admin','users','add',true),('admin','users','edit',true),('admin','users','delete',true),
  ('admin','roles','view',false),('admin','roles','edit',false),
  ('agent','dashboard','view',true),
  ('ops','dashboard','view',true)
on conflict (role, page, action) do nothing;
