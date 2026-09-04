-- =============================================================================
-- FJ Ride Dispatch - per-city Return Leg buffer minutes
--
--   Return Leg Ride Time = (arrival at the drop-off stop, i.e. the original
--   dropoff ride's ETA = start_at + duration_min) + return_leg_buffer_min.
--   Each city keeps its own buffer, alongside checkin/checkout_buffer_min.
-- =============================================================================

alter table public.cities
  add column if not exists return_leg_buffer_min integer not null default 10;
