-- Liveness must be measured from "did pg_cron fire it", not "did it answer".
--
-- ── What is wrong today ─────────────────────────────────────────────────────
--
-- `sweep_dead_crons()` (20260901011254) asks `cron_run_log` when a job last
-- reported. That table is populated by `sweep_silent_cron_failures()`, which
-- ingests `net._http_response` rows whose CONTENT matches `"fn":"..."`. So a
-- row exists only when the job (a) is an HTTP cron, (b) returned a JSON body,
-- and (c) returned it inside pg_net's 5-second timeout.
--
-- Measured on prod 2026-09-01, that gap is not theoretical in either direction:
--
--   FALSE NEGATIVE (an outage read as an all-clear).
--     `money-reconciliation` has been scheduled at 08:20 daily since
--     20260828230000. In the whole of `cron_run_log` (2493 rows, 2026-08-26 →
--     2026-09-01) it has ZERO rows, and in the whole of `error_logs` it has
--     exactly one trace: a single pg_net timeout on 2026-08-28. It has never
--     been observed to complete. 20260901011254 gave it an `expected_max_gap`
--     of 30 hours — and `sweep_dead_crons` still cannot flag it, because it
--     JOINs `cron_run_log` and the job has no rows to join to. A job that has
--     never reported is invisible to the detector forever. This is the
--     project's documented failure mode — monitoring reporting an outage as an
--     all-clear — reproduced inside the monitoring itself.
--
--   FALSE POSITIVE (a healthy job read as dead).
--     `auto-expire-jobs` shows a 240-minute hole in `cron_run_log` against a
--     60-minute schedule. It did not miss three runs: it timed out at 5s three
--     times in a row (12 such timeouts are logged for it, tagged
--     `source=cron-http`, severity `warning`). pg_net gave up; the function
--     kept running server-side. Any cron that gets slower than 5s disappears
--     from `cron_run_log` while working perfectly, and a liveness check built
--     on that table would page for it. A detector that cries wolf gets muted,
--     and a muted detector is what this whole family of sweeps exists to stop.
--
-- Both errors have the same root cause: `cron_run_log` records ANSWERS, and
-- liveness is a question about FIRINGS. And SQL-only crons — 18 of them, from
-- `sweep-pending-broadcast-fan-outs` (every minute) to `detect-stuck-payments`
-- — never produce an HTTP answer at all, so they have no liveness coverage of
-- any kind and never could under the old design.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
--
-- pg_cron already records every firing in `cron.job_run_details`, for SQL and
-- HTTP jobs alike, whether or not anything came back. That is the correct
-- authority and it is already read by `sweep_cron_http_failures()`
-- (20260828030000), so the SECURITY DEFINER owner demonstrably has access.
--
-- This migration keeps `cron_run_log` doing what it is good at (what a run
-- REPORTED) and moves liveness onto `cron.job_run_details` (whether a run
-- HAPPENED). The two sweeps stay separate on purpose, same as before.
--
-- ── Three checks, deliberately distinct ─────────────────────────────────────
--
--   dead      — the job exists and is active, but has not fired within its
--               tolerance. This now works for SQL crons and for jobs that have
--               never fired once.
--   unscheduled — the job has a registered liveness expectation but does not
--               exist in `cron.job`. This is the "declared in a migration,
--               absent from the database" case that a restore, a branch
--               database, or a never-merged migration produces, and which
--               schema drift detection cannot see because `cron.job` is data.
--   erroring  — the job fires, but every recent firing ended `status='failed'`.
--               A SQL cron whose command raises is recorded ONLY in
--               `cron.job_run_details`, which (per 20260831193039's own header)
--               nothing reads. Liveness alone would call it healthy: it is
--               running, it is just running into a wall every time.
--
-- ── What is deliberately NOT added ──────────────────────────────────────────
--
-- No new "did work" assertion. The rule from 20260829020000 stands: a cron
-- whose correct output is usually zero must never page for zero, or the
-- channel gets muted. Every row this migration adds sets ONLY
-- `expected_max_gap`; `candidate_key` stays NULL, which makes those rows
-- invisible to `sweep_silent_cron_failures` by construction — its predicate is
-- `l.body ? c.candidate_key`, and `? NULL` is NULL, so the row never matches.

-- ── 1. Let an expectation be liveness-only, and honestly so ─────────────────
-- 20260901011254 had to smuggle money-reconciliation's liveness row past a
-- NOT NULL by naming a key that is an object rather than a number, so the
-- numeric cast yields 0 and the work rule can never fire. That works, but it
-- encodes "this is not a work rule" as a puzzle. Making the column nullable
-- says it outright.
ALTER TABLE public.cron_work_expectations
  ALTER COLUMN candidate_key DROP NOT NULL;

ALTER TABLE public.cron_work_expectations
  ALTER COLUMN disposition_keys DROP NOT NULL;

ALTER TABLE public.cron_work_expectations
  ALTER COLUMN disposition_keys SET DEFAULT ARRAY[]::text[];

-- Present already if 20260901011254 has been applied; created here otherwise so
-- this file does not depend on the order the two land in.
ALTER TABLE public.cron_work_expectations
  ADD COLUMN IF NOT EXISTS expected_max_gap interval NULL;

-- The grace anchor. Without it, a job whose expectation is registered before
-- its first firing would be flagged dead the moment the sweep runs. With it,
-- a never-fired job becomes eligible exactly one tolerance after it was
-- registered — which is precisely the money-reconciliation case, and is the
-- whole point of removing the JOIN.
ALTER TABLE public.cron_work_expectations
  ADD COLUMN IF NOT EXISTS registered_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.cron_work_expectations.candidate_key IS
  'Body key holding "how many candidates this run found". NULL means this row asserts liveness only and carries no did-work rule.';

COMMENT ON COLUMN public.cron_work_expectations.registered_at IS
  'When this expectation was first registered. Used as the grace anchor for liveness so a job that has never fired is flagged one tolerance after registration instead of immediately — or, as before this column existed, never.';

-- ── 2. Register liveness for every scheduled job ────────────────────────────
--
-- Tolerances are the schedule interval plus real slack (roughly 2.5x, rounded
-- to something a human would say out loud). They are set so that ONE missed
-- firing never pages and two consecutive ones do. Daily jobs get 30 hours,
-- matching the value 20260901011254 already chose, so nothing here contradicts
-- a tolerance already in the tree.
--
-- Every name below is taken from a `cron.schedule(...)` call in this migrations
-- directory. `reap-stranded-instant-payouts`, `str-ical-sync`,
-- `process-scheduled-payouts` and `subscription-reconciliation` were scheduled
-- on 2026-08-31/09-01 and are included so they are covered from their first day
-- rather than from whenever someone next audits.
INSERT INTO public.cron_work_expectations (jobname, expected_max_gap)
VALUES
  -- HTTP crons (schedules per 20260829010000's minute map and later files)
  ('auto-expire-jobs',                interval '3 hours'),
  ('auto-release-payment',            interval '3 hours'),
  ('auto-resolve-disputes',           interval '14 hours'),
  ('auto-tip-charge',                 interval '3 hours'),
  ('backfill-job-geocode',            interval '10 hours'),
  ('charge-recurring-visits',         interval '30 hours'),
  ('cleanup-abandoned-accounts',      interval '30 hours'),
  ('cleanup-notifications',           interval '30 hours'),
  ('daily-match-digest',              interval '30 hours'),
  ('engagement-automations',          interval '30 hours'),
  ('expiring-jobs-push',              interval '30 hours'),
  ('payment-confirm-reminder',        interval '30 hours'),
  ('process-email-queue',             interval '1 hour'),
  ('process-scheduled-payouts',       interval '3 hours'),
  ('reap-stranded-instant-payouts',   interval '3 hours'),
  ('review-nag-cron',                 interval '30 hours'),
  ('saved-helper-availability-push',  interval '14 hours'),
  ('str-ical-sync',                   interval '14 hours'),
  ('void-cancelled-payments',         interval '3 hours'),
  -- Weekly. 8 days, so a Monday run that slips into Tuesday is not an alarm.
  ('weekly-helper-report',            interval '8 days'),
  -- The three 20260901011254 already covers. Repeated with the identical
  -- 30-hour value so this file does not depend on that one having landed —
  -- on a fresh rebuild either order produces the same tolerances.
  ('expire-subscriptions',            interval '30 hours'),
  ('money-reconciliation',            interval '30 hours'),
  ('subscription-reconciliation',     interval '30 hours'),
  -- SQL-only sweeps. These have never had liveness coverage of any kind,
  -- because they produce no HTTP response for cron_run_log to record.
  ('auto-start-due-jobs',             interval '2 hours'),
  ('detect-stuck-payments',           interval '2 hours'),
  ('detect-suspicious-user-patterns', interval '30 hours'),
  ('prune-cron-run-log',              interval '30 hours'),
  ('sweep-cron-http-failures',        interval '2 hours'),
  ('sweep-daily-job-digest',          interval '30 hours'),
  ('sweep-dayof-confirm-reminders',   interval '1 hour'),
  ('sweep-dead-crons',                interval '3 hours'),
  ('sweep-expired-auto-bans',         interval '3 hours'),
  ('sweep-job-start-reminders',       interval '1 hour'),
  ('sweep-no-show-alerts',            interval '1 hour'),
  ('sweep-old-email-send-log',        interval '30 hours'),
  ('sweep-old-error-logs',            interval '30 hours'),
  ('sweep-old-notifications',         interval '30 hours'),
  ('sweep-pending-broadcast-fan-outs', interval '30 minutes'),
  ('sweep-release-last-chance',       interval '1 hour'),
  ('sweep-silent-cron-failures',      interval '3 hours'),
  ('sync-profiles-update-grants',     interval '90 minutes')
ON CONFLICT (jobname) DO UPDATE
  -- Only the tolerance. An existing row's did-work rule is left exactly as its
  -- own migration wrote it, and `registered_at` keeps its original value so
  -- re-running this file does not reset anyone's grace window.
  SET expected_max_gap = EXCLUDED.expected_max_gap;

-- ── 3. The liveness sweep, rebuilt on cron.job_run_details ──────────────────
CREATE OR REPLACE FUNCTION public.sweep_dead_crons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_flagged int := 0;
  v_names   text[] := ARRAY[]::text[];
  r         record;
BEGIN
  -- On a from-scratch rebuild pg_cron may not be installed yet. Report that
  -- plainly rather than raising: this function is itself on a schedule, and a
  -- monitor that crashes is a monitor that is not monitoring.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN jsonb_build_object('flagged', 0, 'jobs', '[]'::jsonb,
                              'skipped', 'pg_cron not installed');
  END IF;

  FOR r IN
    WITH expected AS (
      SELECT c.jobname, c.expected_max_gap, c.registered_at
        FROM public.cron_work_expectations c
       WHERE c.expected_max_gap IS NOT NULL
    ),
    -- LEFT JOIN, not JOIN: a job that has never fired must remain visible.
    -- That single word is the difference between catching money-reconciliation
    -- and not.
    live AS (
      SELECT e.jobname,
             e.expected_max_gap,
             e.registered_at,
             j.jobid,
             j.active,
             (SELECT max(d.start_time)
                FROM cron.job_run_details d
               WHERE d.jobid = j.jobid)                     AS last_start,
             -- Of the last few firings, how many ended badly. pg_cron writes
             -- 'succeeded' / 'failed' here; a SQL cron whose command raises
             -- lands as 'failed' and is otherwise recorded nowhere anything
             -- reads.
             (SELECT count(*) FILTER (WHERE d.status <> 'succeeded')
                FROM (SELECT d2.status
                        FROM cron.job_run_details d2
                       WHERE d2.jobid = j.jobid
                         AND d2.end_time IS NOT NULL
                       ORDER BY d2.start_time DESC
                       LIMIT 3) d)                          AS recent_bad,
             (SELECT count(*)
                FROM (SELECT 1
                        FROM cron.job_run_details d3
                       WHERE d3.jobid = j.jobid
                         AND d3.end_time IS NOT NULL
                       ORDER BY d3.start_time DESC
                       LIMIT 3) d)                          AS recent_total
        FROM expected e
        LEFT JOIN cron.job j ON j.jobname = e.jobname
    )
    SELECT l.jobname,
           l.expected_max_gap,
           l.last_start,
           l.registered_at,
           CASE
             -- Registered here, absent from the database. A restore, a branch
             -- database, or a migration that never merged.
             WHEN l.jobid IS NULL THEN 'unscheduled'
             -- Explicitly disabled. Worth saying once so it is a decision on
             -- the record rather than a surprise during an incident.
             WHEN l.active IS FALSE THEN 'inactive'
             -- Never fired, and past the grace window measured from the moment
             -- the expectation was registered.
             WHEN l.last_start IS NULL
                  AND l.registered_at < now() - l.expected_max_gap THEN 'never-ran'
             -- Fired once, then stopped.
             WHEN l.last_start IS NOT NULL
                  AND l.last_start < now() - l.expected_max_gap THEN 'dead'
             -- Firing on time, and every recent firing raised. Liveness alone
             -- would call this healthy.
             WHEN l.recent_total >= 3 AND l.recent_bad = l.recent_total THEN 'erroring'
             ELSE NULL
           END AS verdict
      FROM live l
  LOOP
    CONTINUE WHEN r.verdict IS NULL;

    -- One row per job per day. A 5-minute cron must not write 288 identical
    -- rows, and the tag shape matches what sweep_dead_crons already wrote so
    -- anything reading `source = cron-dead` keeps working.
    IF NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.tags->>'source' = 'cron-dead'
         AND e.tags->>'job' = r.jobname
         AND e.created_at > date_trunc('day', now())
    ) THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        CASE r.verdict
          WHEN 'unscheduled' THEN
            format('Cron %s is expected to run but does not exist in cron.job', r.jobname)
          WHEN 'inactive' THEN
            format('Cron %s exists but is disabled (active = false)', r.jobname)
          WHEN 'never-ran' THEN
            format('Cron %s has never fired since it was registered at %s (tolerance %s)',
                   r.jobname, r.registered_at, r.expected_max_gap)
          WHEN 'erroring' THEN
            format('Cron %s is firing but its last 3 runs all failed inside pg_cron', r.jobname)
          ELSE
            format('Dead cron: %s has not fired since %s (tolerance %s)',
                   r.jobname, r.last_start, r.expected_max_gap)
        END,
        jsonb_build_object('source', 'cron-dead', 'area', 'cron',
                           'job', r.jobname, 'verdict', r.verdict),
        jsonb_build_object('last_start',       r.last_start,
                           'registered_at',    r.registered_at,
                           'expected_max_gap', r.expected_max_gap::text,
                           'verdict',          r.verdict));
      v_flagged := v_flagged + 1;
      v_names := v_names || r.jobname;
    END IF;
  END LOOP;

  IF v_flagged > 0 THEN
    -- Never let a failed alert delivery take the sweep down with it: the
    -- error_logs rows above are the durable record, Slack is the notification.
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s cron(s) are not running as scheduled', v_flagged),
          'message', format('Affected: %s. See error_logs (tags.source = cron-dead) for the verdict on each.',
                            array_to_string(v_names, ', ')),
          'severity', 'error'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('flagged', v_flagged, 'jobs', to_jsonb(v_names));
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_dead_crons() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sweep_dead_crons() IS
  'Liveness for every scheduled job, measured from cron.job_run_details (did it FIRE) rather than cron_run_log (did it ANSWER). Covers SQL-only crons, jobs that have never fired, jobs registered but absent from cron.job, and jobs that fire but fail inside pg_cron every time. Complement to sweep_silent_cron_failures(), which inspects the content of runs that did answer.';
