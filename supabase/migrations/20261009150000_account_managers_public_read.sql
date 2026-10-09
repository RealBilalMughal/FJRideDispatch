-- Allow anonymous users to read account_managers (needed for public driver profile JOIN)
create policy "am_select_public"
  on public.account_managers for select
  using (true);
