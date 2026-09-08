-- =============================================================================
-- FJ Ride Dispatch - AI Tracker: recorded GPS path per ride
--
--   A scheduled Edge Function (`track-rides`) polls the city fleet tracker
--   link every ~10s while a ride is active and appends a point here. The Ride
--   View then plays the ACTUAL path back against the planned route_geometry.
--   Points older than 45 days are purged daily.
-- =============================================================================

create table if not exists public.ride_track_points (
  id       bigint generated always as identity primary key,
  ride_id  uuid not null references public.rides(id) on delete cascade,
  city_id  integer not null references public.cities(id),
  at       timestamptz not null default now(),
  lat      numeric(9, 6) not null,
  lng      numeric(9, 6) not null,
  speed    numeric(6, 2),
  status   text            -- tracker icon_color: green / red / blue / yellow
);
create index if not exists ride_track_points_ride_idx on public.ride_track_points (ride_id, at);
create index if not exists ride_track_points_at_idx   on public.ride_track_points (at);

alter table public.ride_track_points enable row level security;

-- readable by anyone who can view that ride's city (same shape as `rides`);
-- only the Edge Function (service_role) ever writes.
drop policy if exists rtp_select on public.ride_track_points;
create policy rtp_select on public.ride_track_points for select to authenticated
  using (private.is_active_user() and private.has_perm('rides', 'view') and private.has_city(city_id));

grant select on public.ride_track_points to authenticated;
grant select, insert, delete on public.ride_track_points to service_role;

-- daily cleanup
create or replace function private.purge_old_track_points()
returns void language sql security definer set search_path = public as $$
  delete from public.ride_track_points where at < now() - interval '45 days';
$$;
revoke execute on function private.purge_old_track_points() from public, anon, authenticated;
