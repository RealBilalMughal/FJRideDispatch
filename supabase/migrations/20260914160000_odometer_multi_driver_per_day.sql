-- Allow multiple drivers to log the same vehicle on the same day
-- (e.g. a backup vehicle used by two drivers in one day)
drop index if exists public.odometer_vehicle_date_uniq;

create unique index odometer_vehicle_date_driver_uniq
  on public.vehicle_odometer_logs (vehicle_id, log_date, recorded_by);
