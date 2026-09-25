-- Off-mode reporting columns on ride_plan_rows
alter table public.ride_plan_rows
  add column if not exists actual_crew_names  text,
  add column if not exists actual_vehicle_no  text,
  add column if not exists actual_km          numeric(8,2),
  add column if not exists report_reason      text,
  add column if not exists report_remarks     text,
  add column if not exists reported_by_name   text,
  add column if not exists reported_at        timestamptz;
