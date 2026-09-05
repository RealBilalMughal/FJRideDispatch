-- =============================================================================
-- FJ Ride Dispatch - per-crew wait buffer
--
--   When a pickup / dropoff ride visits more than one crew stop, the vehicle
--   waits at each stop after the first for crew to board / alight. That wait
--   is (crewCount - 1) * crew_wait_buffer_min and folds into the ride's
--   duration_min (so ETA, end_at and the Pickup-Time auto-suggest all account
--   for it). Per-city override, edited at Settings -> Ride Buffer Time.
-- =============================================================================

alter table public.cities
  add column if not exists crew_wait_buffer_min integer not null default 5;
