-- The daily digest email counts FIXTURE JOBS, and on launch day that is all it
-- would count.
--
-- `sweep_daily_job_digest` selects open jobs created in the last 24 hours,
-- groups them by parish, and emails each user "N new jobs in <parish>, budgets
-- $X-$Y". It never consulted `seed_jobs_hidden_publicly()` and never referenced
-- `is_seed` at all — verified against prod, `calls_gate = false`,
-- `refs_is_seed = false`.
--
-- WHY THAT MATTERS RIGHT NOW, measured against prod:
--
--     open jobs with a parish, is_seed = true    9
--     open jobs with a parish, is_seed = false   0
--
-- Every job this digest can currently see is a fixture. So the moment the
-- launch switch is flipped and `seed_jobs_hidden_publicly()` returns true,
-- every browse surface goes quiet — /jobs, the dashboard list, the map, the
-- landing teaser, saved-search alerts, the new-job push — and this email keeps
-- telling real users there are jobs in their parish that they cannot find
-- anywhere in the app. That is exactly the failure the surface registry exists
-- to prevent, arriving on the one day it is guaranteed to be noticed.
--
-- ─── HOW IT WAS FOUND, which is the reusable part ──────────────────────────
--
-- Not by me. Two independent repairs of the seed-flag guard were written
-- tonight — the guard used to discover surfaces by NAME
-- (`public.*open_jobs*`), which is a convention masquerading as a definition.
--
--   · Mine asked the REVERSE question: what CALLS the gate, and is all of it
--     registered? Decidable with zero false positives, and it found a genuine
--     registry gap (`notify_helpers_on_job_post`, 20260903...). But it is
--     structurally blind to THIS bug, because a surface that never calls the
--     gate is invisible to a check that starts from callers of the gate.
--   · The silent-failure lane asked the FORWARD question behaviourally: what
--     SELECTS open jobs? I had prototyped that predicate, measured it at 13
--     candidates and zero of the four real browse surfaces, and set it aside as
--     strictly worse. I was wrong about what it was for. It is noisy as a
--     discovery mechanism and it is the only one of the two that can see a
--     feed which never had a gate to begin with.
--
-- Both checks are now in the parity suite, and neither is redundant: one finds
-- gated surfaces missing from the registry, the other finds registry-shaped
-- surfaces missing the gate. This migration is the second kind, and I would not
-- have found it.

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
        -- THE SEED GATE. Added 20260903081713; see the migration header.
        AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
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
      PERFORM public.log_cron_defect(
        'sweep_daily_job_digest', rec.user_id::text, SQLERRM,
        jsonb_build_object('user_id', rec.user_id, 'parish', rec.parish));
      RAISE NOTICE 'sweep_daily_job_digest: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN total_sent;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_daily_job_digest', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'sent_before_failure', total_sent));
  RETURN total_sent;
END;
$$;
COMMENT ON FUNCTION public.sweep_daily_job_digest() IS
  'Daily per-parish digest of jobs opened in the last 24h. SEED-GATED as of '
  '20260903081713: it counted fixture jobs, and at the time of writing every '
  'open job with a parish was a fixture (9 of 9), so flipping the launch switch '
  'would have silenced every browse surface while this email kept advertising '
  'jobs nobody could find. Registered in SEED_GATED_SURFACES.';
