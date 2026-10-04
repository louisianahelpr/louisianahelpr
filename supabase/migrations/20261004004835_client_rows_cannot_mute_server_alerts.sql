-- Q1159 (docs/OPEN.md; MEDIUM, found by the lh-authz-rls review of Q1156):
-- a client row can no longer mute a server page.
--
-- WHAT WAS BROKEN. anon and authenticated hold INSERT on public.error_logs (the
-- signed-out app logs its crashes; measured on prod 2026-10-04:
-- has_table_privilege('anon', 'public.error_logs', 'INSERT') = true).
-- stamp_error_log_origin re-sources only the four paging sources, so a client
-- can still write tags.source / tags.area / tags.job / tags.queue / tags.ref /
-- context.* of any OTHER server source. Every server-side throttle and dedupe
-- read error_logs by exactly those keys and counted the client's row:
--   * notify_slack_on_error_log (one Slack post per source per severity window:
--     10 min fatal, 60 error, 240 warning, 720 info): one forged row tagged
--     with a server source inside the window suppressed that source's page
--     (the ledger row still landed, the Slack post did not);
--   * sweep_dead_crons: the once-a-day 'cron-dead' dedupe per job;
--   * and the same shape in 13 more sweeps/monitors (all 15 are rewritten below).
-- A forged 'ops-digest' row also counted as a delivery receipt in
-- check_ops_digest_delivery, and a forged high-water row in sweep_email_dlqs
-- hid every dead letter below it.
--
-- THE FIX. Every read of error_logs that a SERVER function uses to throttle,
-- dedupe, rate-limit or take a receipt now ignores client-origin rows:
--     coalesce(e.tags ->> 'origin', '') <> 'client'
-- tags.origin is stamped by trg_error_logs_00_stamp_origin from current_user,
-- which a client cannot choose: a client row is ALWAYS 'client' (the stamp
-- overwrites whatever it sent). `<> 'client'` rather than `= 'server'` because
-- 3,081 pre-stamp rows (before 20260914192035) carry no origin on prod
-- (measured 2026-10-04; 341 client, 764 server); the all-time-max dedupes
-- (sweep_email_dlqs high-water, sweep_cron_blackouts, check_seed_boundary_
-- failures) would otherwise forget them and re-page. Same predicate the
-- ledger trigger and ops_alert_verify already use.
--
-- The bodies are the live bodies: each newest migration body below was compared
-- byte for byte with pg_proc.prosrc on prod on 2026-10-04 (md5 equal for all
-- 15), and the ONLY change is the predicate added at each error_logs read. CREATE OR REPLACE keeps each
-- function's ACL and comment.
--
-- NOT CHANGED, on purpose: the readers that look at CLIENT rows by design
-- (ops_alert_record_user_error_screen, ops_alert_condition's user-error-screen
-- branches, throttle_client_error_log), ops_alert_verify (already filters
-- origin), report_stale_dispute_settlement_claim (already origin = 'server'),
-- cron_silent_rule (reads one row by id). detect_stuck_payments' seed-digest
-- dedupe (info rows only, never a page) is NOT rewritten: its live body is not
-- its newest migration's (prosrc md5 differs, 2026-10-04), so it needs a
-- pg_get_functiondef read first; filed as its own queue item.
--
-- Guard: src/test/errorLogDedupesIgnoreClientRows.test.ts (every function that
-- reads error_logs filters origin or is on an exact two-way list) and
-- src/test/pglite/clientRowsCannotMuteServerAlerts.pglite.mjs (behaviour, red
-- on the previous chain, green after, applied 3x).

CREATE OR REPLACE FUNCTION public.notify_slack_on_error_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recent   int;
  v_title    text;
  v_source   text;
  v_window   interval;
  v_alert_sev text;
  v_critical_sources CONSTANT text[] := ARRAY[
    'detect_stuck_payments',
    'auto_start_due_jobs',
    'detect_suspicious_user_patterns',
    'rls-escalation-refused'
  ];
BEGIN
  v_source := COALESCE(
    CASE WHEN jsonb_typeof(NEW.tags) = 'object' THEN COALESCE(NEW.tags ->> 'source', NEW.tags ->> 'area') END,
    'app');

  -- UNCHANGED AND LOAD-BEARING. A row a browser can write must never page an
  -- operator. Stamped by trg_error_logs_stamp_origin from `current_user`,
  -- which a client cannot choose. Now that every severity posts, this is the
  -- only thing between a forged 'warning' and #ops-alerts.
  IF NEW.tags ->> 'origin' = 'client' THEN
    RETURN NEW;
  END IF;

  -- Seed/E2E data (tags.seed or a '-seed' source) goes to the daily digest,
  -- which lists every error_logs row by source. It never pages. Real rows are
  -- untouched (20260923052520).
  IF public.error_log_is_seed(NEW.tags) THEN
    RETURN NEW;
  END IF;

  -- One post per source per window; the window is the severity's cadence.
  -- Mirrored in alertPolicy.ts SLACK_THROTTLE_MINUTES.
  v_window := CASE NEW.severity
                WHEN 'fatal'   THEN interval '10 minutes'
                WHEN 'error'   THEN interval '60 minutes'
                WHEN 'warning' THEN interval '240 minutes'
                WHEN 'info'    THEN interval '720 minutes'
                ELSE interval '60 minutes'   -- an unreadable severity is not one to quietly drop
              END;

  -- A money/security source keeps the fastest cadence whatever it carries.
  IF v_source = ANY (v_critical_sources) THEN
    v_window := interval '10 minutes';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.error_logs e
  WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.id <> NEW.id
    AND e.created_at > now() - v_window
    AND COALESCE(e.severity, '') = COALESCE(NEW.severity, '')
    AND (jsonb_typeof(e.tags) = 'object'
         AND COALESCE(e.tags ->> 'source', e.tags ->> 'area') = v_source);
  IF v_recent > 0 THEN
    RETURN NEW;
  END IF;

  -- fatal/error -> critical (alertPolicy's existing rule); warning and info
  -- keep their own icon and colour so a page still means "something is broken".
  v_alert_sev := CASE
                   WHEN v_source = ANY (v_critical_sources) THEN 'critical'
                   WHEN NEW.severity IN ('fatal', 'error') THEN 'critical'
                   WHEN NEW.severity = 'warning' THEN 'warning'
                   WHEN NEW.severity = 'info' THEN 'info'
                   ELSE 'critical'
                 END;

  -- The DB severity is in the title because it has four values and the channel
  -- shows three; without this a reader cannot tell an error from a fatal.
  v_title := left(format('[%s/%s] %s', upper(COALESCE(NEW.severity, '?')), v_source, NEW.message), 140);

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'kind', 'custom',
        'severity', v_alert_sev,
        'title', v_title,
        'message', left(COALESCE(NEW.message, ''), 900),
        'fields', jsonb_build_object(
          'url', COALESCE(NEW.url, '—'),
          'db_severity', COALESCE(NEW.severity, '?'),
          'error_logs.id', NEW.id::text),
        'link', '/admin?view=health'));
  EXCEPTION WHEN OTHERS THEN
    -- Slack is the notification; error_logs is the durable record. A failed
    -- post must never take the writing transaction down with it.
    NULL;
  END;
  RETURN NEW;
END;
$function$;

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
       WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags->>'source' = 'cron-dead'
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
       WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags->>'source' = 'cron-silent'
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
       WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags->>'source' = 'cron-silent'
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
                WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags->>'source' = 'cron-silent'
                  AND e.tags->>'job' = coalesce(j.jobname, 'jobid ' || j.jobid)
                  AND e.created_at > date_trunc('day', now()))
       ORDER BY 1
    LOOP
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('Unrecorded SQL cron: %s discards what it did. Wrap its command as SELECT public.cron_record_work(''%s'', to_jsonb(public.<fn>())); (a set-returning fn: to_jsonb((SELECT count(*) FROM public.<fn>())); see 20260925231818).',
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

CREATE OR REPLACE FUNCTION public.sweep_cron_http_failures()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_logged  int := 0;
  v_errors  int := 0;
  v_names   text[] := ARRAY[]::text[];
  r         record;
  v_job         text;
  v_attribution text;
  -- Q207(2) / Q218
  v_catchup_failed int := 0;
  v_catchup_names  text[] := ARRAY[]::text[];
  v_untagged       int := 0;
  v_untagged_names text[] := ARRAY[]::text[];
  v_ok             boolean;
  v_why            text;
  v_n              int;
  v_parts          text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT resp.id,
           resp.status_code,
           resp.timed_out,
           resp.error_msg,
           resp.created,
           left(coalesce(resp.content::text, ''), 500) AS body,
           -- Q174: the cron that sent this request, recorded by the cron's own
           -- command (cron_http_tag). Exact, never inferred.
           tag.jobname AS tagged_job,
           -- Self-reported name, read straight out of the body. Deliberately a
           -- regex rather than a jsonb cast: the content may be plain text
           -- ("Unauthorized"), an HTML gateway error, or JSON cut short, and a
           -- cast would raise on all three. Kept only to flag a disagreement
           -- with the tag.
           substring(coalesce(resp.content::text, '') from '"fn"\s*:\s*"([a-zA-Z0-9_-]+)"') AS self_fn,
           -- Defect count the function reported about itself, when it said so.
           substring(coalesce(resp.content::text, '') from '"defects"\s*:\s*([0-9]+)') AS self_defects
      FROM net._http_response resp
      -- Q174: an INNER join. A response no cron tagged (a manual probe, a
      -- sweeper's own Slack post) is not a cron failure and is not filed.
      JOIN public.cron_http_requests tag ON tag.request_id = resp.id
       AND tag.created_at BETWEEN resp.created - interval '15 minutes' AND resp.created
     -- pg_net prunes responses after roughly 6 hours, so a 60-minute lookback
     -- on a 15-minute schedule never misses one. The overlap is deliberate and
     -- harmless: the NOT EXISTS below makes re-reads idempotent.
     WHERE resp.created > now() - interval '60 minutes'
       AND (resp.status_code IS NULL
            OR resp.status_code < 200
            OR resp.status_code >= 300
            OR resp.timed_out IS TRUE
            OR resp.error_msg IS NOT NULL)
       AND NOT EXISTS (
             SELECT 1 FROM public.error_logs e
              WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags->>'source' = 'cron-http'
                AND e.context->>'response_id' = resp.id::text
                AND e.created_at >= resp.created)
  LOOP
      v_job := r.tagged_job;
      IF r.self_fn IS NOT NULL AND r.self_fn <> r.tagged_job THEN
        v_attribution := format('request-id (body names %s)', r.self_fn);
      ELSE
        v_attribution := 'request-id';
      END IF;

      -- A pg_net timeout is NOT proof the work failed. pg_net gives up at 5s
      -- while the edge function keeps running server-side, so a cold start on a
      -- healthy function produces one of these. Recorded, because a cron that
      -- regularly exceeds 5s is worth knowing about, but deliberately NOT paged
      -- on: an alert that fires for routine cold starts is an alert people mute,
      -- and a muted alert is the exact failure this whole sweep exists to fix.
      -- Only a real non-2xx answer counts as an error.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN r.timed_out THEN 'warning' ELSE 'error' END,
        format('Cron HTTP %s: %s returned %s%s',
               CASE WHEN r.timed_out THEN 'timeout' ELSE 'failure' END,
               v_job,
               coalesce(r.status_code::text,
                        nullif(r.error_msg, ''),
                        CASE WHEN r.timed_out THEN 'timeout' ELSE 'no response' END),
               CASE WHEN r.self_defects IS NOT NULL
                    THEN format(' (%s defect(s) reported)', r.self_defects)
                    ELSE '' END),
        jsonb_build_object('source', 'cron-http',
                           'area',   'cron',
                           'job',    v_job),
        jsonb_build_object('response_id',  r.id,
                           'status_code',  r.status_code,
                           'timed_out',    r.timed_out,
                           'error_msg',    r.error_msg,
                           'body',         r.body,
                           -- How the job name above was established.
                           'attribution',  v_attribution,
                           'defects',      r.self_defects,
                           'occurred_at',  r.created));
      v_logged := v_logged + 1;
      IF NOT r.timed_out THEN
        v_errors := v_errors + 1;
        IF NOT (v_job = ANY (v_names)) THEN
          v_names := v_names || v_job;
        END IF;
      END IF;
  END LOOP;

  -- Q207(2): the HTTP outcome of a caught-up missed slot. run_missed_cron_catch_up
  -- keeps the request id its command tagged; until now 'caught_up' only meant
  -- the request was queued. A 2xx closes it; a non-2xx, a pg_net timeout or
  -- error, or no response two hours on (pg_net keeps ~6h) makes the slot
  -- 'catch_up_failed' and files the catch-up's own failure alert. Not limited
  -- to the 60-minute window above: an unchecked run is read until decided.
  FOR r IN
    SELECT c.jobname, c.slot, c.request_id, c.decided_at,
           resp.id AS resp_id, resp.status_code, resp.timed_out, resp.error_msg,
           left(coalesce(resp.content::text, ''), 200) AS body
      FROM public.cron_catchup_runs c
      LEFT JOIN net._http_response resp ON resp.id = c.request_id AND resp.created >= c.decided_at
     WHERE c.action = 'caught_up'
       AND c.request_id IS NOT NULL
       AND c.http_checked_at IS NULL
       AND (resp.id IS NOT NULL OR c.decided_at < now() - interval '2 hours')
     ORDER BY c.decided_at
  LOOP
    v_ok := r.resp_id IS NOT NULL
            AND r.status_code BETWEEN 200 AND 299
            AND r.timed_out IS NOT TRUE
            AND r.error_msg IS NULL;
    v_why := CASE
      WHEN r.resp_id IS NULL THEN
        format('no HTTP response to request %s within 2 hours', r.request_id)
      WHEN r.timed_out THEN
        format('request %s timed out (%s); the function may still have finished, check its logs',
               r.request_id, coalesce(nullif(r.error_msg, ''), 'pg_net timeout'))
      ELSE
        format('request %s answered %s%s', r.request_id,
               coalesce(r.status_code::text, nullif(r.error_msg, ''), 'no status'),
               CASE WHEN r.body <> '' THEN ': ' || r.body ELSE '' END)
    END;
    UPDATE public.cron_catchup_runs
       SET http_checked_at = now(),
           http_status     = r.status_code,
           action          = CASE WHEN v_ok THEN action ELSE 'catch_up_failed' END,
           detail          = CASE WHEN v_ok THEN detail ELSE left(v_why, 300) END
     WHERE jobname = r.jobname AND slot = r.slot
       AND action = 'caught_up' AND http_checked_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 OR v_ok THEN CONTINUE; END IF;

    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error',
            format('Missed cron slot NOT re-run: %s — its %s UTC slot was caught up at %s, but the catch-up run itself FAILED: %s. A person decides what the lost slot needs.',
                   r.jobname, to_char(r.slot AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                   to_char(r.decided_at AT TIME ZONE 'UTC', 'HH24:MI'), v_why),
            jsonb_build_object('source', 'cron-missed-slot', 'area', 'cron', 'job', r.jobname),
            jsonb_build_object('slot', r.slot, 'action', 'catch_up_failed',
                               'request_id', r.request_id, 'status_code', r.status_code,
                               'timed_out', r.timed_out, 'error_msg', r.error_msg,
                               'docs', 'docs/OPEN.md Q207'));
    v_catchup_failed := v_catchup_failed + 1;
    IF NOT (r.jobname = ANY (v_catchup_names)) THEN
      v_catchup_names := v_catchup_names || r.jobname;
    END IF;
  END LOOP;

  -- Q218: an HTTP cron whose command does not go through cron_http_tag() is
  -- invisible to the join above (added from the dashboard, or re-set by
  -- cron.alter_job without the wrapper). One error per job per UTC day.
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR r IN
      SELECT j.jobid, coalesce(j.jobname, 'jobid ' || j.jobid) AS jobname
        FROM cron.job j
       WHERE j.active
         AND j.command LIKE '%net.http_post(%'
         AND j.command NOT LIKE '%cron_http_tag(%'
         AND NOT EXISTS (
               SELECT 1 FROM public.error_logs e
                WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags->>'source' = 'cron-http-untagged'
                  AND e.tags->>'job' = coalesce(j.jobname, 'jobid ' || j.jobid)
                  AND e.created_at >= date_trunc('day', now()))
       ORDER BY 2
    LOOP
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              format('Untagged HTTP cron: %s calls net.http_post without public.cron_http_tag(), so its HTTP failures are never filed. Wrap its command as 20260923170422 does.',
                     r.jobname),
              jsonb_build_object('source', 'cron-http-untagged', 'area', 'cron', 'job', r.jobname),
              jsonb_build_object('jobid', r.jobid, 'docs', 'docs/OPEN.md Q218'));
      v_untagged := v_untagged + 1;
      v_untagged_names := v_untagged_names || r.jobname;
    END LOOP;
  END IF;

  -- One Slack message per run, never one per failure. A cron that fails every
  -- 5 minutes must not turn the ops channel into the thing people mute — the
  -- durable per-failure detail is already in error_logs above.
  IF v_errors > 0 THEN
    v_parts := v_parts || format('HTTP failures: %s (tags.source = cron-http)',
                                 array_to_string(v_names, ', '));
  END IF;
  IF v_catchup_failed > 0 THEN
    v_parts := v_parts || format('caught-up missed slot whose HTTP call failed: %s (tags.source = cron-missed-slot)',
                                 array_to_string(v_catchup_names, ', '));
  END IF;
  IF v_untagged > 0 THEN
    v_parts := v_parts || format('HTTP cron not tagging its request, failures invisible: %s (tags.source = cron-http-untagged)',
                                 array_to_string(v_untagged_names, ', '));
  END IF;
  IF cardinality(v_parts) > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s cron HTTP failure(s) in the last hour', v_errors + v_catchup_failed + v_untagged),
          'message', format('%s. Details in error_logs.', array_to_string(v_parts, '; ')),
          'severity', 'error'));
    EXCEPTION WHEN OTHERS THEN
      -- Never let the notifier take down the recorder. If the vault secret or
      -- the Slack function is unavailable, the error_logs rows above still
      -- stand and this run still reports its count.
      NULL;
    END;
  END IF;

  -- `logged` counts everything recorded, `errors` only the hard failures that
  -- paged. They differ by the ambiguous timeouts, and keeping both visible is
  -- what makes a run reportable without re-reading error_logs.
  RETURN jsonb_build_object('logged',  v_logged,
                            'errors',  v_errors,
                            'paged',   cardinality(v_parts) > 0,
                            'jobs',    to_jsonb(v_names),
                            'catch_up_failed', v_catchup_failed,
                            'catch_up_failed_jobs', to_jsonb(v_catchup_names),
                            'untagged', v_untagged,
                            'untagged_jobs', to_jsonb(v_untagged_names));
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_cron_defect(
  p_fn      text,
  p_ref     text,
  p_err     text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ref text := COALESCE(NULLIF(p_ref, ''), 'run');
BEGIN
  -- Same (function, row) already reported this hour — the sweep is simply
  -- retrying a row it cannot process, which is one fact, not sixty.
  IF EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags->>'source' = p_fn
       AND e.tags->>'ref'    = v_ref
       AND e.created_at > now() - interval '1 hour'
  ) THEN
    RETURN;
  END IF;

  -- Flood cap: at most 20 defect rows per function per hour, so an alert
  -- cannot fill the log. Past the cap a row is still dropped, but no longer
  -- silently (20260926043528): ONE 'defect-cap' row per function per hour
  -- says the cap was hit and counts every failure dropped after it, so "20
  -- failures" can never hide "300". It keeps p_fn as its source, so a '-seed'
  -- function's cap row stays seed (error_log_is_seed) and never pages. The
  -- cap row itself is not counted toward the cap.
  IF (
    SELECT count(*) FROM public.error_logs e
     WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags->>'source' = p_fn
       AND e.tags->>'ref' IS DISTINCT FROM 'defect-cap'
       AND e.created_at > now() - interval '1 hour'
  ) >= 20 THEN
    -- Two sessions hitting the cap at once must not both insert the row.
    PERFORM pg_advisory_xact_lock(hashtext('log_cron_defect-cap:' || p_fn));
    UPDATE public.error_logs e
       SET context = coalesce(e.context, '{}'::jsonb)
                     || jsonb_build_object(
                          'dropped', coalesce((e.context ->> 'dropped')::int, 0) + 1,
                          'last_dropped_ref', v_ref,
                          'last_error', left(coalesce(p_err, 'unknown error'), 400),
                          'last_dropped_at', now())
     WHERE e.id = (SELECT c.id FROM public.error_logs c
                    WHERE coalesce(c.tags ->> 'origin', '') <> 'client' AND c.tags->>'source' = p_fn
                      AND c.tags->>'ref' = 'defect-cap'
                      AND c.created_at > now() - interval '1 hour'
                    ORDER BY c.created_at DESC
                    LIMIT 1);
    IF NOT FOUND THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('%s: over 20 failures in an hour — further failures are being dropped (log_cron_defect cap); the dropped count is in context.dropped',
               p_fn),
        jsonb_build_object('source', p_fn, 'area', 'cron', 'job', p_fn, 'ref', 'defect-cap'),
        jsonb_build_object('dropped', 1, 'cap', 20,
                           'first_dropped_ref', v_ref,
                           'first_error', left(coalesce(p_err, 'unknown error'), 400),
                           'last_dropped_ref', v_ref,
                           'last_error', left(coalesce(p_err, 'unknown error'), 400),
                           'last_dropped_at', now()));
    END IF;
    RAISE WARNING 'log_cron_defect(%): hourly cap reached, dropped and counted: % (%)', p_fn, p_err, v_ref;
    RETURN;
  END IF;

  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    'error',
    format('%s: %s failed: %s', p_fn, v_ref, left(COALESCE(p_err, 'unknown error'), 400)),
    jsonb_build_object('source', p_fn, 'area', 'cron', 'job', p_fn, 'ref', v_ref),
    COALESCE(p_context, '{}'::jsonb) || jsonb_build_object('error', p_err)
  );
EXCEPTION WHEN OTHERS THEN
  -- Logging must never be the thing that breaks the sweep.
  RAISE WARNING 'log_cron_defect(%): could not record defect: % (original: %)', p_fn, SQLERRM, p_err;
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_cron_blackouts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_gap_start timestamptz;
  v_gap_end   timestamptz;
  v_minutes   numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN jsonb_build_object('flagged', 0, 'skipped', 'pg_cron not installed');
  END IF;

  -- Differenced over the whole retained history, then restricted to gaps that
  -- ENDED in the last 24 hours. Restricting the rows first (the old version)
  -- made any gap longer than the window invisible.
  SELECT g.prev_start, g.start_time,
         extract(epoch FROM (g.start_time - g.prev_start)) / 60
    INTO v_gap_start, v_gap_end, v_minutes
    FROM (
      SELECT d.start_time,
             lag(d.start_time) OVER (ORDER BY d.start_time) AS prev_start
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '8 days'
    ) g
   WHERE g.prev_start IS NOT NULL
     AND g.start_time > now() - interval '24 hours'
   ORDER BY (g.start_time - g.prev_start) DESC
   LIMIT 1;

  IF v_minutes IS NULL OR v_minutes < 15 THEN
    RETURN jsonb_build_object('flagged', 0,
                              'largest_gap_minutes', COALESCE(round(v_minutes, 1), 0));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags->>'source' = 'cron-blackout'
       AND e.context->>'gap_start' = v_gap_start::text
  ) THEN
    RETURN jsonb_build_object('flagged', 0, 'already_reported', v_gap_start);
  END IF;

  -- Stored as text so the dedupe above compares like with like.
  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    'error',
    format('pg_cron dispatched nothing for %s minutes (%s → %s) — every scheduled job in the product was silent',
           round(v_minutes, 1), v_gap_start, v_gap_end),
    jsonb_build_object('source', 'cron-blackout', 'area', 'cron'),
    jsonb_build_object('gap_start',   v_gap_start::text,
                       'gap_end',     v_gap_end::text,
                       'gap_minutes', round(v_minutes, 1)));

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'title', format('Prod scheduler was down for %s', CASE WHEN v_minutes >= 120
                          THEN round(v_minutes / 60, 1) || ' hours'
                          ELSE round(v_minutes, 0) || ' minutes' END),
        'message', format('No scheduled job fired between %s and %s UTC (database or pg_cron down). It is running again; missed payouts, releases and emails catch up on their next runs. See error_logs (tags.source = cron-blackout).',
                          to_char(v_gap_start AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                          to_char(v_gap_end AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')),
        'severity', 'critical'));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('flagged', 1,
                            'gap_start', v_gap_start,
                            'gap_minutes', round(v_minutes, 1));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_ops_digest_delivery()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_records   int;
  v_delivered int := 0;
  v_failed    int := 0;
  v_problem   text;
  v_has_row   boolean;
BEGIN
  SELECT count(*) INTO v_records
    FROM public.error_logs e
   WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND jsonb_typeof(e.tags) = 'object'
     AND e.tags ->> 'source' = 'ops-digest'
     AND e.created_at > now() - interval '30 hours';

  IF to_regclass('net._http_response') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FILTER (WHERE r.status_code = 200 AND r.content::text ~ '"ok"\s*:\s*true'),
             count(*) FILTER (WHERE r.id IS NOT NULL
                               AND NOT (r.status_code IS NOT DISTINCT FROM 200
                                        AND r.content::text ~ '"ok"\s*:\s*true'))
             + count(*) FILTER (WHERE e.context ->> 'request_id' IS NULL)
        FROM public.error_logs e
        LEFT JOIN net._http_response r ON r.id = (e.context ->> 'request_id')::bigint
                                       AND r.created BETWEEN e.created_at - interval '5 minutes'
                                                         AND e.created_at + interval '1 hour'
       WHERE coalesce(e.tags ->> 'origin', '') <> 'client'
         AND jsonb_typeof(e.tags) = 'object'
         AND e.tags ->> 'source' = 'ops-digest'
         AND e.created_at > now() - interval '30 hours'
         AND e.created_at < now() - interval '10 minutes'
    $q$ INTO v_delivered, v_failed;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.cron_work_expectations c WHERE c.jobname = 'ops-daily-digest')
    INTO v_has_row;

  v_problem := CASE
    -- Without the expectation row "none in 30 h" can never fire, so ok:true
    -- would be a false clear (and ops_alert_verify would close on it).
    WHEN NOT v_has_row THEN 'Daily ops digest delivery cannot be checked: cron_work_expectations has no ops-daily-digest row.'
    -- Grace: the digest's first run is up to a day after this migration, so
    -- "none in 30 h" only counts once the digest has existed for 30 h.
    WHEN v_records = 0 AND EXISTS (
           SELECT 1 FROM public.cron_work_expectations c
            WHERE c.jobname = 'ops-daily-digest'
              AND c.registered_at < now() - interval '30 hours') THEN 'No daily ops digest has been sent in 30 hours (ops-daily-digest did not run or raised).'
    WHEN v_delivered = 0 AND v_failed > 0 THEN 'The daily ops digest was sent but Slack did not accept it (see net._http_response / slack-ops-alert logs). Alerts may not be reaching #ops-alerts.'
    ELSE NULL
  END;

  IF v_problem IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'records', v_records, 'delivered', v_delivered);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'ops-digest-undelivered'
       AND e.created_at > date_trunc('day', now())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'already_reported', true);
  END IF;

  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES ('error', v_problem,
          jsonb_build_object('source', 'ops-digest-undelivered', 'area', 'alerting'),
          jsonb_build_object('records', v_records, 'delivered', v_delivered, 'failed', v_failed));

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'title', 'Daily ops digest not delivered',
        'message', v_problem,
        'severity', 'critical'));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', false, 'problem', v_problem);
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_push_token_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tokens        bigint;
  v_recent        bigint;
  v_native_users  bigint := 0;
  v_skipped_7d    bigint := 0;
  v_problem       text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE t.updated_at > now() - interval '14 days')
    INTO v_tokens, v_recent
    FROM public.push_tokens t
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.user_id = t.user_id AND p.is_seed IS TRUE);

  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    SELECT count(DISTINCT a.user_id) INTO v_native_users
      FROM public.analytics_events a
     WHERE a.platform IN ('ios', 'android')
       AND a.user_id IS NOT NULL
       AND a.created_at > now() - interval '14 days';
  END IF;

  IF to_regclass('public.notification_logs') IS NOT NULL THEN
    SELECT count(*) INTO v_skipped_7d
      FROM public.notification_logs n
     WHERE n.channel = 'push'
       AND n.status = 'skipped'
       AND n.error_message = 'no_registered_devices'
       AND n.created_at > now() - interval '7 days';
  END IF;

  IF v_tokens = 0 THEN
    v_problem := format(
      'No device can receive a push — push_tokens has 0 rows for real users, so every push is skipped (%s skipped in 7 days; %s signed-in native users in 14 days). See docs/OPEN.md Q82.',
      v_skipped_7d, v_native_users);
  END IF;

  IF v_problem IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tokens', v_tokens, 'registered_14d', v_recent,
                              'native_users_14d', v_native_users, 'skipped_no_device_7d', v_skipped_7d);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'push-tokens-empty'
       AND e.created_at > date_trunc('day', now())
  ) THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', v_problem,
            jsonb_build_object('source', 'push-tokens-empty', 'area', 'push'),
            jsonb_build_object('tokens', v_tokens, 'registered_14d', v_recent,
                               'native_users_14d', v_native_users,
                               'skipped_no_device_7d', v_skipped_7d));
  END IF;

  RETURN jsonb_build_object('ok', false, 'problem', v_problem, 'tokens', v_tokens,
                            'registered_14d', v_recent, 'native_users_14d', v_native_users,
                            'skipped_no_device_7d', v_skipped_7d);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_db_saturation(
  p_log_timeouts       int DEFAULT NULL,
  p_log_window_minutes int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t            jsonb := public.db_saturation_thresholds();
  v_origin     text := CASE WHEN p_log_timeouts IS NULL THEN 'cron' ELSE 'workflow' END;
  v_max        int;
  v_client     int;
  v_active     int;
  v_longest    numeric;
  v_iix        int;
  v_pct        numeric;
  v_calls      numeric;
  v_ms         numeric;
  v_app        jsonb;
  v_prev       public.db_saturation_state%ROWTYPE;
  v_window_s   numeric;
  v_cps        numeric;
  v_mps        numeric;
  v_p95        numeric;
  v_wcalls     numeric;
  v_signals    jsonb;
  v_problems   text[];
  v_rate       numeric;
  v_log_prob   text;
BEGIN
  v_max := current_setting('max_connections')::int;
  SELECT count(*) FILTER (WHERE backend_type = 'client backend'),
         count(*) FILTER (WHERE backend_type = 'client backend' AND state IS DISTINCT FROM 'idle'
                            AND pid <> pg_backend_pid()),
         max(extract(epoch FROM now() - query_start)) FILTER (
               WHERE backend_type = 'client backend' AND state = 'active'
                 AND pid <> pg_backend_pid()
                 AND coalesce(application_name, '') NOT LIKE 'pg_dump%'),
         count(*) FILTER (WHERE backend_type = 'client backend'
                            AND state LIKE 'idle in transaction%'
                            AND state_change < now() - interval '5 minutes')
    INTO v_client, v_active, v_longest, v_iix
    FROM pg_stat_activity;
  v_pct := round(100.0 * v_client / nullif(v_max, 0), 1);
  v_longest := round(coalesce(v_longest, 0), 1);

  -- Window stats: only the 5-minute cron advances the window, so a workflow
  -- call in between cannot shrink it.
  IF v_origin = 'cron' AND to_regclass('extensions.pg_stat_statements') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(sum(calls), 0), coalesce(sum(total_exec_time), 0)
        FROM extensions.pg_stat_statements $q$
      INTO v_calls, v_ms;
    EXECUTE $q$
      SELECT coalesce(jsonb_object_agg(k, jsonb_build_array(c, m)), '{}'::jsonb)
        FROM (SELECT s.queryid::text || ':' || s.userid::text AS k,
                     sum(s.calls) AS c, round(sum(s.total_exec_time)::numeric, 3) AS m
                FROM extensions.pg_stat_statements s
                JOIN pg_roles r ON r.oid = s.userid
               WHERE r.rolname IN ('authenticated', 'anon', 'service_role')
                 AND s.calls > 0
               GROUP BY s.queryid, s.userid) x $q$
      INTO v_app;

    SELECT * INTO v_prev FROM public.db_saturation_state WHERE id = 1;
    IF FOUND THEN
      v_window_s := extract(epoch FROM now() - v_prev.sampled_at);
      -- A counter that went DOWN is a stats reset: no window this time.
      IF v_window_s >= 60 AND v_calls >= v_prev.total_calls THEN
        v_cps := round((v_calls - v_prev.total_calls) / v_window_s, 2);
        v_mps := round((v_ms - v_prev.total_ms) / v_window_s, 1);
        WITH d AS (
          SELECT (cur.value ->> 0)::numeric - coalesce((prev.value ->> 0)::numeric, 0) AS dc,
                 (cur.value ->> 1)::numeric - coalesce((prev.value ->> 1)::numeric, 0) AS dm
            FROM jsonb_each(v_app) cur
            LEFT JOIN jsonb_each(v_prev.app_stats) prev ON prev.key = cur.key
        ), w AS (
          SELECT dm / dc AS mean_ms, dc,
                 sum(dc) OVER (ORDER BY dm / dc, dc) AS cum,
                 sum(dc) OVER () AS tot
            FROM d WHERE dc > 0 AND dm >= 0
        )
        SELECT round(min(mean_ms) FILTER (WHERE cum >= 0.95 * tot), 2), max(tot)
          INTO v_p95, v_wcalls
          FROM w;
      END IF;
    END IF;

    INSERT INTO public.db_saturation_state AS s (id, sampled_at, total_calls, total_ms, app_stats)
    VALUES (1, now(), v_calls, v_ms, v_app)
    ON CONFLICT (id) DO UPDATE SET sampled_at = EXCLUDED.sampled_at, total_calls = EXCLUDED.total_calls,
                                   total_ms = EXCLUDED.total_ms, app_stats = EXCLUDED.app_stats;
  END IF;

  v_signals := jsonb_build_object(
    'client_conns', v_client, 'max_conns', v_max, 'conn_pct', v_pct,
    'active_conns', v_active, 'longest_active_s', v_longest, 'idle_in_xact', v_iix,
    'window_s', round(v_window_s, 0), 'calls_per_s', v_cps, 'exec_ms_per_s', v_mps,
    'p95_ms', v_p95, 'window_app_calls', v_wcalls);
  v_problems := public.db_saturation_problems(v_signals);

  IF p_log_timeouts IS NOT NULL THEN
    v_rate := round(p_log_timeouts * 60.0 / greatest(coalesce(p_log_window_minutes, 60), 1), 1);
    IF v_rate >= (t ->> 'timeouts_per_hour')::numeric THEN
      v_log_prob := format('%s statement timeouts in the last %s min (%s/h >= %s/h)',
                           p_log_timeouts, coalesce(p_log_window_minutes, 60), v_rate, t ->> 'timeouts_per_hour');
    END IF;
  END IF;

  INSERT INTO public.db_saturation_samples
    (origin, client_conns, max_conns, conn_pct, active_conns, longest_active_s, idle_in_xact,
     window_s, calls_per_s, exec_ms_per_s, p95_ms, window_app_calls,
     log_timeouts, log_window_minutes, db_problems, log_problem)
  VALUES
    (v_origin, v_client, v_max, v_pct, v_active, v_longest, v_iix,
     round(v_window_s, 0), v_cps, v_mps, v_p95, v_wcalls,
     p_log_timeouts, CASE WHEN p_log_timeouts IS NOT NULL THEN coalesce(p_log_window_minutes, 60) END,
     v_problems, v_log_prob);

  DELETE FROM public.db_saturation_samples WHERE sampled_at < now() - interval '14 days';

  IF cardinality(v_problems) > 0 AND NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'db-saturation'
       AND e.created_at >= date_trunc('hour', now()))
  THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error',
            'Database saturation — ' || array_to_string(v_problems, '; ') || '. See docs/OPEN.md Q53.',
            jsonb_build_object('source', 'db-saturation', 'area', 'database'),
            v_signals);
  END IF;

  IF v_log_prob IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'db-statement-timeouts'
       AND e.created_at >= date_trunc('hour', now()))
  THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error',
            'Database statement timeouts — ' || v_log_prob || '. See docs/OPEN.md Q53.',
            jsonb_build_object('source', 'db-statement-timeouts', 'area', 'database'),
            v_signals || jsonb_build_object('log_timeouts', p_log_timeouts,
                                            'log_window_minutes', coalesce(p_log_window_minutes, 60)));
  END IF;

  RETURN v_signals || jsonb_build_object(
    'ok', cardinality(v_problems) = 0 AND v_log_prob IS NULL,
    'origin', v_origin, 'problems', to_jsonb(v_problems), 'log_problem', v_log_prob,
    'log_timeouts', p_log_timeouts, 'thresholds', t);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_error_log_throttle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $chk$
DECLARE
  v_min_minutes CONSTANT int := 2;    -- "sustained": drops in >= 2 minutes ...
  v_lookback    CONSTANT int := 10;   -- ... of the last 10 complete minutes
  v_now_min  timestamptz := date_trunc('minute', now());
  v_minutes  int;
  v_dropped  bigint;
  v_by_kind  jsonb;
  v_raised   boolean := false;
BEGIN
  SELECT count(DISTINCT d.minute), coalesce(sum(d.dropped), 0)
    INTO v_minutes, v_dropped
    FROM public.error_log_throttle_drops d
   WHERE d.minute >= v_now_min - make_interval(mins => v_lookback)
     AND d.minute < v_now_min;
  SELECT coalesce(jsonb_object_agg(drop_kind, n), '{}'::jsonb) INTO v_by_kind
    FROM (SELECT d.drop_kind, sum(d.dropped) n FROM public.error_log_throttle_drops d
           WHERE d.minute >= v_now_min - make_interval(mins => v_lookback)
             AND d.minute < v_now_min
           GROUP BY d.drop_kind) k;

  IF v_minutes >= v_min_minutes AND NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.created_at > now() - interval '15 minutes'
       AND jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'error-log-throttled')
  THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error',
            format('Client error logs throttled — %s rows dropped in %s of the last %s minutes (%s). See docs/OPEN.md Q113.',
                   v_dropped, v_minutes, v_lookback, v_by_kind::text),
            jsonb_build_object('source', 'error-log-throttled', 'area', 'observability'),
            jsonb_build_object('dropped', v_dropped, 'minutes', v_minutes, 'lookback_minutes', v_lookback,
                               'by_kind', v_by_kind));
    v_raised := true;
  END IF;

  DELETE FROM public.error_log_throttle_drops WHERE minute < now() - interval '14 days';

  RETURN jsonb_build_object('ok', v_minutes < v_min_minutes, 'dropped', v_dropped, 'minutes', v_minutes,
                            'lookback_minutes', v_lookback, 'by_kind', v_by_kind, 'raised', v_raised);
END;
$chk$;

CREATE OR REPLACE FUNCTION public.check_seed_boundary_failures()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_24h        bigint;
  v_newest     timestamptz;
  v_reported   timestamptz;
  v_sample     text;
  v_problem    text;
BEGIN
  SELECT count(*), max(l.created_at)
    INTO v_24h, v_newest
    FROM public.notification_logs l
   WHERE l.created_at > now() - interval '24 hours'
     AND l.error_message LIKE 'seed boundary check failed%';

  IF v_24h = 0 THEN
    RETURN jsonb_build_object('ok', true, 'failed_24h', 0);
  END IF;

  SELECT l.error_message INTO v_sample
    FROM public.notification_logs l
   WHERE l.created_at = v_newest
     AND l.error_message LIKE 'seed boundary check failed%'
   LIMIT 1;

  v_problem := format(
    'The seed-boundary check errored and dropped %s notification(s) in 24 hours — the check fails CLOSED, so real people may be missing notifications. Newest: %s. See docs/OPEN.md Q160.',
    v_24h, left(coalesce(v_sample, ''), 300));

  -- Report every failure that is newer than the last report: a fix that
  -- stops and a failure that returns later must both be seen.
  SELECT max(e.created_at) INTO v_reported
    FROM public.error_logs e
   WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND jsonb_typeof(e.tags) = 'object'
     AND e.tags ->> 'source' = 'seed-boundary-check-failed';

  IF v_reported IS NULL OR v_newest > v_reported THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', v_problem,
            jsonb_build_object('source', 'seed-boundary-check-failed', 'area', 'notifications'),
            jsonb_build_object('failed_24h', v_24h, 'newest', v_newest, 'sample', v_sample));
  END IF;

  RETURN jsonb_build_object('ok', false, 'problem', v_problem, 'failed_24h', v_24h, 'newest', v_newest);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_ops_alert_pending()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_folded  int := 0;
  v_left    bigint;
  v_stale   bigint;
  v_oldest  timestamptz;
  v_problem text;
BEGIN
  -- Fold first: the queue drains even while the GitHub hourly job is down.
  -- A fold error must not stop the check below from reporting.
  BEGIN
    v_folded := public.ops_alert_fold_pending();
  EXCEPTION WHEN OTHERS THEN
    -- Filed, not just warned: a fold that keeps failing is what this job watches for.
    PERFORM public.log_cron_defect(
      'check_ops_alert_pending', 'fold', SQLERRM,
      jsonb_build_object('phase', 'fold'));
  END;

  SELECT count(*), count(*) FILTER (WHERE queued_at < now() - interval '2 hours'), min(queued_at)
    INTO v_left, v_stale, v_oldest
    FROM public.ops_alert_pending;

  IF v_stale = 0 THEN
    RETURN jsonb_build_object('ok', true, 'folded', v_folded, 'queued', v_left, 'oldest', v_oldest);
  END IF;

  v_problem := format(
    'Ops alert ledger queue stuck — %s occurrence(s) still queued after 2h (oldest %s); they are not in the ledger. See docs/OPEN.md Q1(e).',
    v_stale, to_char(v_oldest AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI"Z"'));

  IF NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'ops-alert-pending-stale'
       AND e.created_at > date_trunc('day', now())
  ) THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', v_problem,
            jsonb_build_object('source', 'ops-alert-pending-stale', 'area', 'ops'),
            jsonb_build_object('queued', v_left, 'stale', v_stale, 'oldest', v_oldest, 'folded', v_folded));
  END IF;

  RETURN jsonb_build_object('ok', false, 'problem', v_problem, 'folded', v_folded,
                            'queued', v_left, 'stale', v_stale, 'oldest', v_oldest);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sweep_cron_startup_failures()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- A single stray failure is background noise (0-15/day across the week
  -- before the 09-22 incident). Three inside the window is not.
  v_window   CONSTANT interval := interval '20 minutes';
  v_floor    CONSTANT int := 3;
  v_failed   int := 0;
  v_startup  int := 0;
  v_jobs     text[];
  v_kinds    text[];
  v_since    timestamptz;
  v_last     timestamptz;
BEGIN
  -- pg_cron may not be installed (a from-scratch replay, PGlite). Nothing to
  -- look at is not a defect to report.
  IF to_regclass('cron.job_run_details') IS NULL
     OR to_regclass('public.error_logs') IS NULL THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'cron.job_run_details not present');
  END IF;

  -- Any run that ended badly. 'running'/'starting' are in flight, not failed.
  SELECT count(*),
         count(*) FILTER (WHERE d.return_message LIKE '%startup timeout%'),
         array_agg(DISTINCT j.jobname),
         array_agg(DISTINCT left(COALESCE(d.return_message, d.status), 60)),
         min(d.start_time)
    INTO v_failed, v_startup, v_jobs, v_kinds, v_since
    FROM cron.job_run_details d
    LEFT JOIN cron.job j ON j.jobid = d.jobid
   WHERE d.start_time > now() - v_window
     AND d.status = 'failed';

  IF COALESCE(v_failed, 0) < v_floor THEN
    RETURN jsonb_build_object('checked', true, 'failed', COALESCE(v_failed, 0), 'reported', false);
  END IF;

  -- Deduped on the window, not on a clock: while an incident is ongoing the
  -- page repeats at most once per window rather than once per failed run
  -- (457 rows would otherwise be 457 pages). 20260914183932 records what a
  -- looping alert costs — 616 rows in three days.
  SELECT max(created_at) INTO v_last
    FROM public.error_logs
   WHERE coalesce(tags ->> 'origin', '') <> 'client' AND tags ->> 'source' = 'cron-startup-timeout';

  IF v_last IS NOT NULL AND v_last > now() - v_window THEN
    RETURN jsonb_build_object('checked', true, 'failed', v_failed,
                              'reported', false, 'already_reported_at', v_last);
  END IF;

  -- 'fatal' on purpose. It is the documented general way into
  -- notify_slack_on_error_log(), and it deliberately does NOT rely on
  -- send_ops_daily_digest() — which is itself a cron. A cron outage must not
  -- be reported by a cron-delivered digest.
  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    'fatal',
    CASE WHEN v_startup = v_failed THEN
      format('pg_cron could not START %s scheduled run(s) in the last %s — "job startup timeout". These jobs did not run late, they did not run at all, and nothing retries them. Affected: %s.',
             v_failed, v_window, array_to_string(v_jobs[1:8], ', ') ||
               CASE WHEN array_length(v_jobs, 1) > 8 THEN format(' and %s more', array_length(v_jobs, 1) - 8) ELSE '' END)
    ELSE
      format('%s scheduled run(s) FAILED in the last %s across %s job(s) (%s of them startup timeouts). Failures: %s. Nothing retries a failed run. Affected: %s.',
             v_failed, v_window, array_length(v_jobs, 1), v_startup,
             array_to_string(v_kinds[1:4], ' | '),
             array_to_string(v_jobs[1:8], ', ') ||
               CASE WHEN array_length(v_jobs, 1) > 8 THEN format(' and %s more', array_length(v_jobs, 1) - 8) ELSE '' END)
    END,
    jsonb_build_object('source', 'cron-startup-timeout', 'area', 'cron'),
    jsonb_build_object('failed_runs',      v_failed,
                       'startup_timeouts', v_startup,
                       'window',           v_window::text,
                       'since',            v_since,
                       'kinds',            to_jsonb(v_kinds),
                       'jobs',             to_jsonb(v_jobs)));

  RETURN jsonb_build_object('checked', true, 'failed', v_failed, 'reported', true,
                            'jobs', to_jsonb(v_jobs), 'kinds', to_jsonb(v_kinds));
END;
$function$;

CREATE OR REPLACE FUNCTION public.sweep_email_dlqs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_watched CONSTANT jsonb := jsonb_build_array(
    jsonb_build_object('dlq', 'auth_emails_dlq',
                       'severity', 'fatal',
                       'source', 'email-dlq-auth',
                       'what', 'sign-in, signup confirmation and password-reset email'),
    jsonb_build_object('dlq', 'transactional_emails_dlq',
                       'severity', 'error',
                       'source', 'email-dlq-transactional',
                       'what', 'app notification email')
  );
  v_reported  int := 0;
  v_seen      jsonb := '[]'::jsonb;
  r           record;
  v_relname   text;
  v_depth     bigint;
  v_real      bigint;
  v_max_id    bigint;
  v_oldest    timestamptz;
  v_last_id   bigint;
  v_seed_only boolean;
BEGIN
  FOR r IN SELECT value ->> 'dlq'      AS dlq,
                  value ->> 'severity' AS severity,
                  value ->> 'source'   AS source,
                  value ->> 'what'     AS what
             FROM jsonb_array_elements(v_watched)
  LOOP
    v_relname := 'pgmq.q_' || r.dlq;

    IF to_regclass(v_relname) IS NULL THEN
      v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'skipped', 'no such queue');
      CONTINUE;
    END IF;

    -- v_real: dead letters to a recipient that is NOT a seed/test account.
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE NOT public.is_seed_email(message ->> %L)),
                           max(msg_id), min(enqueued_at) FROM %s', 'to', v_relname)
       INTO v_depth, v_real, v_max_id, v_oldest;

    IF COALESCE(v_depth, 0) = 0 THEN
      v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'depth', 0);
      CONTINUE;
    END IF;

    SELECT max((e.context ->> 'high_water_msg_id')::bigint)
      INTO v_last_id
      FROM public.error_logs e
     WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags ->> 'queue' = r.dlq
       AND e.tags ->> 'area'  = 'email-dlq'
       AND e.context ? 'high_water_msg_id';

    IF v_last_id IS NOT NULL AND v_last_id >= v_max_id THEN
      v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'depth', v_depth,
                                             'already_reported_through', v_last_id);
      CONTINUE;
    END IF;

    -- Only test accounts' mail: the digest, never a page (is_seed profiles).
    v_seed_only := COALESCE(v_real, 0) = 0;

    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      CASE WHEN v_seed_only THEN 'info' ELSE r.severity END,
      format('%s message(s) in the %s dead-letter queue (%s to real recipients) — %s that will never be delivered and that nothing retries. Oldest queued %s UTC.',
             v_depth, r.dlq, COALESCE(v_real, 0), r.what,
             to_char(v_oldest AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')),
      jsonb_build_object('source', CASE WHEN v_seed_only THEN r.source || '-seed' ELSE r.source END,
                         'area', 'email-dlq', 'queue', r.dlq)
        || CASE WHEN v_seed_only THEN jsonb_build_object('seed', true) ELSE '{}'::jsonb END,
      jsonb_build_object('depth',              v_depth,
                         'real_recipients',    v_real,
                         'high_water_msg_id',  v_max_id,
                         'previously_reported_through', v_last_id,
                         'new_since_last_alert', CASE WHEN v_last_id IS NULL THEN v_depth END,
                         'oldest_enqueued_at',  v_oldest,
                         'queue',               r.dlq));

    v_reported := v_reported + 1;
    v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'depth', v_depth,
                                           'real_recipients', v_real,
                                           'reported_through', v_max_id,
                                           'severity', CASE WHEN v_seed_only THEN 'info' ELSE r.severity END);
  END LOOP;

  RETURN jsonb_build_object('reported', v_reported, 'queues', v_seen);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sweep_disputes_closed_without_payment()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reported int   := 0;
  v_seen     jsonb := '[]'::jsonb;
  r          record;
BEGIN
  -- A from-scratch replay (PGlite, a fresh branch) may not have these yet.
  -- Nothing to look at is not a defect to report.
  IF to_regclass('public.disputes') IS NULL
     OR to_regclass('public.jobs') IS NULL
     OR to_regclass('public.error_logs') IS NULL THEN
    RETURN jsonb_build_object('reported', 0, 'skipped', 'tables not present');
  END IF;

  FOR r IN
    SELECT d.id                AS dispute_id,
           d.job_id            AS job_id,
           d.payout_split      AS payout_split,
           d.decided_at        AS decided_at,
           j.payment_status    AS payment_status,
           j.status            AS job_status,
           COALESCE(j.is_seed, false) AS is_seed
      FROM public.disputes d
      JOIN public.jobs j ON j.id = d.job_id
     WHERE d.execution_status = 'executed'
       -- Moved nothing, by any route, and said nothing about why.
       AND d.execution_transfer_id IS NULL
       AND d.execution_refund_id   IS NULL
       AND COALESCE(d.execution_helper_cents, 0) = 0
       AND COALESCE(d.execution_refund_cents, 0) = 0
       AND d.execution_error IS NULL
       -- The funds are still held. A job already refunded or paid out is
       -- settled by some other path and is not owed anything here.
       AND j.payment_status IN ('escrow', 'payout_pending')
       -- Q396(c), 20260927012240: a CREW whose dispute closed (resolved /
       -- auto_resolved) is paid by process-scheduled-payouts' fan-out, so it
       -- is not a strand; a single-Helpr job still is (that cron still
       -- excludes it), and stays watched.
       AND NOT (j.is_group_job IS TRUE AND j.dispute_status IN ('resolved', 'auto_resolved'))
       -- Never reported before. The dedupe.
       AND NOT EXISTS (
             SELECT 1
               FROM public.error_logs e
              WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags ->> 'area' = 'dispute-unsettled'
                AND e.context ->> 'dispute_id' = d.id::text)
     ORDER BY d.decided_at NULLS LAST
       -- THE ROW LOCK, added 2026-09-22 after this function tripped
       -- scripts/check-race-class.mjs and made race-runner red (#1643).
       --
       -- The guard's shape is exact and this matched it: read public.jobs
       -- WITHOUT a lock, make a decision (the IF below), write somewhere other
       -- than jobs (error_logs). It exists because two money bugs came from
       -- that shape — applications landing on a cancelled job, and a payout
       -- cron charging 25% on one.
       --
       -- Here the damage is smaller but real, and it STICKS: release-payout
       -- can settle a dispute between this SELECT and the INSERT, and the row
       -- would be reported as unpaid forever — the dedupe is on dispute id, so
       -- a false page is never re-evaluated.
       --
       -- `OF j` locks only the jobs rows, not disputes. FOR SHARE, not FOR
       -- UPDATE: this function never writes to jobs and must never block a
       -- settlement any longer than reading it takes.
       FOR SHARE OF j
  LOOP
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      CASE WHEN r.is_seed THEN 'error' ELSE 'fatal' END,
      format('Dispute %s on job %s is marked executed but moved no money: no transfer, no refund, no cents, no error. The job has been %s since %s UTC and neither process-scheduled-payouts (excluded by disputed_at) nor claim_dispute_settlement (excluded by execution_status) will ever pay it. Split %s. Only a manual release-payout can settle it.',
             left(r.dispute_id::text, 8),
             left(r.job_id::text, 8),
             r.payment_status,
             to_char(r.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
             COALESCE(r.payout_split::text, 'unrecorded')),
      jsonb_build_object('source', CASE WHEN r.is_seed
                                        THEN 'dispute-unsettled-seed'
                                        ELSE 'dispute-unsettled' END,
                         'area', 'dispute-unsettled'),
      jsonb_build_object('dispute_id',     r.dispute_id,
                         'job_id',         r.job_id,
                         'payout_split',   r.payout_split,
                         'payment_status', r.payment_status,
                         'job_status',     r.job_status,
                         'decided_at',     r.decided_at,
                         'is_seed',        r.is_seed));

    v_reported := v_reported + 1;
    v_seen := v_seen || jsonb_build_object('dispute_id', r.dispute_id,
                                           'job_id',     r.job_id,
                                           'is_seed',    r.is_seed,
                                           'severity',   CASE WHEN r.is_seed
                                                              THEN 'error' ELSE 'fatal' END);
  END LOOP;

  RETURN jsonb_build_object('reported', v_reported, 'disputes', v_seen);
END;
$fn$;
