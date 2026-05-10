-- Extend detect_suspicious_user_patterns with a rapid-cancellation
-- detector. Pattern: 5+ jobs cancelled within 2 hours of posting in
-- the last 7 days = strong "testing the platform / spam" signal.
-- Genuine users post and wait; fraudsters churn through posts.
--
-- Reuses fraud_flags table and the existing daily cron.

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
  -- Pattern 1: burst job posting (10+ jobs in 24h)
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

  -- Pattern 2: multi-reporter pile-on (3+ distinct reporters in 30d)
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

  -- Pattern 3: rapid cancellation. 5+ jobs cancelled within 2h of being
  -- posted in the last 7 days. Genuine posters wait for helpers;
  -- fraudsters churn-test.
  FOR rec IN
    SELECT customer_id AS user_id, COUNT(*) AS rapid_cancel_count
    FROM public.jobs
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND customer_id IS NOT NULL
      AND status = 'cancelled'
      AND cancelled_at IS NOT NULL
      AND cancelled_at - created_at < INTERVAL '2 hours'
    GROUP BY customer_id
    HAVING COUNT(*) >= 5
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.fraud_flags ff
      WHERE ff.user_id = rec.user_id
        AND ff.flag_type = 'rapid_cancellation_pattern'
        AND ff.resolved = false
    ) THEN
      INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
      VALUES (
        rec.user_id,
        'rapid_cancellation_pattern',
        format('Cancelled %s jobs within 2h of posting in the last 7 days (threshold 5). Possible platform churn/test pattern.', rec.rapid_cancel_count),
        false
      );
      flagged := flagged + 1;
    END IF;
  END LOOP;

  RETURN flagged;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_suspicious_user_patterns() FROM PUBLIC, anon, authenticated;
