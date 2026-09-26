-- Q397: run_missed_cron_catch_up() (cron-missed-slot-catch-up, every 10
-- minutes) cost ~288 ms per call (pg_stat_statements 2026-09-25: 291 calls,
-- mean 287.5 ms). Its candidate query ran FIVE subqueries correlated on jobid
-- over cron.job_run_details for every due job: the newest run since the slot
-- (last_failure), "a run since the slot succeeded or is running", "the run AT
-- the slot failed", "it ran before the slot", "it ran one period earlier".
-- That table has no index but its runid key and pg_cron's owner
-- (supabase_admin) holds it, so no migration can add one: every subquery is a
-- full scan of the run history, per job.
--
-- The due jobs (active, daily/weekly, slot past grace and inside its period)
-- are now joined to the run history ONCE (hist), and each of the five facts is
-- the same predicate, with the same bounds, as an aggregate FILTER over that
-- one pass. count(*) FILTER (...) > 0 is EXISTS (a NULL start_time or status
-- fails both the same way); a due job with no runs at all has no hist row and
-- every fact coalesces to false / NULL, as the EXISTS / scalar subqueries did.
-- The ORDER BY gains jobid as a tie-break (two jobs on the same slot were in
-- plan order before; which 3 run first is now repeatable), and last_failure
-- gains runid DESC as a tie-break for two runs with the same start_time.
-- Everything else in the body is 20260923172145's, unchanged: the same pattern
-- 20260925140304 applied to sweep_dead_crons.
--
-- Proof: src/test/pglite/cronCatchUpOneScan.pglite.mjs runs the previous body
-- and this one on the same fixtures (never ran, ran late, a slot missed twice,
-- a disabled job, a changed schedule, plus a randomized history around every
-- boundary) and requires the same decisions, alerts and runs.
-- Guard: src/test/cronRunHistoryScannedOnce.test.ts (run_missed_cron_catch_up
-- left its KNOWN_CORRELATED entry here).
--
-- Replay-safe: CREATE OR REPLACE of a function whose tables all come from
-- earlier migrations (20260923133021, 20260923163407, 20260923170422).

-- ── run_missed_cron_catch_up: 20260923172145's, candidates read in one pass ─
CREATE OR REPLACE FUNCTION public.run_missed_cron_catch_up()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_grace    CONSTANT interval := interval '10 minutes';
  v_max_runs CONSTANT int := 3;
  v_tz       text := coalesce(current_setting('cron.timezone', true), 'GMT');
  v_failed   int;
  v_ok       int;
  v_healthy  boolean;
  v_ran      int := 0;
  v_waiting  int := 0;
  v_claimed  int;
  v_action   text;
  v_detail   text;
  v_decided  jsonb := '[]'::jsonb;
  -- Q207(3): the lock_timeout a job gets when pg_cron runs it (the session's).
  v_job_lock_timeout text := current_setting('lock_timeout');
  -- Q207(4): set once a job was cancelled (statement_timeout). Postgres does
  -- not re-arm that timer inside this statement, so nothing else runs.
  v_cancelled boolean := false;
  -- Q207(2): the pg_net request id a caught-up HTTP job's command tagged.
  v_request_id bigint;
  r          record;
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regclass('cron.job_run_details') IS NULL THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'pg_cron not present');
  END IF;
  -- Slot arithmetic is UTC. A different pg_cron timezone would make every
  -- slot wrong, so do nothing rather than re-run at the wrong time.
  IF v_tz NOT IN ('GMT', 'UTC', 'Etc/UTC', 'Etc/GMT') THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'cron.timezone is ' || v_tz || ', not UTC');
  END IF;
  -- One instance at a time, and never queue behind another.
  IF NOT pg_try_advisory_xact_lock(hashtext('public.run_missed_cron_catch_up')) THEN
    RETURN jsonb_build_object('checked', true, 'busy', true);
  END IF;
  -- Q207(1): remember since when each job has been ACTIVE on its CURRENT
  -- schedule. Keyed by jobid (jobname is only unique per user); a changed
  -- schedule or a pause restarts 'since' (a resumed job's first slot is not a
  -- missed one). Only this function writes the table, under the lock.
  INSERT INTO public.cron_catchup_schedules (jobid, jobname, schedule, active, since)
  SELECT j.jobid, j.jobname, j.schedule, j.active, now() FROM cron.job j
  ON CONFLICT (jobid) DO UPDATE
    SET jobname = EXCLUDED.jobname, schedule = EXCLUDED.schedule,
        active = EXCLUDED.active, since = now()
    WHERE public.cron_catchup_schedules.schedule IS DISTINCT FROM EXCLUDED.schedule
       OR public.cron_catchup_schedules.active IS DISTINCT FROM EXCLUDED.active;
  PERFORM set_config('lock_timeout', '200ms', true);

  SELECT count(*) FILTER (WHERE d.status = 'failed'),
         count(*) FILTER (WHERE d.status = 'succeeded')
    INTO v_failed, v_ok
    FROM cron.job_run_details d
   WHERE d.start_time > now() - interval '15 minutes';
  v_healthy := v_failed < 3 AND v_ok >= 1;

  FOR r IN
    -- Q397: the run history is read in ONE pass (hist), not by five
    -- subqueries per job. Each fact below is the old query's per-job
    -- subquery, same bounds, as a FILTER over that pass.
    WITH due AS (
      SELECT j.jobid, j.jobname, j.command, j.username, j.database, j.schedule,
             s.slot, s.period
        FROM cron.job j
       CROSS JOIN LATERAL public.cron_catchup_last_slot(j.schedule, now()) s
       WHERE j.active
         AND j.jobname <> 'cron-missed-slot-catch-up'
         AND now() - s.slot >= v_grace
         AND now() - s.slot <  s.period
    ),
    hist AS (
      SELECT u.jobid,
             -- the newest run at or after the slot (what it said, or its status)
             (array_agg(left(coalesce(d.return_message, d.status), 120)
                        ORDER BY d.start_time DESC, d.runid DESC)
                FILTER (WHERE d.start_time >= u.slot - interval '1 minute'))[1] AS last_failure,
             -- a run at or after the slot succeeded or is still going
             count(*) FILTER (WHERE d.start_time >= u.slot - interval '1 minute'
                                AND d.status IN ('succeeded', 'running', 'starting')) > 0 AS ok_since_slot,
             -- pg_cron started it AT this slot, and that run failed
             count(*) FILTER (WHERE d.start_time >= u.slot - interval '1 minute'
                                AND d.start_time <  u.slot + v_grace
                                AND d.status = 'failed') > 0 AS failed_at_slot,
             -- it ran at all before this slot
             count(*) FILTER (WHERE d.start_time < u.slot - interval '1 minute') > 0 AS ran_before,
             -- it ran one period earlier (so it was on this schedule then)
             count(*) FILTER (WHERE d.start_time >= u.slot - u.period - interval '1 minute'
                                AND d.start_time <  u.slot - u.period + v_grace) > 0 AS ran_prev_slot
        FROM due u
        JOIN cron.job_run_details d ON d.jobid = u.jobid
       GROUP BY u.jobid
    )
    SELECT u.jobid, u.jobname, u.command, u.username, u.database,
           u.slot, u.period, p.catch_up, p.max_late, p.reason,
           h.last_failure
      FROM due u
      LEFT JOIN hist h ON h.jobid = u.jobid
      LEFT JOIN public.cron_catchup_policy p ON p.jobname = u.jobname
     WHERE NOT EXISTS (SELECT 1 FROM public.cron_catchup_runs c
                        WHERE c.jobname = u.jobname AND c.slot = u.slot)
       AND NOT coalesce(h.ok_since_slot, false)
       -- Q207(1): proof the job was on THIS schedule at the slot, so a
       -- rescheduled job's new time is never taken for a missed slot.
       AND (-- pg_cron started it AT this slot, and that run failed;
            coalesce(h.failed_at_slot, false)
            -- or it ran before, AND on this schedule: seen on it by a tick at
            -- or before the slot, or run (or caught up) one period earlier.
            OR (coalesce(h.ran_before, false)
                AND (EXISTS (SELECT 1 FROM public.cron_catchup_schedules cs
                              WHERE cs.jobid = u.jobid AND cs.schedule = u.schedule
                                AND cs.since <= u.slot)
                     OR coalesce(h.ran_prev_slot, false)
                     OR EXISTS (SELECT 1 FROM public.cron_catchup_runs c
                                 WHERE c.jobname = u.jobname AND c.slot = u.slot - u.period))))
     -- jobid breaks a tie between two jobs on the same slot (the old query
     -- left it to the plan), so which 3 run first is repeatable.
     ORDER BY u.slot, u.jobid
  LOOP
    v_detail := NULL;
    v_request_id := NULL;
    IF r.catch_up IS NULL THEN
      v_action := 'alerted_unclassified';
    ELSIF r.catch_up IS NOT TRUE THEN
      v_action := 'alerted_unsafe';
    ELSIF r.username IS DISTINCT FROM current_user OR r.database IS DISTINCT FROM current_database() THEN
      v_action := 'alerted_unsafe';
      v_detail := format('runs as %s on %s, not as %s on %s', r.username, r.database, current_user, current_database());
    ELSIF now() - r.slot > r.max_late THEN
      v_action := 'alerted_too_late';
    ELSIF NOT v_healthy OR v_ran >= v_max_runs OR v_cancelled THEN
      -- Not now; asked again next tick, while still inside max_late.
      v_waiting := v_waiting + 1;
      CONTINUE;
    ELSE
      v_action := 'caught_up';
    END IF;

    -- The claim: one row per (job, slot), ever. Written before the command,
    -- in the same transaction, so a slot is never tried twice.
    BEGIN
      INSERT INTO public.cron_catchup_runs (jobname, slot, action, detail)
      VALUES (r.jobname, r.slot, v_action, v_detail)
      ON CONFLICT (jobname, slot) DO NOTHING;
      GET DIAGNOSTICS v_claimed = ROW_COUNT;
    EXCEPTION WHEN lock_not_available THEN
      v_claimed := 0;
    END;
    IF v_claimed = 0 THEN CONTINUE; END IF;

    IF v_action = 'caught_up' THEN
      v_ran := v_ran + 1;
      BEGIN
        -- Q207(3): the job runs with its normal lock_timeout, not the tick's
        -- 200ms; set back to 200ms right after this block (on an error the
        -- sub-block's rollback also undoes this SET LOCAL).
        PERFORM set_config('lock_timeout', v_job_lock_timeout, true);
        EXECUTE regexp_replace(r.command, ';\s*$', '');
      -- Q207(4): OTHERS does not catch query_canceled (statement timeout,
      -- cancel); without it one slow job rolled back every claim of the tick.
      EXCEPTION WHEN query_canceled OR OTHERS THEN
        v_action := 'catch_up_failed';
        v_detail := left(SQLERRM, 300);
        v_cancelled := v_cancelled OR SQLSTATE = '57014';
        UPDATE public.cron_catchup_runs SET action = v_action, detail = v_detail
         WHERE jobname = r.jobname AND slot = r.slot;
      END;
      PERFORM set_config('lock_timeout', '200ms', true);
    END IF;

    -- Q207(2): 'caught_up' so far only means an HTTP job's request was QUEUED
    -- (pg_net sends it after commit). Its command (wrapped by Q174) tagged the
    -- request id in cron_http_requests in THIS transaction, so created_at is
    -- now(). Keep it on the claim; sweep_cron_http_failures checks the answer
    -- and turns a failed one into 'catch_up_failed' with the usual alert.
    IF v_action = 'caught_up' THEN
      SELECT max(h.request_id) INTO v_request_id
        FROM public.cron_http_requests h
       WHERE h.jobname = r.jobname AND h.created_at = now();
      IF v_request_id IS NOT NULL THEN
        UPDATE public.cron_catchup_runs SET request_id = v_request_id
         WHERE jobname = r.jobname AND slot = r.slot;
      END IF;
    END IF;

    IF v_action = 'caught_up' THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('warning',
              format('Missed cron slot caught up: %s — its %s UTC run did not succeed (%s) and nothing re-runs a missed slot, so it was run once at %s. Safe late because: %s',
                     r.jobname, to_char(r.slot AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                     coalesce(r.last_failure, 'no run recorded'),
                     to_char(now() AT TIME ZONE 'UTC', 'HH24:MI'), r.reason),
              jsonb_build_object('source', 'cron-caught-up', 'area', 'cron', 'job', r.jobname),
              jsonb_build_object('slot', r.slot, 'last_failure', r.last_failure, 'docs', 'docs/OPEN.md Q30',
                                 'request_id', v_request_id));
    ELSE
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              format('Missed cron slot NOT re-run: %s — its %s UTC run did not succeed (%s). %s A person decides what the lost slot needs.',
                     r.jobname, to_char(r.slot AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                     coalesce(r.last_failure, 'no run recorded'),
                     CASE v_action
                       WHEN 'alerted_unclassified' THEN 'It has no row in cron_catchup_policy, so it is treated as unsafe (add one: src/test/cronCatchUpPolicy.test.ts).'
                       WHEN 'alerted_unsafe'       THEN 'Not catch-up-safe: ' || coalesce(v_detail, r.reason)
                       WHEN 'alerted_too_late'     THEN format('The slot is older than its %s catch-up window, so re-running it now would be too late (the database was down, or the catch-up was not yet running, for longer than that).', r.max_late)
                       ELSE 'The catch-up run itself FAILED: ' || coalesce(v_detail, '?')
                     END),
              jsonb_build_object('source', 'cron-missed-slot', 'area', 'cron', 'job', r.jobname),
              jsonb_build_object('slot', r.slot, 'action', v_action, 'last_failure', r.last_failure,
                                 'docs', 'docs/OPEN.md Q30'));
    END IF;

    v_decided := v_decided || jsonb_build_array(jsonb_build_object('job', r.jobname, 'slot', r.slot, 'action', v_action));
  END LOOP;

  RETURN jsonb_build_object('checked', true, 'healthy', v_healthy, 'failed_15m', v_failed,
                            'succeeded_15m', v_ok, 'ran', v_ran, 'waiting', v_waiting,
                            'decided', v_decided);
END;
$fn$;
REVOKE ALL ON FUNCTION public.run_missed_cron_catch_up() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_missed_cron_catch_up() TO service_role;
