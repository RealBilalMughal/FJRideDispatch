-- FJ KM: manually entered or ORS-auto KM per plan row (Fly Jinnah billing reference)
alter table public.ride_plan_rows
  add column if not exists fj_km numeric;
