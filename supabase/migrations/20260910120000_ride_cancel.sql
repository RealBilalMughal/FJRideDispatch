-- =============================================================================
-- FJ Ride Dispatch - cancel a ride with a reason
--
--   A cancelled ride keeps its row (audit) but drops out of KM totals -
--   Dashboard, Rides Summary, per-city - UNLESS `count_km` is true (a
--   checkbox on the cancel dialog: "count this ride's KM anyway"). The KM
--   column still shows the ride's own distance; only the SUMS change.
-- =============================================================================

alter table public.rides
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references public.profiles(id) on delete set null,
  add column if not exists count_km      boolean not null default true;
