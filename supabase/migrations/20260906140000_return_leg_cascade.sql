-- =============================================================================
-- FJ Ride Dispatch - deleting a ride also deletes its return leg
--
--   `return_of_ride_id` was `on delete set null`: deleting the original
--   dropoff ride left its auto-created return leg orphaned but still very
--   much alive - still holding the vehicle's EXCLUDE-constrained time
--   window, so the vehicle kept showing "busy at that time on another ride"
--   even though the ride the dispatcher deleted was gone. A return leg only
--   exists because of its parent, so it should go when the parent goes.
-- =============================================================================

alter table public.rides
  drop constraint if exists rides_return_of_ride_id_fkey,
  add constraint rides_return_of_ride_id_fkey
    foreign key (return_of_ride_id) references public.rides(id) on delete cascade;
