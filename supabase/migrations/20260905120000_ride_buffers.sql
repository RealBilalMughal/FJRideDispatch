-- =============================================================================
-- FJ Ride Dispatch - per-city check-in / check-out buffer minutes
--
--   Pickup:  Pickup Time = Check-in (Actual if set, else scheduled)
--                          - checkin_buffer_min - drive time
--   Dropoff: Drop Time   = Check-out (Actual if set, else scheduled)
--                          + checkout_buffer_min
--   Each city keeps its own buffer, alongside its existing airport_* settings.
--   Defaults match the values that were previously hardcoded in Rides.jsx
--   (90-min airport-arrival buffer, 30-min turnaround).
-- =============================================================================

alter table public.cities
  add column if not exists checkin_buffer_min  integer not null default 90,
  add column if not exists checkout_buffer_min integer not null default 30;
