-- =============================================================================
-- FJ Ride Dispatch - Duty Sheet date
--
--   A night-shift ride is physically dispatched and happens on its own
--   ride_date, but for roster/duty-sheet bookkeeping a night duty is counted
--   against the day it STARTED, not the calendar day the ride happened to
--   land on. duty_sheet_date defaults to ride_date; when Night is picked in
--   the Ride form, the dispatcher can tick "previous day" to set it to
--   ride_date - 1 instead (e.g. ride_date 5 Sep -> duty_sheet_date 4 Sep).
--   Nullable so existing rows (no concept of this before) fall back to their
--   own ride_date on display, rather than backfilling a guess.
-- =============================================================================

alter table public.rides
  add column if not exists duty_sheet_date date;
