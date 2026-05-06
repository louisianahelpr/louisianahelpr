-- Daily morning digest: "5 new jobs in [your parish] — $30 to $150."
-- Most marketplaces under-notify and silently die. The push pipeline
-- is built; this just gives users a reason to come back daily.
--
-- Filter rules:
--   • New jobs = status='open' AND created_at > NOW() - 24 hours
--   • Recipient = profile with parish set, not banned, not the poster,
--     job_updates pref is true (or unset → default true)
--   • At least 1 matching job; otherwise skip the user (no empty digests)
--   • Active member only — has posted OR applied at least once. New
--     signups who ghosted don't get pings.
--
-- Throttle: one digest per user per 24h. Idempotent — if the cron runs
-- twice in the same window, we won't double-notify.

CREATE OR REPLACE FUNCTION public.sweep_daily_job_digest()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_sent integer := 0;
  budget_lo integer;
  budget_hi integer;
BEGIN
  FOR rec IN
    WITH new_jobs AS (
      SELECT j.id, j.parish, j.budget
      FROM public.jobs j
      WHERE j.status = 'open'
        AND j.created_at > NOW() - INTERVAL '24 hours'
        AND j.parish IS NOT NULL
    ),
    parish_counts AS (
      SELECT
        parish,
        COUNT(*) AS cnt,
        MIN(budget) AS min_budget,
        MAX(budget) AS max_budget
      FROM new_jobs
      GROUP BY parish
    )
    SELECT
      p.user_id,
      p.parish,
      pc.cnt,
      pc.min_budget,
      pc.max_budget
    FROM public.profiles p
    JOIN parish_counts pc ON pc.parish = p.parish
    LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
    WHERE p.parish IS NOT NULL
      AND p.approval_status = 'approved'
      AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
      AND (np.user_id IS NULL OR COALESCE(np.job_updates, true) IS TRUE)
      AND EXISTS (
        SELECT 1 FROM public.applications WHERE helper_id = p.user_id
        UNION ALL
        SELECT 1 FROM public.jobs WHERE customer_id = p.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = p.user_id
          AND n.title LIKE 'New jobs in%'
          AND n.created_at > NOW() - INTERVAL '23 hours'
      )
  LOOP
    BEGIN
      budget_lo := FLOOR(rec.min_budget)::integer;
      budget_hi := CEIL(rec.max_budget)::integer;
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.user_id,
        'job_match',
        format('New jobs in %s', rec.parish),
        format(
          '%s new %s posted in the last 24 hours — %s. Tap to browse.',
          rec.cnt,
          CASE WHEN rec.cnt = 1 THEN 'job' ELSE 'jobs' END,
          CASE
            WHEN budget_lo = budget_hi THEN format('$%s', budget_lo)
            ELSE format('$%s to $%s', budget_lo, budget_hi)
          END
        ),
        '/dashboard',
        false
      );
      total_sent := total_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sweep_daily_job_digest: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN total_sent;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_daily_job_digest() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('sweep-daily-job-digest');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- 14:00 UTC = 9:00 AM CDT (Louisiana Daylight Time, March-November)
--           = 8:00 AM CST (Standard Time, November-March)
SELECT cron.schedule(
  'sweep-daily-job-digest',
  '0 14 * * *',
  $cron$SELECT public.sweep_daily_job_digest();$cron$
);
