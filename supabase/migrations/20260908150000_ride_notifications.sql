-- =============================================================================
-- FJ Ride Dispatch - ride notifications (WhatsApp / SMS, provider-agnostic)
--
--   Each city has a `notify_webhook_url` (Settings -> Notifications). Pressing
--   "Notify" on a ride calls the `notify-ride` Edge Function, which POSTs a
--   JSON payload (ride details + recipient phones + the rendered message) to
--   that URL. Whatever sits behind the URL (Zapier / Make / a gateway script /
--   the WhatsApp Business API) does the actual sending. Every attempt is
--   logged in `ride_notifications`.
-- =============================================================================

alter table public.cities
  add column if not exists notify_webhook_url text,
  add column if not exists notify_template    text;

create table if not exists public.ride_notifications (
  id          bigint generated always as identity primary key,
  ride_id     uuid not null references public.rides(id) on delete cascade,
  city_id     integer not null references public.cities(id),
  at          timestamptz not null default now(),
  sent_by     uuid references public.profiles(id) on delete set null,
  ok          boolean not null default false,
  recipients  integer not null default 0,
  detail      text
);
create index if not exists ride_notifications_ride_idx on public.ride_notifications (ride_id, at desc);

alter table public.ride_notifications enable row level security;

drop policy if exists rn_select on public.ride_notifications;
create policy rn_select on public.ride_notifications for select to authenticated
  using (private.is_active_user() and private.has_perm('rides', 'view') and private.has_city(city_id));

grant select on public.ride_notifications to authenticated;
grant select, insert on public.ride_notifications to service_role;
