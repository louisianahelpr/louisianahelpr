-- Track whether the "please confirm payment" push has been sent to the poster
-- after the helper marks the job complete.
--
-- NULL  = never sent (initial state; the cron filter uses IS NULL so
--          rows with no value are caught on the first eligible sweep).
-- true  = notification was sent; the cron skips this row.
--
-- We intentionally don't store false — NULL and false would be equivalent
-- for our filter, but IS NULL is the idiomatic Postgres way to express
-- "not yet set" and avoids needing a default value on the column.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS payment_confirm_notif_sent boolean;

-- Partial index covering only the rows the cron needs to scan:
-- jobs in escrow where the helper has marked complete and we haven't yet
-- sent the 24h confirmation reminder.  The cron adds a date-range filter
-- on helper_completed_at on top, which Postgres can satisfy with a range
-- scan on this index.
CREATE INDEX IF NOT EXISTS jobs_payment_confirm_idx
  ON public.jobs (helper_completed_at, payment_confirm_notif_sent)
  WHERE status IN ('in_progress', 'revision_requested')
    AND payment_status = 'escrow'
    AND payment_confirm_notif_sent IS NULL;

-- Schedule the payment-confirm-reminder edge function once daily at 15:00 UTC
-- (10:00 AM Central) — offset from expiring-jobs-push (14:00 UTC) so the two
-- cron jobs don't compete for DB connections at the same instant.
--
-- The cron calls the edge function via net.http_post using the vault-stored
-- Supabase URL and service_role key — the same pattern used by
-- expiring-jobs-push (see 20260612420000_expiring_notif_flag.sql).
--
-- Replay-safe: the DO block silently drops the job if it already exists
-- before re-creating it, so running this migration twice doesn't error.

DO $$
BEGIN
  PERFORM cron.unschedule('payment-confirm-reminder');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'payment-confirm-reminder',
  '0 15 * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/payment-confirm-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := '{}'::jsonb
    );
  $cron$
);
