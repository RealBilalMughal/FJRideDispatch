-- =============================================================================
-- FJ Ride Dispatch - Ride Plan rows keep the sheet's own row order
--
--   The plan sheet interleaves Deadhead/Pickup/Dropoff/Return Leg rows in a
--   specific sequence per vehicle that Trip ID alone doesn't reproduce (a
--   plain sort on Trip ID is lexicographic, so "_10" sorts before "_2", and
--   even a numeric sort doesn't match the sheet's actual row order). `seq`
--   is just the CSV row number at import time - the Ride Plan page orders by
--   it so the table reads exactly like the uploaded sheet.
-- =============================================================================

alter table public.ride_plan_rows add column if not exists seq integer not null default 0;
create index if not exists ride_plan_rows_seq_idx on public.ride_plan_rows (plan_date, seq);
