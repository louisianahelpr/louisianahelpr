-- Suspicious pattern detection — read-only signals into the existing
-- fraud_flags table. Last salvaged idea from job-lifecycle-automations.
-- No state change on profiles, no notifications fired — just a daily
-- sweep that surfaces "this account is acting strange" signals to the
-- AdminFraudDashboard, where humans triage them.
--
-- Two patterns to start (we can add more once we see real signal):
--
-- 1. burst_job_posting: 10+ jobs created by the same user in the last
--    24 hours. Bypasses the standing 5-open-job cap by churning through
--    completed/cancelled jobs to clear the headroom.
--
-- 2. multi_reporter_flag: 3+ distinct reporters have filed reports
--    against the same user in the last 30 days. Pile-on signal,
--    distinct from raw report count (one annoyed neighbor filing 5
--    reports doesn't trip this; 3 unrelated users do).
--
-- Idempotency: skip inserting a flag if an unresolved one of the same
-- flag_type already exists for the user. Daily cron means each pattern
-- becomes a single row until an admin resolves it.

CREATE OR REPLACE FUNCTION public.detect_suspicious_user_patterns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  flagged integer := 0;
  rec RECORD;
BEGIN
  -- Pattern 1: burst job posting
  FOR rec IN
    SELECT customer_id AS user_id, COUNT(*) AS job_count
    FROM public.jobs
    WHERE created_at > NOW() - INTERVAL '24 hours'
      AND customer_id IS NOT NULL
    GROUP BY customer_id
    HAVING COUNT(*) >= 10
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.fraud_flags ff
      WHERE ff.user_id = rec.user_id
        AND ff.flag_type = 'burst_job_posting'
        AND ff.resolved = false
    ) THEN
      INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
      VALUES (
        rec.user_id,
        'burst_job_posting',
        format('Posted %s jobs in the last 24h (threshold 10). Possible bot or spam pattern.', rec.job_count),
        false
      );
      flagged := flagged + 1;
    END IF;
  END LOOP;

  -- Pattern 2: multi-reporter pile-on
  FOR rec IN
    SELECT
      r.reported_id AS user_id,
      COUNT(DISTINCT r.reporter_id) AS distinct_reporters
    FROM public.reports r
    WHERE r.reported_type = 'user'
      AND r.created_at > NOW() - INTERVAL '30 days'
      AND COALESCE(r.status, 'open') NOT IN ('dismissed', 'invalid')
    GROUP BY r.reported_id
    HAVING COUNT(DISTINCT r.reporter_id) >= 3
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.fraud_flags ff
      WHERE ff.user_id = rec.user_id
        AND ff.flag_type = 'multi_reporter_flag'
        AND ff.resolved = false
    ) THEN
      INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
      VALUES (
        rec.user_id,
        'multi_reporter_flag',
        format('Reported by %s distinct reporters in the last 30 days (threshold 3). Pile-on signal.', rec.distinct_reporters),
        false
      );
      flagged := flagged + 1;
    END IF;
  END LOOP;

  RETURN flagged;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_suspicious_user_patterns() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('detect-suspicious-user-patterns');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- Daily at 04:30 UTC (~10:30pm CST). Off-peak so the sweep doesn't
-- contend with daytime traffic.
SELECT cron.schedule(
  'detect-suspicious-user-patterns',
  '30 4 * * *',
  $cron$SELECT public.detect_suspicious_user_patterns();$cron$
);
