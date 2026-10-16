-- Airport KM: road distance from city airport to this crew member's stop
alter table public.crew
  add column if not exists airport_km numeric;
