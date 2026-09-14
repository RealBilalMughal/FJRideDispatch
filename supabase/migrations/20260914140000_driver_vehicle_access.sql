-- drivers can read active vehicles so the odometer form can populate the dropdown
create policy "vehicles_driver_read"
  on public.vehicles for select
  to authenticated
  using (
    is_active = true
    and private.is_driver()
  );

-- drivers can read the drivers table row that matches their own profile phone
-- (used to auto-select the vehicle assigned to them)
create policy "drivers_driver_read_own"
  on public.drivers for select
  to authenticated
  using (
    private.is_driver()
    and contact = (select phone from public.profiles where id = auth.uid())
  );
