-- =============================================================================
-- FJ Ride Dispatch - Ride: dispatch on an ad-hoc (rented, not-in-fleet) vehicle
--
--   When every fleet vehicle is busy, a dispatcher sometimes has to bring in
--   an extra rented car for a ride. That car isn't a real `vehicles` row (it
--   won't be reused, doesn't have a permanent driver, and it isn't a fleet
--   asset to schedule against) - so it's captured as plain text ON THE RIDE
--   itself, with `vehicle_id`/`driver_id` left null, rather than as a fake
--   permanent Vehicles entry. Deliberately excluded from the Vehicle Board
--   (which is keyed entirely off `vehicle_id`).
-- =============================================================================

alter table public.rides
  add column if not exists is_adhoc_vehicle boolean not null default false,
  add column if not exists adhoc_vehicle_no text,
  add column if not exists adhoc_driver_name text,
  add column if not exists adhoc_driver_phone text;
