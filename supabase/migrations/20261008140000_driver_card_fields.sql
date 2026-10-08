-- Driver ID card fields: photo, CNIC, account, designation, card dates,
-- emergency contact, account manager details.

alter table public.drivers
  add column if not exists photo_path        text,
  add column if not exists cnic_no           text,
  add column if not exists account           text,
  add column if not exists designation       text default 'Driver',
  add column if not exists card_issue_date   date,
  add column if not exists card_valid_until  date,
  add column if not exists note              text,
  add column if not exists emergency_contact text,
  add column if not exists manager_name      text,
  add column if not exists manager_designation text,
  add column if not exists manager_email     text,
  add column if not exists manager_contact   text;

-- Storage: allow photos in the existing driver-docs bucket (stored under photos/ prefix)
-- The bucket was already created with public read in the previous migration.
