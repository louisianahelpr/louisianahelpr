-- Make "did pg_cron actually dispatch this?" an answerable question.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE INVESTIGATION THIS FILE COMES OUT OF
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The standing report was: `money-reconciliation` has NEVER completed a single
-- run. Zero rows in `cron_run_log` against 2,493 rows for everything else, one
-- pg_net timeout in `error_logs` on 2026-08-28, and nothing since. Scheduled at
-- 08:20 daily by 20260828230000, deployed, answering OPTIONS 200.
--
-- Measured against prod on 2026-09-02, that is NOT what happened. The job has
-- been dispatching. It was INVISIBLE, for two independent reasons that stack:
--
--   1. UNTIL 2026-08-31 IT DID NOT NAME ITSELF.
--      `sweep_silent_cron_failures()` ingests `net._http_response` rows whose
--      body matches `"fn"\s*:\s*"`, and nothing else. money-reconciliation
--      answered with a bare `new Response(JSON.stringify(summary))` that
--      carried no `fn` key, so every successful run was ingested by nothing and
--      recorded nowhere. `sweep_cron_http_failures()` did not see it either:
--      that one only reads NON-2xx and timed-out responses, and a clean 200 is
--      neither. A daily job answering 200 with an unlabelled body is invisible
--      to BOTH watchers simultaneously — which is precisely the state it was
--      in. Commit 836c3822 (2026-08-31 19:55 UTC) moved it onto `cronResult`
--      and gave it the `fn` key.
--
--   2. ITS FIRST FIRING AFTER THAT FIX LANDED IN A TOTAL CRON BLACKOUT.
--      08:20 UTC on 2026-09-01 was the first 08:20 with the `fn` key deployed.
--      Between 07:43 and 08:48 UTC that day, pg_cron dispatched NOTHING AT ALL.
--      Not auto-expire-jobs at 08:00, not auto-release-payment at 08:05, not
--      expire-subscriptions at 08:09, not void-cancelled-payments at 08:10, not
--      money-reconciliation at 08:20. `process-email-queue` runs every five
--      minutes and shows a single 65-minute hole there — the ONLY multi-run gap
--      in the entire seven days `cron_run_log` retains; every other gap in that
--      window is exactly one 5-minute slot.
--
-- So the alarm read as "this job has never once run" when the truth was "this
-- job has never once been RECORDED", and the two are indistinguishable from
-- every table this project has. That is the same failure the whole cron-watcher
-- family exists to end, reproduced one level up: absence of evidence presented
-- as evidence of absence.
--
-- 20260901030926 already made the right structural move — liveness now reads
-- `cron.job_run_details` (did it FIRE) instead of `cron_run_log` (did it
-- ANSWER). This file closes the two gaps that survived it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- GAP 1: nobody outside the database can read cron.job_run_details
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260831190419 had to reconstruct thirteen cron commands from first
-- principles and wrote down why: "cron.job is not exposed to PostgREST and this
-- workspace has no Supabase management token, so the live command text could
-- not be read." Every investigation into a suspect cron since has hit the same
-- wall and has had to infer dispatch from the side effects of dispatch — which
-- is exactly the inference that got money-reconciliation wrong.
--
-- `cron_dispatch_health()` below is read-only and answers it directly.

CREATE OR REPLACE FUNCTION public.cron_dispatch_health()
RETURNS TABLE(
  jobname          text,
  schedule         text,
  active           boolean,
  runs_total       bigint,
  last_start       timestamptz,
  last_end         timestamptz,
  last_status      text,
  last_message     text,
  recent_failures  bigint,
  expected_max_gap interval,
  registered_at    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- A from-scratch rebuild may not have pg_cron yet. Answer empty rather than
  -- raising: a diagnostic that throws is one more thing to diagnose.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- FULL JOIN, deliberately. A job present in cron.job but with no registered
  -- expectation is an undeclared cron; an expectation with no cron.job row is a
  -- job that a migration promised and the database does not have. Both are
  -- findings, and an inner join hides both.
  SELECT COALESCE(j.jobname, c.jobname)::text,
         j.schedule::text,
         j.active,
         COALESCE(d.runs_total, 0),
         d.last_start,
         d.last_end,
         d.last_status::text,
         left(COALESCE(d.last_message, ''), 300)::text,
         COALESCE(d.recent_failures, 0),
         c.expected_max_gap,
         c.registered_at
    FROM cron.job j
    FULL JOIN public.cron_work_expectations c ON c.jobname = j.jobname
    LEFT JOIN LATERAL (
      SELECT count(*)                                             AS runs_total,
             max(x.start_time)                                    AS last_start,
             max(x.end_time)                                      AS last_end,
             (array_agg(x.status ORDER BY x.start_time DESC))[1]   AS last_status,
             (array_agg(x.return_message ORDER BY x.start_time DESC))[1] AS last_message,
             count(*) FILTER (
               WHERE x.status <> 'succeeded'
                 AND x.start_time > now() - interval '24 hours')  AS recent_failures
        FROM cron.job_run_details x
       WHERE x.jobid = j.jobid
    ) d ON true
   ORDER BY 1;
END;
$fn$;

COMMENT ON FUNCTION public.cron_dispatch_health() IS
  'Read-only join of cron.job, cron.job_run_details and cron_work_expectations. Answers "did pg_cron dispatch this, when, and what happened" without a management token — the question 20260831190419 recorded as unanswerable from a workspace.';

-- Operators only. It exposes every scheduled job and its failure text, which is
-- infrastructure detail no product surface needs and no end user should read.
REVOKE ALL ON FUNCTION public.cron_dispatch_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_dispatch_health() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_dispatch_health() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- GAP 2: a total pg_cron blackout is under every per-job tolerance
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Nothing noticed the 65-minute outage on 2026-09-01, and nothing could have.
-- `sweep_dead_crons()` grades each job against its own tolerance, and the
-- tightest tolerance in `cron_work_expectations` is 30 MINUTES
-- (sweep-pending-broadcast-fan-outs); every money cron is at 3 hours and every
-- daily job at 30. A blackout that swallows every escrow, payout and email cron
-- in the product for an hour is quietly inside all of them. It is only visible
-- as a shape ACROSS jobs — no job fired, for an hour — and nothing looked at
-- that shape.
--
-- This does. `cron.job_run_details` carries every firing of every job, and with
-- sweep-pending-broadcast-fan-outs on `* * * * *` the aggregate dispatch stream
-- should never be quiet for more than about a minute. A 15-minute floor is
-- therefore fifteen times the expected quiet period: far too coarse to fire on
-- ordinary jitter, far too tight for an outage to hide under.
--
-- It reports AFTER recovery, necessarily — it is itself a cron, so it cannot
-- speak during its own outage. That is fine and is the point: the failure mode
-- being fixed is that a blackout left no trace at all once it ended.
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
  v_flagged   int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN jsonb_build_object('flagged', 0, 'skipped', 'pg_cron not installed');
  END IF;

  -- The largest hole in the aggregate dispatch stream over the last day. One
  -- row per firing of any job, ordered, differenced.
  SELECT g.prev_start, g.start_time,
         extract(epoch FROM (g.start_time - g.prev_start)) / 60
    INTO v_gap_start, v_gap_end, v_minutes
    FROM (
      SELECT d.start_time,
             lag(d.start_time) OVER (ORDER BY d.start_time) AS prev_start
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '24 hours'
    ) g
   WHERE g.prev_start IS NOT NULL
   ORDER BY (g.start_time - g.prev_start) DESC
   LIMIT 1;

  IF v_minutes IS NULL OR v_minutes < 15 THEN
    RETURN jsonb_build_object('flagged', 0,
                              'largest_gap_minutes', COALESCE(round(v_minutes, 1), 0));
  END IF;

  -- Keyed on the gap's own start instant, not on the day: two blackouts in one
  -- day are two findings, and re-running the sweep over the same gap is not.
  IF EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE e.tags->>'source' = 'cron-blackout'
       AND e.context->>'gap_start' = v_gap_start::text
  ) THEN
    RETURN jsonb_build_object('flagged', 0, 'already_reported', v_gap_start);
  END IF;

  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    'error',
    format('pg_cron dispatched nothing for %s minutes (%s → %s) — every scheduled job in the product was silent',
           round(v_minutes, 1), v_gap_start, v_gap_end),
    jsonb_build_object('source', 'cron-blackout', 'area', 'cron'),
    jsonb_build_object('gap_start',   v_gap_start,
                       'gap_end',     v_gap_end,
                       'gap_minutes', round(v_minutes, 1)));
  v_flagged := 1;

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'title', format('pg_cron was silent for %s minutes', round(v_minutes, 1)),
        'message', format('No scheduled job of any kind fired between %s and %s. Escrow, payout and email crons were all affected. See error_logs (tags.source = cron-blackout).',
                          v_gap_start, v_gap_end),
        'severity', 'error'));
  EXCEPTION WHEN OTHERS THEN
    -- error_logs is the durable record; Slack is the notification. Never let a
    -- failed delivery take the sweep down with it.
    NULL;
  END;

  RETURN jsonb_build_object('flagged', v_flagged,
                            'gap_start', v_gap_start,
                            'gap_minutes', round(v_minutes, 1));
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_cron_blackouts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_cron_blackouts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_cron_blackouts() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- GAP 3: the ingest window has no margin, so an outage ERASES history
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `sweep_silent_cron_failures()` is scheduled `47 * * * *` and ingests
-- `net._http_response` rows `created > now() - interval '60 minutes'`. Hourly
-- schedule, sixty-minute window: the margin is exactly zero. Miss one run and
-- the next one's window starts where the missed one's would have ended, so an
-- hour of responses is never ingested by anything — and pg_net prunes
-- `net._http_response` after roughly six hours, so it is gone permanently.
--
-- That is not hypothetical either. It is the second half of the
-- money-reconciliation story above: the 07:43–08:48 blackout swallowed the
-- 08:47 sweep, and the 09:47 sweep looked back only to 08:47. Even if the 08:20
-- response had arrived late, no sweep would ever have read it.
--
-- Six hours matches pg_net's own retention — the widest window that can still
-- find anything. It costs nothing to widen: the ingest is
-- `ON CONFLICT (response_id) DO NOTHING`, so re-reading the overlap is a no-op
-- by construction, and the file's own header already relies on that ("The
-- overlap is deliberate and harmless"). It just did not take its own advice far
-- enough. With six hours, five consecutive missed sweeps still lose nothing.
--
-- `sweep_cron_http_failures()` is deliberately NOT touched: it runs `*/15` with
-- the same 60-minute lookback, which is four times its period, and it already
-- survives three consecutive misses. The defect is the ratio, not the number.
--
-- The body below is copied VERBATIM from 20260829020000 so it diffs cleanly
-- against the original. Two lines differ:
--
--   * `interval '60 minutes'` → `interval '6 hours'` in the 3a ingest. This is
--     the fix.
--   * `AND c.candidate_key IS NOT NULL` added to the 3b `runs` CTE. This one
--     changes NO behaviour and is written down rather than left implicit:
--     20260901030926 made `candidate_key` nullable for liveness-only rows, and
--     `l.body ? NULL` evaluates to NULL rather than true, so those rows were
--     already excluded — by an SQL three-valued-logic accident rather than by
--     anything a reader could see. Sixteen of the 41 expectation rows are now
--     liveness-only, so the accident carries real weight; saying it out loud
--     means a future edit cannot break it by "simplifying" the predicate.

CREATE OR REPLACE FUNCTION public.sweep_silent_cron_failures()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_recorded int := 0;
  v_flagged  int := 0;
  v_names    text[] := ARRAY[]::text[];
  r          record;
BEGIN
  -- 3a. Ingest. Only rows whose body actually names its function are kept:
  -- without `fn` there is no trustworthy way to say which cron a body belongs
  -- to (see 20260828030000 — proximity guessed wrong 3 times in 4), and a
  -- streak counted against the wrong cron is worse than no streak at all.
  -- Body is left empty here and parsed in the loop below: a cast inside this
  -- set-returning INSERT would abort the entire ingest on one truncated or
  -- non-JSON body.
  --
  -- SIX HOURS, not sixty minutes — pg_net's own retention. See this migration's
  -- header: an hourly sweep with an hourly window loses an hour of history
  -- permanently for every run it misses, and it missed one.
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
    ),
    marked AS (
      SELECT r0.jobname, r0.rn, r0.min_streak, r0.note,
             COALESCE((r0.body ->> r0.candidate_key)::numeric, 0) AS candidates,
             (COALESCE((r0.body ->> r0.candidate_key)::numeric, 0) > 0
              AND (SELECT COALESCE(sum(COALESCE((r0.body ->> k)::numeric, 0)), 0)
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
$fn$;

REVOKE ALL ON FUNCTION public.sweep_silent_cron_failures() FROM PUBLIC, anon, authenticated;

-- ── Schedule the blackout sweep ────────────────────────────────────────────
--
-- :57, hourly. A free minute in 20260829010000's map and clear of the other two
-- SQL watchers (:47 sweep-silent-cron-failures, :53 sweep-dead-crons), so the
-- three never contend. Hourly is right for a detector that reports on a
-- 24-hour lookback and dedupes on the gap instant: it cannot miss a blackout it
-- can still see, and it cannot report one twice.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping sweep-cron-blackouts';
    RETURN;
  END IF;

  PERFORM cron.unschedule('sweep-cron-blackouts')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-cron-blackouts');

  PERFORM cron.schedule('sweep-cron-blackouts', '57 * * * *',
    $cron$SELECT public.sweep_cron_blackouts();$cron$);
END;
$$;

-- Liveness for the new sweep, on the same terms as every other cron
-- (20260901030926). Guarded so migration order cannot break a replay.
DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap)
  VALUES ('sweep-cron-blackouts', interval '3 hours')
  ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
END;
$$;
