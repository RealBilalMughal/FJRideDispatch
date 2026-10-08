-- Per-driver Employee ID shown on public profile instead of system ref_no
alter table public.drivers
  add column if not exists employee_id text;
