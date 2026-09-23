-- Q207 (parts 1, 3, 4): hardening of run_missed_cron_catch_up() found by the
-- Q189 lh-silent-failure review. Part (2), capturing the pg_net request id of
-- a caught-up HTTP job, waits for Q174 (which is changing how cron HTTP
-- requests are tagged).
--
-- (1) A RESCHEDULED daily/weekly job looked like a missed slot. The function
--     computes the last slot from the job's CURRENT schedule, and took "any
--     earlier run" as proof the job existed then. Move charge-recurring-visits
--     from 06:00 to 10:00 at 15:00: its 10:00 slot has no run after it, it has
--     an earlier run (06:00), so the tick filed a 'cron-missed-slot' ERROR for
--     a day that already charged (and a catch_up = true job would have run a
--     second time that day). Now a slot counts only with proof the job was on
--     THIS schedule at the slot: pg_cron started it at the slot and it failed;
--     or it has an earlier run AND either a tick saw it on this schedule at or
--     before the slot (new table cron_catchup_schedules, written every tick,
--     'since' restarts when the schedule changes), or it ran (or was caught
--     up) exactly one period earlier.
-- (3) The tick's 200ms lock_timeout (meant for its own claim/alert writes) was
--     still in force while it EXECUTEd the job, so a job that briefly waits
--     for a row lock failed under catch-up though it succeeds under pg_cron.
--     The job now runs with the session's own lock_timeout; 200ms is restored
--     after.
-- (4) EXCEPTION WHEN OTHERS does not catch query_canceled, so a job hitting
--     statement_timeout aborted the whole tick: every claim and alert of that
--     tick rolled back and the slot was retried every 10 minutes. It is now
--     caught per command, recorded as 'catch_up_failed' and alerted, and the
--     tick continues without running any further job: statement_timeout is
--     not re-armed inside the same statement, so a later job could otherwise
--     hang the tick (and its advisory lock) on a row lock. Those slots wait for
--     the next tick. A paused-then-resumed job also restarts 'since' (review
--     finding), so its first slot after resuming is not taken for a miss.
--
-- The function body is 20260923145516's verbatim except those changes.
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, grants restated.

CREATE TABLE IF NOT EXISTS public.cron_catchup_schedules (
  jobid    bigint PRIMARY KEY,
  jobname  text,
  schedule text NOT NULL,
  active   boolean NOT NULL DEFAULT true,
  since    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cron_catchup_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cron_catchup_schedules FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cron_catchup_schedules TO service_role;
COMMENT ON TABLE public.cron_catchup_schedules IS
  'Q207: each cron job''s current schedule and when run_missed_cron_catch_up() first saw it on that schedule. A slot earlier than since is not proof of a missed run (the job was rescheduled). Server-only.';

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
    SELECT j.jobid, j.jobname, j.command, j.username, j.database,
           s.slot, s.period, p.catch_up, p.max_late, p.reason,
           (SELECT left(coalesce(d.return_message, d.status), 120)
              FROM cron.job_run_details d
             WHERE d.jobid = j.jobid AND d.start_time >= s.slot - interval '1 minute'
             ORDER BY d.start_time DESC LIMIT 1) AS last_failure
      FROM cron.job j
     CROSS JOIN LATERAL public.cron_catchup_last_slot(j.schedule, now()) s
      LEFT JOIN public.cron_catchup_policy p ON p.jobname = j.jobname
     WHERE j.active
       AND j.jobname <> 'cron-missed-slot-catch-up'
       AND now() - s.slot >= v_grace
       AND now() - s.slot <  s.period
       AND NOT EXISTS (SELECT 1 FROM public.cron_catchup_runs c
                        WHERE c.jobname = j.jobname AND c.slot = s.slot)
       AND NOT EXISTS (SELECT 1 FROM cron.job_run_details d
                        WHERE d.jobid = j.jobid
                          AND d.start_time >= s.slot - interval '1 minute'
                          AND d.status IN ('succeeded', 'running', 'starting'))
       -- Q207(1): proof the job was on THIS schedule at the slot, so a
       -- rescheduled job's new time is never taken for a missed slot.
       AND (-- pg_cron started it AT this slot, and that run failed;
            EXISTS (SELECT 1 FROM cron.job_run_details d
                     WHERE d.jobid = j.jobid AND d.start_time >= s.slot - interval '1 minute'
                       AND d.start_time < s.slot + v_grace
                       AND d.status = 'failed')
            -- or it ran before, AND on this schedule: seen on it by a tick at
            -- or before the slot, or run (or caught up) one period earlier.
            OR (EXISTS (SELECT 1 FROM cron.job_run_details d
                         WHERE d.jobid = j.jobid AND d.start_time < s.slot - interval '1 minute')
                AND (EXISTS (SELECT 1 FROM public.cron_catchup_schedules cs
                              WHERE cs.jobid = j.jobid AND cs.schedule = j.schedule
                                AND cs.since <= s.slot)
                     OR EXISTS (SELECT 1 FROM cron.job_run_details d
                                 WHERE d.jobid = j.jobid
                                   AND d.start_time >= s.slot - s.period - interval '1 minute'
                                   AND d.start_time <  s.slot - s.period + v_grace)
                     OR EXISTS (SELECT 1 FROM public.cron_catchup_runs c
                                 WHERE c.jobname = j.jobname AND c.slot = s.slot - s.period))))
     ORDER BY s.slot
  LOOP
    v_detail := NULL;
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

    IF v_action = 'caught_up' THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('warning',
              format('Missed cron slot caught up: %s — its %s UTC run did not succeed (%s) and nothing re-runs a missed slot, so it was run once at %s. Safe late because: %s',
                     r.jobname, to_char(r.slot AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                     coalesce(r.last_failure, 'no run recorded'),
                     to_char(now() AT TIME ZONE 'UTC', 'HH24:MI'), r.reason),
              jsonb_build_object('source', 'cron-caught-up', 'area', 'cron', 'job', r.jobname),
              jsonb_build_object('slot', r.slot, 'last_failure', r.last_failure, 'docs', 'docs/OPEN.md Q30'));
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
