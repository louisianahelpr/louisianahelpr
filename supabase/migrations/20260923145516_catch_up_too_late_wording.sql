-- Q189(b): the too-late alert of run_missed_cron_catch_up() blamed database
-- health for every too-late slot. The four 09-22 slots it filed on its first
-- run (2026-09-23 13:39Z) were too late because the catch-up did not exist
-- yet, not because the database stayed down. The message now states the
-- actual rule: the slot is older than its max_late window.
--
-- The function body is 20260923133021's verbatim except that one format()
-- string. Replay-safe: CREATE OR REPLACE, grants restated.

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
       AND (EXISTS (SELECT 1 FROM cron.job_run_details d
                     WHERE d.jobid = j.jobid AND d.start_time < s.slot - interval '1 minute')
            OR EXISTS (SELECT 1 FROM cron.job_run_details d
                        WHERE d.jobid = j.jobid AND d.start_time >= s.slot - interval '1 minute'
                          AND d.status = 'failed'))
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
    ELSIF NOT v_healthy OR v_ran >= v_max_runs THEN
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
        EXECUTE regexp_replace(r.command, ';\s*$', '');
      EXCEPTION WHEN OTHERS THEN
        v_action := 'catch_up_failed';
        v_detail := left(SQLERRM, 300);
        UPDATE public.cron_catchup_runs SET action = v_action, detail = v_detail
         WHERE jobname = r.jobname AND slot = r.slot;
      END;
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
