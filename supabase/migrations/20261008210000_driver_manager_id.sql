-- Replace free-text manager columns with a proper FK to account_managers.
alter table public.drivers
  add column if not exists manager_id uuid references public.account_managers(id) on delete set null;
