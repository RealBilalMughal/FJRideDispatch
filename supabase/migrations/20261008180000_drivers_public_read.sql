-- Allow unauthenticated reads on drivers so the public profile page (/d/:refNo)
-- can fetch driver details without auth. The app already gates display via qr_active.
create policy "drivers_select_public"
  on public.drivers
  for select
  using (true);
