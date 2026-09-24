-- Optional backup vehicle number on a ride (manually typed, non-fleet)
alter table public.rides
  add column if not exists backup_vehicle_no text;
