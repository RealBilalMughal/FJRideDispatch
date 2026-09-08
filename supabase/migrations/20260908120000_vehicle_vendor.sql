-- =============================================================================
-- FJ Ride Dispatch - vehicle vendor
--
--   A vehicle can belong to a vendor (the same vendor pool drivers use).
--   Optional (nullable) - existing vehicles keep no vendor until edited.
--   on delete set null so removing a vendor doesn't block, unlike drivers
--   (drivers.vendor_id is not-null / on delete restrict).
-- =============================================================================

alter table public.vehicles
  add column if not exists vendor_id uuid references public.vendors(id) on delete set null;

create index if not exists vehicles_vendor_idx on public.vehicles (vendor_id);
