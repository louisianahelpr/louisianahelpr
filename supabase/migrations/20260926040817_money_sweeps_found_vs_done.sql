-- CJ-007 follow-up (docs/OPEN.md Q434 (c)): the money SQL sweeps report what
-- they FOUND and what they DID, so "found some, did none" pages.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- 20260925231818 made every SQL cron record its result, but these two
-- returned one number (what they did), so they were registered 'exempt': a
-- run that found candidates and dealt with none looked exactly like a quiet
-- run. Of the SQL crons, these are the two whose loop touches money state:
--   sweep_release_last_chance  the last warning to a poster before escrow
--                              auto-releases (jobs.payment_status = 'escrow').
--                              Each failed send goes to log_cron_defect, but
--                              that is capped hourly, and "all failed" read as 0.
--   detect_stuck_payments      checkouts started and never settled by the
--                              Stripe webhook. A job that raised inside the loop
--                              went to RAISE NOTICE only, which nothing reads,
--                              and the run returned how many it flagged: every
--                              stuck job failing to alert returned 0, the same
--                              as "nothing stuck".
-- reap_stranded_instant_payouts is NOT split: it reaps with one
-- UPDATE ... RETURNING, so what it found and what it did are the same rows by
-- construction, and a failure raises (pg_cron records it; sweep_dead_crons
-- files 'erroring'). Its 'exempt' entry stays.
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────
-- Both functions keep their bodies exactly (effective definitions:
-- 20260924220318 and 20260923052520, no later rewrite) and now count each
-- row the scan returned ('found') and what became of it, returning jsonb.
-- The cron commands are unchanged: cron_record_work(job, to_jsonb(fn()))
-- records a jsonb result as-is. A return type cannot change under CREATE OR
-- REPLACE, so each is dropped and recreated with its grants.
--   sweep_release_last_chance -> {found, pushed, failed} (+ scan_failed on the
--     outer handler). Disposition: pushed. failed is NOT a disposition: a
--     notification that did not go out is the defect.
--   detect_stuck_payments -> {found, flagged, alerted, already_alerted,
--     seed_logged, seed_already_logged, failed}. flagged keeps its old
--     meaning (alerted + seed_logged). The two dedupe skips were
--     `CONTINUE WHEN EXISTS`; they are now counted, because a stuck job
--     already alerted today IS dealt with. Dispositions: alerted,
--     already_alerted, seed_logged, seed_already_logged. failed is not one.
--     Because a job already handled stays in the 24h scan and counts as a
--     disposition on every run, the rule below pages only when EVERY scanned
--     row fails. A PARTIAL failure is caught by the per-row handler instead,
--     which now files each failed row through log_cron_defect (source
--     detect_stuck_payments, or detect_stuck_payments-seed for a seed job)
--     rather than RAISE NOTICE alone (review of this migration: on
--     2026-09-26 prod had 3 seed stuck jobs already logged sitting in the
--     window, which would have hidden any real failure from the rule alone).
--   sweep_release_last_chance's outer handler rolls the whole run back, so it
--     reports pushed 0 (the old pushed_before_failure counted warnings that no
--     longer existed).
-- cron_work_expectations: both get a candidate rule (min_streak 2, the table
-- default) and work_visibility 'candidates'; sweep_silent_cron_failures' 3b
-- then pages on two consecutive runs that found rows and dispositioned none.
--
-- Replay-safe: DROP ... IF EXISTS + CREATE, ON CONFLICT upserts, an UPDATE.
-- Grants: FROM PUBLIC, anon, authenticated; service_role only.

-- ── 1. sweep_release_last_chance ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.sweep_release_last_chance();
CREATE FUNCTION public.sweep_release_last_chance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  v_found      integer := 0;
  v_failed     integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id
      FROM public.jobs j
     WHERE j.release_last_chance_notif_sent_at IS NULL
       AND j.status = 'in_progress'
       AND j.payment_status = 'escrow'
       AND j.poster_completed_at IS NULL
       AND j.revision_requested_at IS NULL
       AND j.helper_completed_at IS NOT NULL
       -- inside the final 2 hours of the 24h window
       AND j.helper_completed_at <= NOW() - INTERVAL '22 hours'
       AND j.helper_completed_at >  NOW() - INTERVAL '24 hours'
     ORDER BY j.helper_completed_at
     LIMIT 100
  LOOP
    v_found := v_found + 1;
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (
        rec.customer_id,
        'warning',
        'Last chance to review',
        format('"%s" auto-releases payment in about 2 hours. Approve it, or request a revision now if something''s wrong.', rec.title),
        '/posts?job=' || rec.id::text,
        false,
        rec.id
      );
      UPDATE public.jobs SET release_last_chance_notif_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      PERFORM public.log_cron_defect(
        'sweep_release_last_chance', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'sweep_release_last_chance: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('found', v_found, 'pushed', total_pushed, 'failed', v_failed);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_release_last_chance', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  -- The outer handler rolled back every warning this run wrote, so none were
  -- pushed, whatever total_pushed counted before the failure.
  RETURN jsonb_build_object('found', v_found, 'pushed', 0, 'failed', v_failed, 'scan_failed', 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_release_last_chance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_release_last_chance() TO service_role;

-- ── 2. detect_stuck_payments ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.detect_stuck_payments();
CREATE FUNCTION public.detect_stuck_payments()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  flagged integer := 0;
  user_label text;
  v_found               integer := 0;
  v_alerted             integer := 0;
  v_already_alerted     integer := 0;
  v_seed_logged         integer := 0;
  v_seed_already_logged integer := 0;
  v_failed              integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.stripe_session_id, j.created_at,
           -- A seed job, or any job a seed/test account posted.
           coalesce(j.is_seed OR sp.is_seed, false) AS seed
    FROM public.jobs j
    LEFT JOIN public.profiles sp ON sp.user_id = j.customer_id
    WHERE j.stripe_session_id IS NOT NULL
      AND j.payment_status = 'unpaid'
      AND j.created_at < NOW() - INTERVAL '10 minutes'
      AND j.created_at > NOW() - INTERVAL '24 hours'
      -- A job cancelled with its checkout still open is unwound by
      -- void-cancelled-payments (hourly, :10): it expires the session and
      -- marks the job 'abandoned'. Give it two runs before this counts.
      AND NOT (j.status = 'cancelled'
               AND coalesce(j.cancelled_at, j.updated_at) > NOW() - INTERVAL '2 hours')
    LIMIT 50
  LOOP
    v_found := v_found + 1;
    BEGIN
      IF rec.seed THEN
        -- Seed/E2E job: one digest row per job per day, no admin notification,
        -- no page. error_log_is_seed() keeps it out of Slack and the ledger.
        IF EXISTS (
          SELECT 1 FROM public.error_logs e
           WHERE jsonb_typeof(e.tags) = 'object'
             AND e.tags ->> 'source' = 'detect_stuck_payments-seed'
             AND e.tags ->> 'job_id' = rec.id::text
             AND e.created_at > NOW() - INTERVAL '24 hours') THEN
          v_seed_already_logged := v_seed_already_logged + 1;
          CONTINUE;
        END IF;
        INSERT INTO public.error_logs (severity, message, url, tags, context)
        VALUES (
          'info',
          'Stuck payment on a seed/E2E job — checkout started, never settled',
          format('/admin?view=jobs&job=%s', rec.id),
          jsonb_build_object('source', 'detect_stuck_payments-seed', 'seed', true, 'job_id', rec.id::text),
          jsonb_build_object('job_id', rec.id, 'stripe_session_id', rec.stripe_session_id,
                             'customer_id', rec.customer_id, 'created_at', rec.created_at));
        flagged := flagged + 1;
        v_seed_logged := v_seed_logged + 1;
        CONTINUE;
      END IF;

      -- Real job: unchanged — admin notification (deduped per poster per day)
      -- and a critical-source error_logs row that pages.
      IF EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.type = 'system_alert'
          AND n.title = 'Stuck payment — webhook may be failing'
          AND n.link = format('/admin?view=people&user=%s', rec.customer_id)
          AND n.created_at > NOW() - INTERVAL '24 hours') THEN
        v_already_alerted := v_already_alerted + 1;
        CONTINUE;
      END IF;

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
        format('/admin?view=jobs&job=%s', rec.id),
        jsonb_build_object('source', 'detect_stuck_payments', 'job_id', rec.id::text),
        jsonb_build_object(
          'job_id', rec.id,
          'stripe_session_id', rec.stripe_session_id,
          'customer_id', rec.customer_id,
          'created_at', rec.created_at
        )
      );

      flagged := flagged + 1;
      v_alerted := v_alerted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      -- Filed per row (review of this migration): a job that could not be
      -- alerted used to reach RAISE NOTICE only. A seed job's failure goes to
      -- the '-seed' source, which error_log_is_seed keeps out of Slack and the
      -- ledger, same as the seed path above.
      PERFORM public.log_cron_defect(
        CASE WHEN rec.seed THEN 'detect_stuck_payments-seed' ELSE 'detect_stuck_payments' END,
        rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id, 'seed', rec.seed));
      RAISE NOTICE 'detect_stuck_payments: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('found', v_found, 'flagged', flagged,
                            'alerted', v_alerted, 'already_alerted', v_already_alerted,
                            'seed_logged', v_seed_logged, 'seed_already_logged', v_seed_already_logged,
                            'failed', v_failed);
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_stuck_payments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_stuck_payments() TO service_role;

-- ── 3. the found-vs-done rules and the register ─────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.cron_work_expectations (jobname, candidate_key, disposition_keys, min_streak, note)
  VALUES
    ('sweep-release-last-chance', 'found', ARRAY['pushed'], 2,
     'Escrow jobs in their final 2 hours before auto-release, found vs warned. found>0 with pushed=0 twice running means posters are losing their last chance to object before money moves. failed counts the ones that raised (also in log_cron_defect).'),
    ('detect-stuck-payments', 'found', ARRAY['alerted', 'already_alerted', 'seed_logged', 'seed_already_logged'], 2,
     'Checkouts never settled by the Stripe webhook, found vs alerted (or already alerted today, or a seed job logged). found>0 with none of those twice running means every stuck job raised inside the loop. A partial failure is filed per row through log_cron_defect instead (it used to go to RAISE NOTICE only).')
  ON CONFLICT (jobname) DO UPDATE
    SET candidate_key    = EXCLUDED.candidate_key,
        disposition_keys = EXCLUDED.disposition_keys,
        min_streak       = EXCLUDED.min_streak,
        note             = EXCLUDED.note;

  UPDATE public.cron_work_expectations c
     SET work_visibility    = v.work_visibility,
         max_idle           = v.max_idle,
         work_keys          = v.work_keys,
         work_exempt_reason = v.work_exempt_reason
    FROM (VALUES
      ('sweep-release-last-chance', NULL::interval, NULL::text[], 'candidates', NULL::text),
      ('detect-stuck-payments',     NULL,           NULL,         'candidates', NULL)
    ) AS v(jobname, max_idle, work_keys, work_visibility, work_exempt_reason)
   WHERE c.jobname = v.jobname;
END
$do$;
