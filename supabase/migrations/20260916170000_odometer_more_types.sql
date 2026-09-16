-- Expand reading_type to support breakdown/backup/return flow
-- Old types: daily, backup, closing, return
-- New types: daily, closing, backup_start, backup_end, return_start, return_end

alter table public.vehicle_odometer_logs
  drop constraint if exists vehicle_odometer_logs_reading_type_check;

-- migrate old type names (in case any rows exist)
update public.vehicle_odometer_logs set reading_type = 'backup_start' where reading_type = 'backup';
update public.vehicle_odometer_logs set reading_type = 'return_start' where reading_type = 'return';

alter table public.vehicle_odometer_logs
  add constraint vehicle_odometer_logs_reading_type_check
  check (reading_type in ('daily', 'closing', 'backup_start', 'backup_end', 'return_start', 'return_end'));
