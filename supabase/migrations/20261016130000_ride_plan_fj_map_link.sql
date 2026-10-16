-- Sim vs Actual map link: optional URL stored per plan row for billing reference
alter table public.ride_plan_rows
  add column if not exists fj_map_link text;
