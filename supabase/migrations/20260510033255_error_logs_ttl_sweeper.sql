-- error_logs TTL sweeper.
--
-- error_logs has no retention policy. Sentry is the long-term store
-- for application errors; the DB copy is for queryability from
-- AdminHealth + similar surfaces. 90 days is plenty for that purpose
-- and matches the notifications sweeper window.
--
-- Severity-aware retention:
--   - info / warning  → 30 days  (operational noise; the new
--     sweep_old_notifications writes one info row per non-zero day,
--     so without this it'd accumulate forever)
--   - error / fatal   → 90 days  (longer for incident postmortems;
--     Sentry is still the authoritative archive)
--
-- IMPORTANT: this sweeper does NOT log its own activity to error_logs
-- (unlike sweep_old_notifications). Doing so would create a self-
-- feeding loop where the sweeper guarantees a daily row that the next
-- sweeper deletes, just to write a new one. Silent is fine here —
-- success can be verified via row count in AdminHealth.
--
-- Daily cron at 03:45 UTC (15 min after notifications sweeper, no
-- contention).

CREATE OR REPLACE FUNCTION public.sweep_old_error_logs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count integer := 0;
  noisy_deleted integer := 0;
  serious_deleted integer := 0;
BEGIN
  -- info/warning rows older than 30 days
  DELETE FROM public.error_logs
  WHERE severity IN ('info', 'warning')
    AND created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS noisy_deleted = ROW_COUNT;

  -- error/fatal rows older than 90 days
  DELETE FROM public.error_logs
  WHERE severity IN ('error', 'fatal')
    AND created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS serious_deleted = ROW_COUNT;

  deleted_count := noisy_deleted + serious_deleted;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_old_error_logs() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sweep_old_error_logs() IS
'Daily TTL sweep for error_logs. Deletes info/warning >30d and error/fatal >90d. Does NOT log to error_logs itself (would create a self-feeding loop). Returns total rows deleted.';

-- Daily cron at 03:45 UTC = 22:45 CST (15 min after notifications
-- sweeper at 03:30 to avoid IO contention).
DO $$
BEGIN
  PERFORM cron.unschedule('sweep-old-error-logs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sweep-old-error-logs',
  '45 3 * * *',
  $cron$SELECT public.sweep_old_error_logs();$cron$
);
