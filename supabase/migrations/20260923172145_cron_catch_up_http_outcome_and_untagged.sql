-- Q207 part (2) + Q218: the HTTP outcome of a caught-up cron slot is checked,
-- an HTTP cron that does not tag its request is alerted on, and the silent-
-- failure sweep only counts responses a cron actually sent.
--
-- (1) Q207(2). run_missed_cron_catch_up() recorded 'caught_up' as soon as it
--     had EXECUTEd the job's command. For an HTTP job that command only QUEUES
--     a pg_net request (sent after commit), so 'caught_up' meant "asked", not
--     "done": a caught-up slot whose edge function answered 500 or timed out
--     stayed 'caught_up' for ever and the lost slot was never alerted as lost.
--     Since Q174 (20260923170422) every HTTP cron command runs through
--     cron_http_tag(), which writes the request id to cron_http_requests in the
--     same transaction (created_at = now(), the transaction's start). So:
--       - cron_catchup_runs gains request_id / http_status / http_checked_at;
--       - run_missed_cron_catch_up() (restated from 20260923163407, its newest
--         definition, with only this change) keeps on the claim the request id
--         that job's command tagged in THIS transaction;
--       - sweep_cron_http_failures() (every 15 minutes) reads every caught-up
--         run with a request id not yet checked: a 2xx closes it (http_status
--         recorded); a non-2xx, a pg_net timeout or error, or no response at
--         all two hours on turns the run into 'catch_up_failed' and files the
--         existing alert for that ('cron-missed-slot', "The catch-up run itself
--         FAILED: ..."), counted in its Slack post. A timeout counts as failed
--         here on purpose: this is a slot that was already missed once, and a
--         person should look (the message says the function may have finished).
--     A caught-up SQL-only job has no request id and is untouched (its
--     EXECUTE already succeeded or failed synchronously).
--
-- (2) Q218. Since Q174 the failure sweep only sees responses whose request id
--     is in cron_http_requests. An HTTP cron added from the dashboard or the SQL
--     editor, or re-set by cron.alter_job(command := ...) without
--     cron_http_tag(, would fail silently. sweep_cron_http_failures() now also
--     lists ACTIVE cron.job rows whose command contains 'net.http_post(' but not
--     'cron_http_tag(' and files one error_logs row per job per UTC day
--     (source 'cron-http-untagged'), named in its Slack post.
--
-- (3) Q218 sibling. sweep_silent_cron_failures() (restated from
--     20260923090536, its newest definition, with only this change) copied ANY
--     net._http_response whose body has "fn":"..." into cron_run_log, so a
--     manual probe of a function counted as one of its cron runs (and could
--     break or fake a silent-failure streak). Its ingest now JOINs
--     cron_http_requests: only responses to a request a cron tagged are runs.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR
-- REPLACE, grants restated. Proof: src/test/pglite/cronCatchUpHttpOutcome.pglite.mjs.

ALTER TABLE public.cron_catchup_runs
  ADD COLUMN IF NOT EXISTS request_id      bigint,
  ADD COLUMN IF NOT EXISTS http_status     int,
  ADD COLUMN IF NOT EXISTS http_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS cron_catchup_runs_http_unchecked_idx
  ON public.cron_catchup_runs (decided_at)
  WHERE request_id IS NOT NULL AND http_checked_at IS NULL;
COMMENT ON COLUMN public.cron_catchup_runs.request_id IS
  'Q207: the pg_net request id a caught-up HTTP job''s command tagged (cron_http_requests). sweep_cron_http_failures checks its response and turns a failed one into catch_up_failed.';

-- ── (1) run_missed_cron_catch_up: 20260923163407's, plus the request id ─────
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

-- ── (1)+(2) sweep_cron_http_failures: 20260923170422's, plus the catch-up
--    outcome and the untagged-cron check ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_cron_http_failures()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
              WHERE e.tags->>'source' = 'cron-http'
                AND e.context->>'response_id' = resp.id::text)
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
      LEFT JOIN net._http_response resp ON resp.id = c.request_id
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
                WHERE e.tags->>'source' = 'cron-http-untagged'
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
$fn$;
REVOKE ALL ON FUNCTION public.sweep_cron_http_failures() FROM PUBLIC, anon, authenticated;

-- ── (3) sweep_silent_cron_failures: 20260923090536's, ingest joined to the tag
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
    -- Q218: only a response to a request a cron tagged (cron_http_tag, Q174)
    -- is a cron run. A manual probe of the function names its fn too, and
    -- used to be counted as one of its runs.
    JOIN public.cron_http_requests t ON t.request_id = resp.id
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
REVOKE ALL ON FUNCTION public.sweep_silent_cron_failures() FROM PUBLIC, anon, authenticated;
