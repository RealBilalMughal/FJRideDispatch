-- Live Tracker is per-city, not one global link - each city has its own GPS
-- tracker sharing link (e.g. AI Track), same pattern as cities.airport_* /
-- cities.checkin_buffer_min. Supersedes the app_settings singleton from the
-- previous migration (no real data ever depended on it - it's dropped, not
-- migrated).
alter table public.cities add column if not exists tracker_url text;
drop table if exists public.app_settings;
