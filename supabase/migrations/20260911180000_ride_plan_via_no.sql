-- =============================================================================
-- FJ Ride Dispatch - Ride Plan: track a followed row that came via "No"
--
--   "No" on a pending row still opens the normal Add Ride flow (same as
--   Follow) - a dispatcher clicking it usually means "dispatch it anyway,
--   just not per the plan", not "there's no ride". `via_no` flags that so
--   the Status column can show "No Follow" instead of plain "Followed".
-- =============================================================================

alter table public.ride_plan_rows add column if not exists via_no boolean not null default false;
