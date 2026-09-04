-- =============================================================================
-- FJ Ride Dispatch - per-city Deadhead buffer minutes
--
--   Deadhead Ride Time = the parent dropoff ride's own ETA (arrival at the
--   crew stop it dropped off at) + this city's Deadhead buffer - same
--   formula as the Return Leg buffer, just for the "Create Ride" ->
--   Deadhead option (vehicle repositions from that stop to a different
--   crew's stop, with no drop-off in between).
-- =============================================================================

alter table public.cities
  add column if not exists deadhead_buffer_min integer not null default 15;
