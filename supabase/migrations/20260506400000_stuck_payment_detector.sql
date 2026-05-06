-- 200-OK-but-noop webhook detector. The COO-flagged failure mode:
-- Stripe checkout completes → returns 200 to caller → our webhook
-- gets the event, returns 200 → BUT something inside the handler
-- fails silently (signing-secret rotation, transient bug, Supabase
-- RLS denial). Job stays with payment_status='unpaid' +
-- stripe_session_id set. Customer paid but the platform thinks it's
-- still unpaid → no helper match, no escrow, support nightmare.
--
-- Detector: any job with stripe_session_id set, created >10 min ago,
-- payment_status still 'unpaid'. Real Stripe checkout completes within
-- seconds; 10 min is a generous buffer for slow webhook delivery.
--
-- Fans an admin notification per stuck job + writes to error_logs for
-- Sentry/PostHog visibility. Idempotent — only fires once per job
-- (skips if a stuck-payment notification already exists in last 24h).

CREATE OR REPLACE FUNCTION public.detect_stuck_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  flagged integer := 0;
  user_label text;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.stripe_session_id, j.created_at
    FROM public.jobs j
    WHERE j.stripe_session_id IS NOT NULL
      AND j.payment_status = 'unpaid'
      AND j.created_at < NOW() - INTERVAL '10 minutes'
      AND j.created_at > NOW() - INTERVAL '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.type = 'system_alert'
          AND n.title = 'Stuck payment — webhook may be failing'
          AND n.link = format('/admin?view=people&user=%s', j.customer_id)
          AND n.created_at > NOW() - INTERVAL '24 hours'
      )
    LIMIT 50
  LOOP
    BEGIN
      SELECT COALESCE(NULLIF(full_name, ''), email, 'A user')
      INTO user_label
      FROM public.profiles
      WHERE user_id = rec.customer_id;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT
        ur.user_id,
        'system_alert',
        'Stuck payment — webhook may be failing',
        format('Job "%s" (%s) by %s was checkout-started %s ago but webhook never settled it. Investigate stripe-webhook logs.',
               rec.title,
               substring(rec.id::text, 1, 8),
               COALESCE(user_label, 'unknown'),
               age(NOW(), rec.created_at)),
        format('/admin?view=people&user=%s', rec.customer_id),
        false
      FROM public.user_roles ur
      WHERE ur.role = 'admin';

      INSERT INTO public.error_logs (severity, message, url, tags, context)
      VALUES (
        'error',
        'Stuck payment detected — webhook noop',
        format('/admin/jobs/%s', rec.id),
        jsonb_build_object('source', 'detect_stuck_payments', 'job_id', rec.id::text),
        jsonb_build_object(
          'job_id', rec.id,
          'stripe_session_id', rec.stripe_session_id,
          'customer_id', rec.customer_id,
          'created_at', rec.created_at
        )
      );

      flagged := flagged + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'detect_stuck_payments: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN flagged;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_stuck_payments() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('detect-stuck-payments');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'detect-stuck-payments',
  '*/15 * * * *',
  $cron$SELECT public.detect_stuck_payments();$cron$
);
