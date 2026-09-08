-- =============================================================================
-- FJ Ride Dispatch - AI Tracker: schedule the poll + the daily purge
--
--   Runs the `track-rides` Edge Function once a minute (the function itself
--   loops ~6x with a 10s gap, so ~1 sample / 10s per active ride) and purges
--   points > 45 days old every night.
--
--   ONE-TIME SETUP (not in the repo - secrets):
--     1. Deploy the function:
--          supabase functions deploy track-rides --no-verify-jwt --use-api
--     2. Give the function a shared key:
--          supabase secrets set TRACK_CRON_KEY=<random-string>
--     3. Store the SAME key in the DB vault so cron can send it:
--          select vault.create_secret('<random-string>', 'track_cron_key');
--        (re-run as update: select vault.update_secret(id, '<new>') )
--   Until step 3 is done the cron call just gets a 401 and logs nothing -
--   harmless. `select cron.unschedule('track-rides-poll')` to stop it.
-- =============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- project ref is public (it's in every API URL); the key is pulled from vault.
do $$
declare
  fn_url text := 'https://dyjgrxeqdvnxwcbwzkql.supabase.co/functions/v1/track-rides';
begin
  perform cron.unschedule('track-rides-poll') where exists (
    select 1 from cron.job where jobname = 'track-rides-poll'
  );
  perform cron.unschedule('track-rides-purge') where exists (
    select 1 from cron.job where jobname = 'track-rides-purge'
  );

  perform cron.schedule('track-rides-poll', '* * * * *', format($f$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-track-cron-key', coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'track_cron_key'), '')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 70000
    );
  $f$, fn_url));

  perform cron.schedule('track-rides-purge', '30 3 * * *',
    'select private.purge_old_track_points();');
end $$;
