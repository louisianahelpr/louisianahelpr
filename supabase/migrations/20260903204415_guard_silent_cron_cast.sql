-- The silent-cron detector has been crashing on its own registry since
-- 2026-09-01, and the crash erased the evidence of three other crons.
--
-- `sweep_silent_cron_failures` casts `body ->> candidate_key` to numeric with
-- no check that the value IS a number. `money-reconciliation`'s registered
-- candidate_key is `scanned`, whose value is an OBJECT
-- (`{"jobs":3,"pages":2,"server_totals":{...},"payout_transfers":2}`), so the
-- cast raises 22P02 and aborts the whole function.
--
-- The damage is not the crash. Ingest and detection share one transaction, so
-- the rollback also discards that run's `cron_run_log` ingest, and the ingest
-- only looks back six hours. Observed on prod: the sweep failed at 08:47,
-- 09:47, 10:47, 11:47, 12:47 and 13:47; the last clean run before that was
-- 07:47 and the first clean run after was 14:47, whose window starts at 08:47.
-- Everything created 07:47-08:47 therefore fell outside every window that will
-- ever run again, and pg_net ages the source rows out at six hours. Three crons
-- fire in that hour and none of them has been recorded since 2026-09-01:
-- expire-subscriptions (08:09), money-reconciliation (08:20) and
-- subscription-reconciliation (08:24). The two reconcilers have zero rows
-- all-time. `error_logs` has never held a single `cron-silent` verdict.
--
-- Two independent defects, so two independent fixes.

-- 1. THE CLASS. Never let a non-numeric registry value crash the detector
-- again. The filter goes in `runs`, not in a coercing CASE around the cast: a
-- COALESCE-to-0 would silently reclassify the job as "found no candidates",
-- which is indistinguishable from healthy and is exactly the false negative
-- this function exists to prevent. Excluded rows are excluded loudly — they
-- simply do not participate, and the job's liveness check still covers it.
-- The disposition sum gets the same treatment for the same reason.
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
   WHERE resp.created > now() - interval '6 hours'
     AND resp.content::text ~ '"fn"\s*:\s*"'
  ON CONFLICT (response_id) DO NOTHING;

  GET DIAGNOSTICS v_recorded = ROW_COUNT;

  -- Fill in the parsed body separately so a malformed one cannot abort the
  -- whole INSERT above.
  FOR r IN
    SELECT l.id, resp.content::text AS raw
      FROM public.cron_run_log l
      JOIN net._http_response resp ON resp.id = l.response_id
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
    )
    -- The streak is counted from the MOST RECENT run backwards: every row
    -- before the first non-suspicious one. Anchoring it there is what stops a
    -- cron that broke last week and has since recovered from paging today.
    SELECT m.jobname,
           m.min_streak,
           m.note,
           count(*) FILTER (
             WHERE m.rn < COALESCE(
               (SELECT min(m2.rn) FROM marked m2
                 WHERE m2.jobname = m.jobname AND NOT m2.suspicious),
               2147483647)
           ) AS streak,
           max(m.candidates) FILTER (WHERE m.rn = 1) AS latest_candidates
      FROM marked m
     GROUP BY m.jobname, m.min_streak, m.note
    HAVING count(*) FILTER (
             WHERE m.rn < COALESCE(
               (SELECT min(m2.rn) FROM marked m2
                 WHERE m2.jobname = m.jobname AND NOT m2.suspicious),
               2147483647)
           ) >= m.min_streak
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
        jsonb_build_object('source', 'cron-silent', 'area', 'cron', 'job', r.jobname),
        jsonb_build_object('streak', r.streak,
                           'latest_candidates', r.latest_candidates,
                           'why', r.note));
      v_flagged := v_flagged + 1;
      v_names := v_names || r.jobname;
    END IF;
  END LOOP;

  IF v_flagged > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s cron(s) running green while doing nothing', v_flagged),
          'message', format('Affected: %s. These returned 2xx. See error_logs (tags.source = cron-silent).',
                            array_to_string(v_names, ', ')),
          'severity', 'error'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('recorded', v_recorded,
                            'flagged',  v_flagged,
                            'jobs',     to_jsonb(v_names));
END;
$function$;

-- 2. THE INSTANCE. `money-reconciliation` was never a candidate for the
-- silent-work rule and registering it as one was a category error, quite apart
-- from the crash.
--
-- It is a REPORTER, not a worker: it scans, it records findings, and by
-- explicit design (see the header of supabase/functions/money-reconciliation)
-- it never repairs what it finds. Its `disposition_keys` is empty and correctly
-- so -- there is no disposition. But the rule flags any run where
-- `candidates > 0 AND sum(dispositions) = 0`, and an empty disposition array
-- sums to 0 unconditionally. So merely making the cast survive would not have
-- made this row correct; it would have converted a daily CRASH into a daily
-- FALSE PAGE, forever, on the money lane. The alert everyone learns to ignore
-- is worse than the one that never fires.
--
-- There is also no key that could be registered instead: `scanned` is the only
-- count and it is nested, while the detector reads flat keys only.
--
-- So: liveness-only, which is what the other 22 SQL crons and `marketing-publish`
-- already are. `expected_max_gap` is unchanged, so a money-reconciliation that
-- stops firing is still caught by `sweep_dead_crons` within 30 hours.
UPDATE public.cron_work_expectations
   SET candidate_key = NULL,
       note = 'Reconciler, not a worker: it reports discrepancies and deliberately never repairs them, so it has no disposition keys and "scanned > 0, disposed 0" is its correct steady state rather than a defect. Registered for LIVENESS only. Its `scanned` value is also an object, which crashed the detector daily until 20260903204415.'
 WHERE jobname = 'money-reconciliation';
