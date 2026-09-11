-- =============================================================================
-- FJ Ride Dispatch - crew phone number is the de-dupe key
--
--   A crew CSV import (and the Add/Edit form) now treats `contact` as unique:
--   same phone -> update the existing crew record (e.g. a corrected/fuller
--   name from an external roster), different/blank phone -> a new crew row.
--   Partial index (nulls/blanks excluded) since phone is optional.
-- =============================================================================

create unique index if not exists crew_contact_uniq
  on public.crew (contact)
  where contact is not null and contact <> '';
