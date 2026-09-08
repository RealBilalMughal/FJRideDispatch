-- =============================================================================
-- FJ Ride Dispatch - per-block extra KM (Pickup / Drop Off)
--
--   A Pickup or Drop Off ride adds a flat extra distance to its road KM
--   (e.g. +3 km each), configured per city at Settings -> Ride Buffer Time.
--   The extra folds into rides.distance_km at save (so the KM column, CSV
--   export, Dashboard KM sums and the Rides Summary all reflect the total),
--   and rides.extra_km keeps the amount that was added so the ride View can
--   show "road km + extra = total".
-- =============================================================================

alter table public.cities
  add column if not exists pickup_extra_km  numeric(6, 2) not null default 0,
  add column if not exists dropoff_extra_km numeric(6, 2) not null default 0;

alter table public.rides
  add column if not exists extra_km numeric(6, 2) not null default 0;
