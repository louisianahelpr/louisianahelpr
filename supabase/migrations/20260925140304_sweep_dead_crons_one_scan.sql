-- Q105(4): sweep_dead_crons() cost ~1.2 s on every hourly run (pg_stat_statements
-- 2026-09-25: 71 calls, mean 1,185 ms). Its `live` CTE ran four correlated
-- subqueries per registered job over cron.job_run_details, which has no index
-- but its runid key (owned by supabase_admin, so none can be added): 61 jobs x
-- 4 = 244 full scans of ~16,000 rows, 810 ms of the call (EXPLAIN ANALYZE on
-- prod). The run-history facts now come from one window pass over the table
-- (36 ms on the same data). The verdicts, their order and the rest of the body
-- are 20260924082754's; on prod the old and new `live` rows were identical in
-- both directions for all 61 jobs.
--
-- Guard: src/test/cronRunHistoryScannedOnce.test.ts (no newest function body
-- may correlate a cron.job_run_details subquery on jobid, except an exact
-- two-way list) and src/test/pglite/sweepDeadCronsOneScan.pglite.mjs (every
-- verdict, old body vs new body, on the same fixture).

CREATE OR REPLACE FUNCTION public.sweep_dead_crons()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_flagged    int := 0;
  v_names      text[] := ARRAY[]::text[];
  v_resumed_at timestamptz;
  v_gap_start  timestamptz;
  v_digest     jsonb;
  r            record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN jsonb_build_object('flagged', 0, 'jobs', '[]'::jsonb,
                              'skipped', 'pg_cron not installed');
  END IF;

  -- The most recent scheduler blackout: a hole of 45+ minutes in the AGGREGATE
  -- dispatch stream. Unchanged from 20260914183932.
  SELECT g.prev_start, g.start_time
    INTO v_gap_start, v_resumed_at
    FROM (
      SELECT d.start_time,
             lag(d.start_time) OVER (ORDER BY d.start_time) AS prev_start
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '8 days'
    ) g
   WHERE g.prev_start IS NOT NULL
     AND g.start_time - g.prev_start >= interval '45 minutes'
   ORDER BY g.start_time DESC
   LIMIT 1;

  FOR r IN
    WITH expected AS (
      SELECT c.jobname, c.expected_max_gap, c.registered_at
        FROM public.cron_work_expectations c
       WHERE c.expected_max_gap IS NOT NULL
    ),
    -- Every run-history fact the verdicts need, from ONE pass over
    -- cron.job_run_details. The table has no index but its runid key (pg_cron
    -- owns it, so none can be added), and a per-job subquery scans all of it
    -- once per job and per fact.
    ranked AS (
      SELECT d.jobid,
             d.start_time,
             d.status,
             d.return_message,
             d.end_time,
             row_number() OVER (PARTITION BY d.jobid, (d.end_time IS NOT NULL)
                                ORDER BY d.start_time DESC)   AS rn_done,
             -- CJ-004: a job that raises its OWN error (not a lost connection
             -- or a startup timeout, which sweep_cron_startup_failures pages
             -- as a fleet burst) once is a defect, even between successes.
             (d.end_time IS NOT NULL
              AND d.status <> 'succeeded'
              AND d.start_time > now() - interval '24 hours'
              AND coalesce(d.return_message, '') NOT ILIKE '%connection failed%'
              AND coalesce(d.return_message, '') NOT ILIKE '%startup timeout%') AS is_raised
        FROM cron.job_run_details d
    ),
    run_stats AS (
      SELECT rk.jobid,
             max(rk.start_time)                                AS last_start,
             -- The last 3 finished runs: how many, and how many failed.
             count(*) FILTER (WHERE rk.end_time IS NOT NULL AND rk.rn_done <= 3
                                AND rk.status <> 'succeeded')  AS recent_bad,
             count(*) FILTER (WHERE rk.end_time IS NOT NULL AND rk.rn_done <= 3)
                                                              AS recent_total,
             (array_agg(rk.return_message ORDER BY rk.start_time DESC)
                FILTER (WHERE rk.is_raised))[1]                AS raised_msg
        FROM ranked rk
       GROUP BY rk.jobid
    ),
    live AS (
      SELECT e.jobname,
             e.expected_max_gap,
             e.registered_at,
             j.jobid,
             j.active,
             s.last_start,
             coalesce(s.recent_bad, 0)                        AS recent_bad,
             coalesce(s.recent_total, 0)                      AS recent_total,
             s.raised_msg
        FROM expected e
        LEFT JOIN cron.job j ON j.jobname = e.jobname
        LEFT JOIN run_stats s ON s.jobid = j.jobid
    ),
    graded AS (
      SELECT l.jobname,
             l.expected_max_gap,
             l.last_start,
             l.registered_at,
             l.raised_msg,
             CASE
               WHEN l.jobid IS NULL THEN 'unscheduled'
               WHEN l.active IS FALSE THEN 'inactive'
               WHEN l.last_start IS NULL
                    AND GREATEST(l.registered_at,
                          CASE WHEN l.registered_at >= v_gap_start - l.expected_max_gap
                               THEN v_resumed_at END) < now() - l.expected_max_gap
                 THEN 'never-ran'
               WHEN l.last_start IS NOT NULL
                    AND GREATEST(l.last_start,
                          CASE WHEN l.last_start >= v_gap_start - l.expected_max_gap
                               THEN v_resumed_at END) < now() - l.expected_max_gap
                 THEN 'dead'
               WHEN l.recent_total >= 3 AND l.recent_bad = l.recent_total THEN 'erroring'
               WHEN l.raised_msg IS NOT NULL THEN 'raised'
               ELSE NULL
             END AS verdict
        FROM live l
    ),
    -- THE OTHER DIRECTION. `graded` can only ever grade jobs somebody
    -- remembered to register; this reads the scheduler itself, so a cron added
    -- by a future migration — or straight on the database, which is how
    -- extend-boosts-hourly came to exist — is reported the first time this
    -- sweep runs after it appears, instead of being silently unwatched.
    uncovered AS (
      SELECT j.jobname,
             NULL::interval    AS expected_max_gap,
             NULL::timestamptz AS last_start,
             NULL::timestamptz AS registered_at,
             NULL::text        AS raised_msg,
             'unmonitored'     AS verdict
        FROM cron.job j
       WHERE j.active
         AND j.jobname IS NOT NULL
         AND NOT EXISTS (
               SELECT 1 FROM public.cron_work_expectations c
                WHERE c.jobname = j.jobname
                  AND c.expected_max_gap IS NOT NULL)
    )
    SELECT * FROM graded WHERE verdict IS NOT NULL
    UNION ALL
    SELECT * FROM uncovered
  LOOP
    CONTINUE WHEN r.verdict IS NULL;

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
          WHEN 'raised' THEN
            format('Cron %s raised an error inside pg_cron in the last 24 hours (not a lost connection or startup timeout): %s',
                   r.jobname, left(r.raised_msg, 300))
          WHEN 'unmonitored' THEN
            format('Cron %s is scheduled and active but has no liveness expectation — nothing would notice if it stopped. Add a cron_work_expectations row with an expected_max_gap matching its schedule.',
                   r.jobname)
          ELSE
            format('Dead cron: %s has not fired since %s (tolerance %s)',
                   r.jobname, r.last_start, r.expected_max_gap)
        END,
        jsonb_build_object('source', 'cron-dead', 'area', 'cron',
                           'job', r.jobname, 'verdict', r.verdict),
        jsonb_build_object('last_start',         r.last_start,
                           'registered_at',      r.registered_at,
                           'scheduler_resumed_at', v_resumed_at,
                           'expected_max_gap',   r.expected_max_gap::text,
                           'verdict',            r.verdict,
                           'raised_message',     left(r.raised_msg, 1000)));
      v_flagged := v_flagged + 1;
      v_names := v_names || r.jobname;
    END IF;
  END LOOP;

  IF v_flagged > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s cron(s) need attention', v_flagged),
          'message', format('Affected: %s. Each either missed a full tolerance while the scheduler was running, raised its own error, or is scheduled with no liveness expectation at all. See error_logs (tags.source = cron-dead, tags.verdict).',
                            array_to_string(v_names, ', ')),
          'severity', 'critical'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  BEGIN
    v_digest := public.check_ops_digest_delivery();
  EXCEPTION WHEN OTHERS THEN
    v_digest := jsonb_build_object('ok', false, 'check_error', SQLERRM);
    INSERT INTO public.error_logs (severity, message, tags)
    VALUES ('error', 'check_ops_digest_delivery raised: ' || SQLERRM,
            jsonb_build_object('source', 'cron-dead', 'area', 'alerting', 'job', 'check_ops_digest_delivery'));
  END;

  RETURN jsonb_build_object('flagged', v_flagged, 'jobs', to_jsonb(v_names),
                            'scheduler_resumed_at', v_resumed_at,
                            'digest_delivery', v_digest);
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_dead_crons() FROM PUBLIC, anon, authenticated;
