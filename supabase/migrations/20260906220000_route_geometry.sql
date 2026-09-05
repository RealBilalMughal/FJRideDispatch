-- Store the ORS road-following route geometry (the same "line" the ride form's
-- own live preview already draws) at creation/edit time, so the read-only View
-- and the Vehicle Board's Map tab can render the real route without calling
-- OpenRouteService again on every view - straight-line waypoints were the only
-- thing persisted before, so anything drawn later had to fall back to straight
-- segments between stops (or re-call the API, burning credits on every open).
alter table public.rides add column if not exists route_geometry jsonb;
