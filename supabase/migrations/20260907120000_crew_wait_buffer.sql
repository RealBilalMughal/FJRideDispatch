-- =============================================================================
-- FJ Ride Dispatch - per-crew wait buffer
--
--   When a pickup / dropoff ride carries more than one crew, the vehicle waits
--   at every crew stop for them to board / alight. That wait is
--   crewCount * crew_wait_buffer_min and folds into the ride's duration_min
--   (so ETA, end_at and the Pickup-Time auto-suggest all account for it).
--   Per-city override, edited at Settings -> Ride Buffer Time.
-- =============================================================================

alter table public.cities
  add column if not exists crew_wait_buffer_min integer not null default 5;
