-- CJ-007: every scheduled job records what it did, and says what "did nothing"
-- means for it.
--
-- MEASURED (prod, 2026-09-25, re-measure on the finding): 61 active crons; the
-- 35 SQL ones (no net.http_post) have never written a cron_run_log row, and
-- cron_work_expectations.candidate_key is NULL on 52 of 61. A SQL cron's
-- command was a bare `SELECT public.fn()`, so the count fn returned was
-- written nowhere: pg_cron's job_run_details says only 'succeeded' / '1 row'.
-- The app could prove these jobs FIRED and could not tell whether they DID
-- anything. (Not re-measured by this change: this session had no prod SQL
-- access. The inventory below is the repo's own, which is what the guard reads.)
--
-- What this does:
--   1. cron_run_log takes SQL runs too: response_id is NULL for a row a SQL
--      cron recorded itself (HTTP rows keep their pg_net id).
--   2. public.cron_record_work(job, result) writes that row. Every SQL cron's
--      command becomes `SELECT public.cron_record_work('<job>', to_jsonb(public.<fn>()));`
--      via cron.alter_job, so each job keeps its LIVE schedule (several were
--      re-timed by cron.alter_job in 20260914174329; re-running cron.schedule
--      with the migration-file schedules would have reverted them). The one
--      exception is prune-cron-run-details, re-scheduled on its never-changed
--      '17 4 * * *' because its command was a raw DELETE, not a function.
--   3. The four pruners that returned void now return what they deleted, and
--      prune-cron-run-details' raw DELETE becomes prune_cron_run_details().
--   4. cron_work_expectations.work_visibility registers, per job, ONE of:
--        'candidates' - the existing found-vs-dispositioned rule (candidate_key)
--        'idle'       - work_keys must sum > 0 within every max_idle window;
--                       only for jobs whose inflow the system itself makes
--        'exempt'     - work_exempt_reason says why "did nothing" cannot be
--                       told from a quiet day for this job
--      src/test/cronWorkVisibility.test.ts fails CI when a scheduled job has
--      none, when an entry names a job that is no longer scheduled, or when a
--      SQL job's newest command does not record its work.
--   5. sweep_silent_cron_failures gains the 'idle' rule and an 'unrecorded'
--      check that reads cron.job itself (a SQL cron created outside the
--      migrations, or re-set without the wrapper), both filed as
--      tags.source = 'cron-silent' with tags.rule saying which.
--
-- Replay-safe: IF NOT EXISTS / DROP ... IF EXISTS, a constraint guarded on
-- pg_constraint, alter_job only for jobs that exist, an UPDATE for the register.

-- ── 1. SQL runs in cron_run_log ─────────────────────────────────────────────
ALTER TABLE public.cron_run_log ALTER COLUMN response_id DROP NOT NULL;

COMMENT ON COLUMN public.cron_run_log.response_id IS
  'pg_net response id for an HTTP cron run (ingested by sweep_silent_cron_failures). NULL for a SQL cron run recorded by public.cron_record_work() (CJ-007).';

-- ── 2. What "did nothing" means, per job ────────────────────────────────────
ALTER TABLE public.cron_work_expectations ADD COLUMN IF NOT EXISTS work_visibility text NULL;
ALTER TABLE public.cron_work_expectations ADD COLUMN IF NOT EXISTS work_keys text[] NULL;
ALTER TABLE public.cron_work_expectations ADD COLUMN IF NOT EXISTS max_idle interval NULL;
ALTER TABLE public.cron_work_expectations ADD COLUMN IF NOT EXISTS work_exempt_reason text NULL;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'cron_work_expectations_work_visibility_chk'
                    AND conrelid = 'public.cron_work_expectations'::regclass) THEN
    ALTER TABLE public.cron_work_expectations
      ADD CONSTRAINT cron_work_expectations_work_visibility_chk CHECK (
        work_visibility IS NULL
        OR work_visibility = 'candidates'
        OR (work_visibility = 'idle' AND coalesce(cardinality(work_keys), 0) > 0 AND max_idle IS NOT NULL)
        OR (work_visibility = 'exempt' AND length(btrim(coalesce(work_exempt_reason, ''))) >= 40));
  END IF;
END
$do$;

COMMENT ON COLUMN public.cron_work_expectations.work_visibility IS
  'CJ-007. candidates = the candidate_key rule; idle = work_keys must sum > 0 within max_idle; exempt = work_exempt_reason says why doing nothing is indistinguishable from a quiet day.';

-- ── 3. The recorder ─────────────────────────────────────────────────────────
-- Returns the body it recorded, so the cron's own '1 row' result still carries
-- it. A failed INSERT never rolls back the job's work: it is filed through
-- log_cron_defect instead (and a WARNING if even that fails).
CREATE OR REPLACE FUNCTION public.cron_record_work(p_job text, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_body jsonb;
BEGIN
  v_body := CASE WHEN jsonb_typeof(p_result) = 'object' THEN p_result
                 ELSE jsonb_build_object('result', p_result) END
            || jsonb_build_object('fn', p_job);
  BEGIN
    INSERT INTO public.cron_run_log (jobname, status_code, body, response_id, occurred_at)
    VALUES (p_job, NULL, v_body, NULL, now());
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM public.log_cron_defect('cron_record_work', p_job, SQLERRM, v_body);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'cron_record_work(%): could not record run: %', p_job, SQLERRM;
    END;
  END;
  RETURN v_body;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cron_record_work(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_record_work(text, jsonb) TO service_role;

-- ── 4. Pruners that threw their count away ──────────────────────────────────
-- A return type cannot change under CREATE OR REPLACE, so each is dropped and
-- recreated with the same body plus the count. The cron commands are text and
-- do not depend on the function object.
DROP FUNCTION IF EXISTS public.prune_cron_run_log();
CREATE FUNCTION public.prune_cron_run_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.cron_run_log WHERE occurred_at < now() - interval '45 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect('prune_cron_run_log', 'run', SQLERRM, '{}'::jsonb);
  RETURN v_deleted;
END;
$fn$;

DROP FUNCTION IF EXISTS public.prune_cron_http_requests();
CREATE FUNCTION public.prune_cron_http_requests()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH d AS (
    DELETE FROM public.cron_http_requests WHERE created_at < now() - interval '2 days'
    RETURNING 1)
  SELECT count(*)::integer FROM d;
$fn$;

DROP FUNCTION IF EXISTS public.cleanup_observability_tables();
CREATE FUNCTION public.cleanup_observability_tables()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_errors    integer := 0;
  v_analytics integer := 0;
BEGIN
  DELETE FROM public.error_logs WHERE created_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS v_errors = ROW_COUNT;
  DELETE FROM public.analytics_events WHERE created_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_analytics = ROW_COUNT;
  RETURN jsonb_build_object('error_logs', v_errors, 'analytics_events', v_analytics);
END;
$fn$;

DROP FUNCTION IF EXISTS public.cleanup_stripe_webhook_events();
CREATE FUNCTION public.cleanup_stripe_webhook_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.stripe_webhook_events
  WHERE processed_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$fn$;

-- The raw DELETE 20260903030805 scheduled, as a function so it can report.
CREATE OR REPLACE FUNCTION public.prune_cron_run_details()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF to_regclass('cron.job_run_details') IS NULL THEN
    RETURN 0;
  END IF;
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.prune_cron_run_log()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_cron_http_requests()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_observability_tables()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_stripe_webhook_events() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_cron_run_details()        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_cron_run_log()            TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_cron_http_requests()      TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_observability_tables()  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_stripe_webhook_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_cron_run_details()        TO service_role;

-- ── 5. The detector: 3a/3b unchanged from 20260924132850 (plus tags.rule on
-- 3b's row), 3c idle and 3d unrecorded new ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_silent_cron_failures()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recorded int := 0;
  v_flagged  int := 0;
  v_names    text[] := ARRAY[]::text[];
  v_idle       int := 0;
  v_unrecorded int := 0;
  r          record;
BEGIN
  -- 3a. Ingest. Only rows whose body actually names its function are kept:
  -- without `fn` there is no trustworthy way to say which cron a body belongs
  -- to (see 20260828030000 -- proximity guessed wrong 3 times in 4), and a
  -- streak counted against the wrong cron is worse than no streak at all.
  -- Body is left empty here and parsed in the loop below: a cast inside this
  -- set-returning INSERT would abort the entire ingest on one truncated or
  -- non-JSON body.
  --
  -- SIX HOURS, not sixty minutes -- pg_net's own retention. See 20260902035753:
  -- an hourly sweep with an hourly window loses an hour of history permanently
  -- for every run it misses, and it missed one.
  INSERT INTO public.cron_run_log (jobname, status_code, body, response_id, occurred_at)
  SELECT substring(resp.content::text from '"fn"\s*:\s*"([a-zA-Z0-9_-]+)"'),
         resp.status_code,
         '{}'::jsonb,
         resp.id,
         resp.created
    FROM net._http_response resp
    -- Q218: only a response to a request a cron tagged (cron_http_tag, Q174)
    -- is a cron run. A manual probe of the function names its fn too, and
    -- used to be counted as one of its runs.
    JOIN public.cron_http_requests t ON t.request_id = resp.id
     -- pg_net ids restart (2026-09-24 ~10:04Z); a tag is only its own request's.
     AND t.created_at BETWEEN resp.created - interval '15 minutes' AND resp.created
   WHERE resp.created > now() - interval '6 hours'
     AND resp.content::text ~ '"fn"\s*:\s*"'
  ON CONFLICT (response_id, occurred_at) DO NOTHING;

  GET DIAGNOSTICS v_recorded = ROW_COUNT;

  -- Fill in the parsed body separately so a malformed one cannot abort the
  -- whole INSERT above.
  FOR r IN
    SELECT l.id, resp.content::text AS raw
      FROM public.cron_run_log l
      JOIN net._http_response resp ON resp.id = l.response_id AND resp.created = l.occurred_at
     WHERE l.body = '{}'::jsonb
  LOOP
    BEGIN
      UPDATE public.cron_run_log SET body = r.raw::jsonb WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      -- Truncated or non-JSON content: leave the body empty. The row still
      -- records that the run happened.
      NULL;
    END;
  END LOOP;

  -- 3b. Detect. For each configured cron, walk its recent runs newest-first and
  -- count how many consecutive ones found candidates but dispositioned none.
  FOR r IN
    WITH runs AS (
      SELECT l.jobname, l.body,
             row_number() OVER (PARTITION BY l.jobname ORDER BY l.occurred_at DESC) AS rn,
             c.candidate_key, c.disposition_keys, c.min_streak, c.note
        FROM public.cron_run_log l
        JOIN public.cron_work_expectations c ON c.jobname = l.jobname
       WHERE l.occurred_at > now() - interval '30 days'
         AND c.candidate_key IS NOT NULL
         AND l.body ? c.candidate_key
         -- ADDED 20260903204415. `?` proves the KEY exists, not that its value
         -- is castable. An object, array, string or null here used to abort the
         -- entire function -- ingest included -- on the numeric cast below.
         AND jsonb_typeof(l.body -> c.candidate_key) = 'number'
    ),
    marked AS (
      SELECT r0.jobname, r0.rn, r0.min_streak, r0.note,
             (r0.body ->> r0.candidate_key)::numeric AS candidates,
             ((r0.body ->> r0.candidate_key)::numeric > 0
              AND (SELECT COALESCE(sum(
                     CASE WHEN jsonb_typeof(r0.body -> k) = 'number'
                          THEN (r0.body ->> k)::numeric
                          ELSE 0 END), 0)
                     FROM unnest(r0.disposition_keys) AS k) = 0) AS suspicious
        FROM runs r0
    ),
    -- The first (newest) NON-suspicious run per job, computed ONCE. It used to
    -- be a correlated subquery re-scanning `marked` for every row, twice
    -- (SELECT list and HAVING): 2,552 ms on prod 2026-09-23 vs 20 ms this way
    -- (Q53). Same streak: every row before that first clean run.
    firsts AS (
      SELECT m1.jobname,
             COALESCE(min(m1.rn) FILTER (WHERE NOT m1.suspicious), 2147483647) AS first_ok
        FROM marked m1
       GROUP BY m1.jobname
    )
    -- The streak is counted from the MOST RECENT run backwards: every row
    -- before the first non-suspicious one. Anchoring it there is what stops a
    -- cron that broke last week and has since recovered from paging today.
    SELECT m.jobname,
           m.min_streak,
           m.note,
           count(*) FILTER (WHERE m.rn < f.first_ok) AS streak,
           max(m.candidates) FILTER (WHERE m.rn = 1) AS latest_candidates
      FROM marked m
      JOIN firsts f ON f.jobname = m.jobname
     GROUP BY m.jobname, m.min_streak, m.note
    HAVING count(*) FILTER (WHERE m.rn < f.first_ok) >= m.min_streak
  LOOP
    -- Deduped on (job, day): a 5-minute cron must not write 288 identical rows.
    IF NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.tags->>'source' = 'cron-silent'
         AND e.tags->>'job' = r.jobname
         AND e.created_at > date_trunc('day', now())
    ) THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('Silent cron: %s found work and did none of it for %s consecutive run(s)',
               r.jobname, r.streak),
        jsonb_build_object('source', 'cron-silent', 'area', 'cron', 'job', r.jobname, 'rule', 'candidates'),
        jsonb_build_object('streak', r.streak,
                           'latest_candidates', r.latest_candidates,
                           'why', r.note));
      v_flagged := v_flagged + 1;
      v_names := v_names || r.jobname;
    END IF;
  END LOOP;

  -- 3c. CJ-007: IDLE. A job registered work_visibility = 'idle' must show
  -- work (the sum of its work_keys) somewhere in every max_idle window. Only
  -- jobs whose inflow the system itself guarantees are registered this way,
  -- so a zero here is not a quiet day. Judged only on runs that happened
  -- (a stopped job is sweep_dead_crons' verdict, not this one) and only once
  -- the job has a full window of recorded history.
  FOR r IN
    WITH rules AS (
      SELECT c.jobname, c.work_keys, c.max_idle
        FROM public.cron_work_expectations c
       WHERE c.work_visibility = 'idle'
         AND c.max_idle IS NOT NULL
         AND cardinality(c.work_keys) > 0
         AND EXISTS (SELECT 1 FROM public.cron_run_log o
                      WHERE o.jobname = c.jobname
                        AND o.occurred_at <= now() - c.max_idle)
    ),
    runs AS (
      SELECT ru.jobname, ru.max_idle, ru.work_keys,
             (SELECT COALESCE(sum(CASE WHEN jsonb_typeof(l.body -> k) = 'number'
                                       THEN (l.body ->> k)::numeric ELSE 0 END), 0)
                FROM unnest(ru.work_keys) AS k) AS work
        FROM rules ru
        JOIN public.cron_run_log l
          ON l.jobname = ru.jobname
         AND l.occurred_at > now() - ru.max_idle
         -- An HTTP body that never parsed says nothing about work.
         AND l.body <> '{}'::jsonb
    )
    SELECT x.jobname, x.max_idle, x.work_keys, count(*) AS runs
      FROM runs x
     GROUP BY x.jobname, x.max_idle, x.work_keys
    HAVING sum(x.work) = 0
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.tags->>'source' = 'cron-silent'
         AND e.tags->>'job' = r.jobname
         AND e.created_at > date_trunc('day', now())
    ) THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('Idle cron: %s ran %s time(s) in the last %s and did no work (%s all zero)',
               r.jobname, r.runs, r.max_idle, array_to_string(r.work_keys, ', ')),
        jsonb_build_object('source', 'cron-silent', 'area', 'cron', 'job', r.jobname, 'rule', 'idle'),
        jsonb_build_object('runs', r.runs,
                           'max_idle', r.max_idle::text,
                           'work_keys', to_jsonb(r.work_keys),
                           'why', 'Registered idle (CJ-007): its inflow is generated by the system itself, so a whole window with no work means it stopped doing its job while still firing.'));
      v_idle := v_idle + 1;
      v_names := v_names || r.jobname;
    END IF;
  END LOOP;

  -- 3d. CJ-007: UNRECORDED. A SQL cron (no net.http_post) whose command does
  -- not go through public.cron_record_work() throws its return value away, so
  -- nothing can tell whether it did anything. Read from cron.job itself so a
  -- job created outside the migrations is seen too. One error per job per day.
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR r IN
      SELECT coalesce(j.jobname, 'jobid ' || j.jobid) AS jobname, j.jobid
        FROM cron.job j
       WHERE j.active
         AND j.command NOT LIKE '%net.http_post(%'
         AND j.command NOT LIKE '%cron_record_work(%'
         AND NOT EXISTS (
               SELECT 1 FROM public.error_logs e
                WHERE e.tags->>'source' = 'cron-silent'
                  AND e.tags->>'job' = coalesce(j.jobname, 'jobid ' || j.jobid)
                  AND e.created_at > date_trunc('day', now()))
       ORDER BY 1
    LOOP
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('Unrecorded SQL cron: %s discards what it did. Wrap its command as SELECT public.cron_record_work(''%s'', to_jsonb(public.<fn>())); (20260925231818).',
               r.jobname, r.jobname),
        jsonb_build_object('source', 'cron-silent', 'area', 'cron', 'job', r.jobname, 'rule', 'unrecorded'),
        jsonb_build_object('jobid', r.jobid, 'docs', 'CJ-007'));
      v_unrecorded := v_unrecorded + 1;
      v_names := v_names || r.jobname;
    END LOOP;
  END IF;

  IF v_flagged + v_idle + v_unrecorded > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s cron(s) running green while doing nothing', v_flagged + v_idle + v_unrecorded),
          'message', format('Affected: %s (found work and did none: %s; idle past their window: %s; SQL cron not recording its work: %s). See error_logs (tags.source = cron-silent, tags.rule).',
                            array_to_string(v_names, ', '), v_flagged, v_idle, v_unrecorded),
          'severity', 'error'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('recorded',   v_recorded,
                            'flagged',    v_flagged,
                            'idle',       v_idle,
                            'unrecorded', v_unrecorded,
                            'jobs',       to_jsonb(v_names));
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_silent_cron_failures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_silent_cron_failures() TO service_role;

-- ── 6. Every SQL cron records its work ──────────────────────────────────────
-- cron.alter_job(command := ...) only: each job keeps the schedule it has live.
-- A job missing from cron.job is left missing (sweep_dead_crons already calls
-- that 'unscheduled').
DO $do$
DECLARE
  r record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT j.jobid, v.command
      FROM (VALUES
        ('auto-start-due-jobs',             $c$SELECT public.cron_record_work('auto-start-due-jobs', to_jsonb(public.auto_start_due_jobs()));$c$),
        ('check-stale-dispute-claims',      $c$SELECT public.cron_record_work('check-stale-dispute-claims', to_jsonb(public.check_stale_dispute_settlement_claims()));$c$),
        ('cleanup-observability-tables',    $c$SELECT public.cron_record_work('cleanup-observability-tables', to_jsonb(public.cleanup_observability_tables()));$c$),
        ('cleanup-stripe-webhook-events',   $c$SELECT public.cron_record_work('cleanup-stripe-webhook-events', to_jsonb(public.cleanup_stripe_webhook_events()));$c$),
        ('cron-missed-slot-catch-up',       $c$SELECT public.cron_record_work('cron-missed-slot-catch-up', to_jsonb(public.run_missed_cron_catch_up()));$c$),
        ('db-saturation-check',             $c$SELECT public.cron_record_work('db-saturation-check', to_jsonb(public.check_db_saturation()));$c$),
        ('detect-stuck-payments',           $c$SELECT public.cron_record_work('detect-stuck-payments', to_jsonb(public.detect_stuck_payments()));$c$),
        ('detect-suspicious-user-patterns', $c$SELECT public.cron_record_work('detect-suspicious-user-patterns', to_jsonb(public.detect_suspicious_user_patterns()));$c$),
        ('error-log-throttle-check',        $c$SELECT public.cron_record_work('error-log-throttle-check', to_jsonb(public.check_error_log_throttle()));$c$),
        ('ops-daily-digest',                $c$SELECT public.cron_record_work('ops-daily-digest', to_jsonb(public.send_ops_daily_digest()));$c$),
        ('prune-cron-http-requests',        $c$SELECT public.cron_record_work('prune-cron-http-requests', to_jsonb(public.prune_cron_http_requests()));$c$),
        ('prune-cron-run-log',              $c$SELECT public.cron_record_work('prune-cron-run-log', to_jsonb(public.prune_cron_run_log()));$c$),
        ('prune-edge-rate-limit-log',       $c$SELECT public.cron_record_work('prune-edge-rate-limit-log', to_jsonb(public.prune_edge_rate_limit_log()));$c$),
        ('prune-retention-tables',          $c$SELECT public.cron_record_work('prune-retention-tables', to_jsonb(public.prune_retention_tables()));$c$),
        ('push-token-health',               $c$SELECT public.cron_record_work('push-token-health', to_jsonb(public.check_push_token_health()));$c$),
        ('reap-stranded-instant-payouts',   $c$SELECT public.cron_record_work('reap-stranded-instant-payouts', to_jsonb(public.reap_stranded_instant_payouts()));$c$),
        ('saved-search-alert-queue',        $c$SELECT public.cron_record_work('saved-search-alert-queue', to_jsonb(public.sweep_saved_search_alert_queue()));$c$),
        ('seed-boundary-failures',          $c$SELECT public.cron_record_work('seed-boundary-failures', to_jsonb(public.check_seed_boundary_failures()));$c$),
        ('sweep-cron-blackouts',            $c$SELECT public.cron_record_work('sweep-cron-blackouts', to_jsonb(public.sweep_cron_blackouts()));$c$),
        ('sweep-cron-http-failures',        $c$SELECT public.cron_record_work('sweep-cron-http-failures', to_jsonb(public.sweep_cron_http_failures()));$c$),
        ('sweep-cron-startup-failures',     $c$SELECT public.cron_record_work('sweep-cron-startup-failures', to_jsonb(public.sweep_cron_startup_failures()));$c$),
        ('sweep-daily-job-digest',          $c$SELECT public.cron_record_work('sweep-daily-job-digest', to_jsonb(public.sweep_daily_job_digest()));$c$),
        ('sweep-dayof-confirm-reminders',   $c$SELECT public.cron_record_work('sweep-dayof-confirm-reminders', to_jsonb(public.sweep_dayof_confirm_reminders()));$c$),
        ('sweep-dead-crons',                $c$SELECT public.cron_record_work('sweep-dead-crons', to_jsonb(public.sweep_dead_crons()));$c$),
        ('sweep-disputes-unsettled',        $c$SELECT public.cron_record_work('sweep-disputes-unsettled', to_jsonb(public.sweep_disputes_closed_without_payment()));$c$),
        ('sweep-email-dlqs',                $c$SELECT public.cron_record_work('sweep-email-dlqs', to_jsonb(public.sweep_email_dlqs()));$c$),
        ('sweep-expired-auto-bans',         $c$SELECT public.cron_record_work('sweep-expired-auto-bans', to_jsonb(public.sweep_expired_auto_bans()));$c$),
        ('sweep-job-start-reminders',       $c$SELECT public.cron_record_work('sweep-job-start-reminders', to_jsonb(public.sweep_job_start_reminders()));$c$),
        ('sweep-no-show-alerts',            $c$SELECT public.cron_record_work('sweep-no-show-alerts', to_jsonb(public.sweep_no_show_alerts()));$c$),
        ('sweep-old-email-send-log',        $c$SELECT public.cron_record_work('sweep-old-email-send-log', to_jsonb(public.sweep_old_email_send_log()));$c$),
        ('sweep-old-error-logs',            $c$SELECT public.cron_record_work('sweep-old-error-logs', to_jsonb(public.sweep_old_error_logs()));$c$),
        ('sweep-old-notifications',         $c$SELECT public.cron_record_work('sweep-old-notifications', to_jsonb(public.sweep_old_notifications()));$c$),
        ('sweep-release-last-chance',       $c$SELECT public.cron_record_work('sweep-release-last-chance', to_jsonb(public.sweep_release_last_chance()));$c$),
        ('sweep-silent-cron-failures',      $c$SELECT public.cron_record_work('sweep-silent-cron-failures', to_jsonb(public.sweep_silent_cron_failures()));$c$),
        ('sync-profiles-update-grants',     $c$SELECT public.cron_record_work('sync-profiles-update-grants', to_jsonb(public.sync_profiles_update_grants()));$c$)
      ) AS v(jobname, command)
      JOIN cron.job j ON j.jobname = v.jobname
     WHERE j.command IS DISTINCT FROM v.command
  LOOP
    PERFORM cron.alter_job(job_id := r.jobid, command := r.command);
  END LOOP;

  -- prune-cron-run-details was a raw DELETE; it now runs through its own
  -- function, on the schedule 20260903030805 gave it (never re-timed since).
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-cron-run-details') THEN
    PERFORM cron.schedule('prune-cron-run-details', '17 4 * * *',
      $c$SELECT public.cron_record_work('prune-cron-run-details', to_jsonb(public.prune_cron_run_details()));$c$);
  END IF;

  -- Any other SQL cron of the plain `SELECT public.<fn>();` shape whose
  -- function returns something (extend-boosts-hourly was created outside the
  -- migrations; its command is not in this repo). Anything else stays as it
  -- is and 3d files it as 'unrecorded' for a person.
  FOR r IN
    SELECT j.jobid, j.jobname, m[1] AS fn
      FROM cron.job j
      CROSS JOIN LATERAL regexp_match(j.command, '^\s*SELECT\s+public\.([a-z_][a-z0-9_]*)\(\s*\)\s*;?\s*$', 'i') AS m
     WHERE j.jobname IS NOT NULL
       AND j.command NOT LIKE '%net.http_post(%'
       AND j.command NOT LIKE '%cron_record_work(%'
       AND EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.' || m[1] || '()')
                      AND p.prorettype <> 'void'::regtype
                      AND NOT p.proretset)
  LOOP
    PERFORM cron.alter_job(
      job_id  := r.jobid,
      command := format('SELECT public.cron_record_work(%L, to_jsonb(public.%I()));', r.jobname, r.fn));
  END LOOP;
END
$do$;

-- ── 7. The register: one entry per job the repo schedules or monitors ───────
-- src/test/cronWorkVisibility.test.ts reads this and fails when a job is
-- missing, or an entry names a job that is gone. Every run of every job is
-- in cron_run_log whatever its entry says; the entry only decides what the
-- detector treats as "did nothing".
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.cron_work_expectations c
     SET work_visibility    = v.work_visibility,
         max_idle           = v.max_idle,
         work_keys          = v.work_keys,
         work_exempt_reason = v.work_exempt_reason
    FROM (VALUES
      -- Found-vs-dispositioned rules, keys as their own migrations registered them.
      ('payment-confirm-reminder',        'candidates', NULL::interval, NULL::text[], NULL::text),
      ('expiring-jobs-push',              'candidates', NULL, NULL, NULL),
      ('daily-match-digest',              'candidates', NULL, NULL, NULL),
      ('charge-recurring-visits',         'candidates', NULL, NULL, NULL),
      ('auto-tip-charge',                 'candidates', NULL, NULL, NULL),
      ('expire-subscriptions',            'candidates', NULL, NULL, NULL),
      ('subscription-reconciliation',     'candidates', NULL, NULL, NULL),
      ('marketing-publish',               'candidates', NULL, NULL, NULL),
      ('marketing-token-health',          'candidates', NULL, NULL, NULL),

      -- Idle rules: inflow the system makes itself, every hour of every day.
      -- max_idle comes before work_keys on purpose: a job name, then a quoted
      -- word, then an ARRAY is the shape cronWatcherKeyContract.test.ts reads
      -- as a candidate_key rule.
      ('prune-cron-run-details',          'idle', interval '3 days', ARRAY['result'],
       NULL),
      ('prune-cron-http-requests',        'idle', interval '1 day', ARRAY['result'],
       NULL),
      ('sweep-silent-cron-failures',      'idle', interval '6 hours', ARRAY['recorded'],
       NULL),
      ('cron-missed-slot-catch-up',       'idle', interval '2 hours', ARRAY['succeeded_15m'],
       NULL),

      -- Event-driven work loops: zero is the right answer whenever nothing is
      -- due, and each candidate is either counted or filed.
      ('auto-start-due-jobs',             'exempt', NULL, NULL,
       'Starts jobs whose start time has come; zero when none is due. Each candidate is either counted or filed via log_cron_defect, so found-but-not-done cannot be silent.'),
      ('sweep-daily-job-digest',          'exempt', NULL, NULL,
       'Daily in-app digest; zero when no new job matches anyone. Each candidate is either counted or filed via log_cron_defect, so found-but-not-done cannot be silent.'),
      ('sweep-dayof-confirm-reminders',   'exempt', NULL, NULL,
       'Day-of confirm nudges; zero when no job is due one. Each candidate is either counted or filed via log_cron_defect, so found-but-not-done cannot be silent.'),
      ('sweep-expired-auto-bans',         'exempt', NULL, NULL,
       'Lifts auto-bans past their expiry; zero when none has expired. Each candidate is either counted or filed via log_cron_defect, so found-but-not-done cannot be silent.'),
      ('sweep-job-start-reminders',       'exempt', NULL, NULL,
       'Start-time reminders; zero when no job starts soon. Each candidate is either counted or filed via log_cron_defect, so found-but-not-done cannot be silent.'),
      ('sweep-no-show-alerts',            'exempt', NULL, NULL,
       'No-show alerts; zero when nobody missed a start. Each candidate is either counted or filed via log_cron_defect, so found-but-not-done cannot be silent.'),
      ('sweep-release-last-chance',       'exempt', NULL, NULL,
       'Last-chance-before-auto-release nudge; zero when no escrow job is in its final 2 hours. Each candidate is either counted or filed via log_cron_defect, so found-but-not-done cannot be silent.'),
      ('saved-search-alert-queue',        'exempt', NULL, NULL,
       'Drains saved-search alerts whose early-access wait is over; zero when none is due. A send that raises is filed to error_logs (source saved-search-alert-queue); a lock wait leaves the row queued for the next minute.'),
      ('reap-stranded-instant-payouts',   'exempt', NULL, NULL,
       'Repair: zero is the healthy outcome (no instant payout stuck at pending). Every reap is itself an error_logs row (instant-payout-reaper) and a Slack page.'),

      -- Monitors: their output IS the alert, and zero findings is the healthy state.
      ('check-stale-dispute-claims',      'exempt', NULL, NULL,
       'Monitor: reports stale dispute settlement claims; zero stale is the healthy state and each finding is its own alert.'),
      ('db-saturation-check',             'exempt', NULL, NULL,
       'Monitor: writes a db_saturation_samples row per run and alerts on a problem; zero problems is the healthy state.'),
      ('detect-stuck-payments',           'exempt', NULL, NULL,
       'Monitor: alerts on checkout sessions stuck unpaid; zero is the healthy state and each finding is its own alert (ops ledger detect_stuck_payments).'),
      ('detect-suspicious-user-patterns', 'exempt', NULL, NULL,
       'Monitor: files fraud_flags for suspicious patterns; zero flags is the healthy state. Scan failures go through log_cron_defect.'),
      ('error-log-throttle-check',        'exempt', NULL, NULL,
       'Monitor: alerts when the error_logs throttle dropped rows; zero dropped is the healthy state.'),
      ('ops-daily-digest',                'exempt', NULL, NULL,
       'Daily Slack digest; total can be zero on a quiet day. Delivery is judged separately by check_ops_digest_delivery (ops-digest-undelivered).'),
      ('push-token-health',               'exempt', NULL, NULL,
       'Monitor (Q82): its result is ok/problem about push tokens and it files push-tokens-empty itself; there is no work count to expect.'),
      ('seed-boundary-failures',          'exempt', NULL, NULL,
       'Monitor (Q160): alerts when the seed-boundary check errored; zero failures is the healthy state.'),
      ('sweep-cron-blackouts',            'exempt', NULL, NULL,
       'Monitor: alerts on a pg_cron-wide blackout; flagged 0 is the healthy state.'),
      ('sweep-cron-http-failures',        'exempt', NULL, NULL,
       'Monitor: files non-2xx HTTP cron answers; zero logged is the healthy state.'),
      ('sweep-cron-startup-failures',     'exempt', NULL, NULL,
       'Monitor: alerts on pg_cron job start-up failures; zero failed is the healthy state.'),
      ('sweep-dead-crons',                'exempt', NULL, NULL,
       'Monitor: liveness verdicts per job; flagged 0 is the healthy state.'),
      ('sweep-disputes-unsettled',        'exempt', NULL, NULL,
       'Monitor: reports disputes closed without moving money; zero reported is the healthy state.'),
      ('sweep-email-dlqs',                'exempt', NULL, NULL,
       'Monitor: reports email dead-letter queues; zero reported is the healthy state.'),
      ('sync-profiles-update-grants',     'exempt', NULL, NULL,
       'Repair: re-grants profile column privileges only when they drifted; repaired false is the healthy state.'),
      ('money-reconciliation',            'exempt', NULL, NULL,
       'Reconciler, never a repairer: it reports money discrepancies and moves nothing, so there is no disposition to expect. Findings answer 500 (cronResult defects) and are filed by sweep_cron_http_failures.'),

      -- Age-based deletes: zero is right whenever nothing crossed the line.
      ('cleanup-observability-tables',    'exempt', NULL, NULL,
       'Age-based TTL delete (error_logs 30d, analytics_events 90d); zero when nothing crossed the line that day. Inflow on a pre-launch prod is not guaranteed daily, so an idle rule would page on quiet days.'),
      ('cleanup-stripe-webhook-events',   'exempt', NULL, NULL,
       'Age-based TTL delete of webhook events over 30 days; zero when no event aged out that day. Webhook inflow is not guaranteed daily before launch.'),
      ('prune-cron-run-log',              'exempt', NULL, NULL,
       'Age-based prune at 45 days. cron_run_log starts 2026-08-26, so nothing reaches 45 days before 2026-10-10: an idle rule would page every day until then.'),
      ('prune-edge-rate-limit-log',       'exempt', NULL, NULL,
       'Age-based prune of the edge rate-limit log; zero when no edge traffic aged out, which is common before launch.'),
      ('prune-retention-tables',          'exempt', NULL, NULL,
       'Age-based prune of several retention tables; zero when nothing aged out that day. Per-table counts are recorded.'),
      ('sweep-old-email-send-log',        'exempt', NULL, NULL,
       'Age-based TTL delete of email_send_log; zero when no email aged out that day. Email volume is not guaranteed daily before launch.'),
      ('sweep-old-error-logs',            'exempt', NULL, NULL,
       'Age-based TTL delete of error_logs; zero when nothing aged out that day. Delete failures go through log_cron_defect.'),
      ('sweep-old-notifications',         'exempt', NULL, NULL,
       'Age-based TTL delete of old notifications; zero when nothing aged out that day. Notification volume is not guaranteed daily before launch.'),
      ('cleanup-notifications',           'exempt', NULL, NULL,
       'Age-based delete of read notifications over 30 days; zero when nothing aged out. A failure answers 500 (cronError) and is filed by sweep_cron_http_failures.'),

      -- HTTP crons: every answer is in cron_run_log (cronResult names fn) and
      -- any per-item failure is a defect that turns the answer into a 500.
      ('arrival-confirm-reminder',        'exempt', NULL, NULL,
       'processed counts every job awaiting arrival confirmation, including those with no stage due this run, so processed>0 with sent=0 is a normal run. Send failures are cronResult defects (HTTP 500).'),
      ('stalled-completion-reminder',     'exempt', NULL, NULL,
       'processed counts every in-progress job without a completion stamp, including those with no nudge due, so processed>0 with sent=0 is a normal run. Send failures are cronResult defects (HTTP 500).'),
      ('backfill-job-geocode',            'exempt', NULL, NULL,
       'Addresses that cannot be geocoded stay queued and are retried every run, so attempted>0 with geocoded=0 recurs on a healthy system. Reported as stillFailed; errors are cronResult defects.'),
      ('process-scheduled-payouts',       'exempt', NULL, NULL,
       'Pays out what is due; zero when no scheduled payout is due. Failures it counts are cronResult defects (HTTP 500), filed by sweep_cron_http_failures.'),
      ('str-ical-sync',                   'exempt', NULL, NULL,
       'Syncs connected STR calendars; zero when no host has connected one. Failures it counts are cronResult defects (HTTP 500).'),
      ('auto-expire-jobs',                'exempt', NULL, NULL,
       'Expires jobs and offers past their time; zero when none is past due. Failures it counts are cronResult defects (HTTP 500).'),
      ('auto-release-payment',            'exempt', NULL, NULL,
       'Releases escrow whose review window ended; zero when none is due. Failures it counts are cronResult defects (HTTP 500), filed by sweep_cron_http_failures.'),
      ('auto-resolve-disputes',           'exempt', NULL, NULL,
       'Resolves disputes past their deadline; zero when none is due. Failures are cronResult defects (HTTP 500).'),
      ('cleanup-abandoned-accounts',      'exempt', NULL, NULL,
       'scanned>0 with deleted=0 is its guards protecting live accounts, not a failure (20260829020000). Delete errors are cronResult defects (HTTP 500).'),
      ('engagement-automations',          'exempt', NULL, NULL,
       'Lifecycle emails with no single candidate count (20260829020000); zero sends is normal when nobody is due a step. Its errors array is the cronResult defect count.'),
      ('process-email-queue',             'exempt', NULL, NULL,
       'Drains the email queue; processed=0 whenever the queue is empty. Dead letters are watched by sweep-email-dlqs; send failures are cronResult defects.'),
      ('review-nag-cron',                 'exempt', NULL, NULL,
       'jobs_checked includes jobs already nagged inside the dedupe window, so checked>0 with nags_sent=0 is a normal run. Failures are cronResult defects (HTTP 500).'),
      ('saved-helper-availability-push',  'exempt', NULL, NULL,
       'pairs>0 with notified=0 is normal whenever no saved Helpr changed availability. Failures are cronResult defects (HTTP 500).'),
      ('void-cancelled-payments',         'exempt', NULL, NULL,
       'Voids or refunds payments on cancelled jobs; zero when none holds money. Failures it counts are cronResult defects (HTTP 500), filed by sweep_cron_http_failures.'),
      ('weekly-helper-report',            'exempt', NULL, NULL,
       'Weekly earnings email; sent=0 is normal when no Pro+ Helpr worked that week. Send failures are cronResult defects (HTTP 500).'),

      -- Created outside the migrations: its command is not in this repo.
      ('extend-boosts-hourly',            'exempt', NULL, NULL,
       'Created outside the migrations, so its result shape is unknown here. Section 6 wraps it when its command is SELECT public.<fn>(); otherwise 3d files it as unrecorded for a person.')
    ) AS v(jobname, work_visibility, max_idle, work_keys, work_exempt_reason)
   WHERE c.jobname = v.jobname;
END
$do$;
