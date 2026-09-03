-- =============================================================================
-- FJ Ride Dispatch - flights: block type + flight time
--
--   block_type   deadhead | pickup | dropoff | return_leg
--   flight_time  time of day (HH:MM). The UI labels it "Check in time" when the
--                block is Pickup, "Check out time" when Drop Off, else "Flight time".
-- =============================================================================

alter table public.flights
  add column if not exists block_type  text,
  add column if not exists flight_time time;

do $$ begin
  alter table public.flights
    add constraint flights_block_type_chk
    check (block_type is null or block_type in ('deadhead', 'pickup', 'dropoff', 'return_leg'));
exception when duplicate_object then null; end $$;
