-- Each vehicle keeps its own AI Track sharing link (distinct from
-- cities.tracker_url, which is the fleet-wide/per-city map on the Tracker
-- page) - this one is used to overlay THAT vehicle's live position on its
-- own ride's route in the Ride view (see Rides.jsx's LiveTrackingCard).
alter table public.vehicles add column if not exists tracker_url text;
