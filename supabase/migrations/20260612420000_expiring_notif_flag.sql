-- Track whether the "expiring soon" push has been sent for each job.
--
-- NULL  = never sent (initial state; the cron filter uses IS NULL so
--          rows with no value are caught on the first eligible sweep).
-- true  = notification was sent; the cron skips this row.
--
-- We intentionally don't store false — NULL and false would be equivalent
-- for our filter, but IS NULL is the idiomatic Postgres way to express
-- "not yet set" and avoids needing a default value on the column.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS expiring_notif_sent boolean;

-- Partial index covering only the rows the cron needs to scan: open jobs
-- with no helper and no notification sent yet, ordered by expiry. The
-- cron adds a .gt('expires_at', now) + .lte('expires_at', in24h) filter
-- on top, which Postgres can satisfy with a range scan on this index.
CREATE INDEX IF NOT EXISTS jobs_expiring_notif_idx
  ON public.jobs (expires_at, expiring_notif_sent)
  WHERE status = 'open'
    AND helper_id IS NULL
    AND expiring_notif_sent IS NULL;

-- Schedule the expiring-jobs-push edge function once daily at 14:00 UTC
-- (9:00 AM Central) so posters get the warning during business hours.
--
-- The cron calls the edge function via net.http_post using the vault-stored
-- Supabase URL and service_role key — the same pattern used by other cron-
-- invoked edge functions in this project (see 20260505171500_triggers_read_from_vault.sql).
--
-- Replay-safe: the DO block silently drops the job if it already exists
-- before re-creating it, so running this migration twice doesn't error.

DO $$
BEGIN
  PERFORM cron.unschedule('expiring-jobs-push');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'expiring-jobs-push',
  '0 14 * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/expiring-jobs-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := '{}'::jsonb
    );
  $cron$
);
