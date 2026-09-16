-- Add GPS coordinates + reading_type to vehicle_odometer_logs
-- reading_type lets a driver submit multiple readings on the same day:
--   'daily'   — normal end-of-day reading
--   'backup'  — backup vehicle reading (when driving someone else's car)
--   'closing' — original vehicle closing KM (recorded during a backup day)
--   'return'  — original vehicle reading after it came back the same day

alter table public.vehicle_odometer_logs
  add column if not exists submit_lat   numeric(9,6),
  add column if not exists submit_lng   numeric(9,6),
  add column if not exists reading_type text not null default 'daily'
    check (reading_type in ('daily', 'backup', 'closing', 'return'));

-- replace the per-driver unique index with one that also includes reading_type
drop index if exists public.odometer_vehicle_date_driver_uniq;

create unique index odometer_vehicle_date_driver_type_uniq
  on public.vehicle_odometer_logs (vehicle_id, log_date, recorded_by, reading_type);
