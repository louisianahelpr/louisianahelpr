-- A one-off gateway 502 paged as a cron failure.
--
-- 2026-10-26 the cron-http watcher filed "refund-request-sweep returned 502"
-- and "declutter-money returned 502" (error_logs, 18:15Z). Measured read-only:
--   - function_edge_logs: the two 502s (18:00:03Z refund-request-sweep,
--     18:08:00Z declutter-money) are text/html with no function version, no
--     deployment id and no x-served-by: supabase-edge-runtime, in 69 ms and
--     44 ms. function_logs hold no boot for either function at those moments:
--     the platform's gateway answered, our code never ran.
--   - Both functions were last deployed 2026-10-26 02:08-02:10Z (v58, v19)
--     from main; every other run of both, before and since, answered 200 (the
--     next ones 18:10Z and 18:18Z). The only other edge 5xx that day was one
--     stripe-connect 502 at 14:55Z. Nothing on the unlanded declutter branches
--     is involved: the functions answer 200 against what main deployed.
--
-- So the alert was a platform blip with nothing to fix in either function. It
-- now gets the rule Q1690 gave a new cron's first-run 404, narrowed by a
-- /code-review of this change: a 502/503 that never reached the function
-- (text/html, no x-served-by, no x-deno-execution-id; header names compared
-- case-insensitively; a response with no headers is never a candidate), on a
-- job listed as a catch-up sweep (declutter-money, refund-request-sweep: each
-- run acts on every row due, so the next run does a lost run's work), is
-- skipped ONLY once a later 2xx of the same job proves the platform answered
-- again; younger than 30 minutes with no success yet, it waits for the next
-- sweep; otherwise it is filed as before. 504 is excluded (the gateway also
-- sends it for a function that ran past its time limit). A function's own 5xx
-- (it carries the runtime's headers), a timeout, any job not listed and every
-- other status are filed exactly as before.
--
-- sweep_cron_http_failures is restated from its effective definition
-- (20261012202854; live prosrc md5 68dfbf43b535f2ea84b893019eed2e03, equal,
-- measured 2026-10-27) with only those additions. Replay-safe: CREATE OR
-- REPLACE only. Grants: service_role only.
-- Proof: src/test/pglite/cronGateway5xxNeedsARepeat.pglite.mjs. Guard:
-- src/test/cronGateway5xxNeedsARepeat.test.ts.

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
  -- Q1690
  v_grace          int := 0;
  v_grace_names    text[] := ARRAY[]::text[];
  -- gateway 5xx (2026-10-26)
  v_gw             int := 0;
  v_gw_names       text[] := ARRAY[]::text[];
BEGIN
  -- Q1690: remember when each cron job was first seen, so a 404 from a job's
  -- very first run (its edge function not uploaded yet) is told apart.
  IF to_regclass('cron.job') IS NOT NULL THEN
    INSERT INTO public.cron_job_first_seen (jobname, first_seen)
    SELECT j.jobname,
           LEAST(now(), (SELECT min(h.created_at) FROM public.cron_http_requests h WHERE h.jobname = j.jobname))
      FROM cron.job j
     WHERE j.jobname IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.cron_job_first_seen f WHERE f.jobname = j.jobname)
    ON CONFLICT (jobname) DO NOTHING;
  END IF;

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
           substring(coalesce(resp.content::text, '') from '"defects"\s*:\s*([0-9]+)') AS self_defects,
           -- Q1690: a 404 within 30 minutes of the job's FIRST run may be that
           -- run racing functions-deploy (db-deploy schedules the cron before
           -- the function is uploaded). Only a candidate: see the loop.
           (resp.status_code = 404
            AND EXISTS (SELECT 1 FROM public.cron_job_first_seen f
                         WHERE f.jobname = tag.jobname
                           AND resp.created >= f.first_seen - interval '20 minutes'
                           AND resp.created < f.first_seen + interval '30 minutes')) AS first_run_grace,
           -- Gateway 5xx (2026-10-26): a 502/503 the platform's gateway
           -- answered without reaching the function, on a job whose next run
           -- redoes the lost run's work. Every answer the edge runtime gives (a
           -- function's own 5xx included) carries x-served-by:
           -- supabase-edge-runtime and an x-deno-execution-id; the 2026-10-26
           -- 18:00Z/18:08Z 502s carried neither and were text/html
           -- (function_edge_logs; no boot in function_logs). All three facts
           -- are required, header names compared case-insensitively, and a
           -- response with no headers kept is never a candidate. 504 is left
           -- out on purpose: the gateway also answers 504 for a function that
           -- ran past its time limit, which is our own failure.
           -- CATCH-UP SWEEPS: each run of these finds every row due and acts on
           -- it, so the next run does a lost run's work. A job keyed to its
           -- own slot is NOT one; add a job here only after reading it.
           (resp.status_code IN (502, 503)
            AND tag.jobname = ANY (ARRAY['declutter-money', 'refund-request-sweep'])
            AND resp.headers IS NOT NULL
            AND EXISTS (SELECT 1 FROM jsonb_each_text(resp.headers) h
                         WHERE lower(h.key) = 'content-type' AND lower(h.value) LIKE 'text/html%')
            AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(resp.headers) h
                             WHERE lower(h.key) IN ('x-served-by', 'x-deno-execution-id'))) AS gateway_5xx,
           -- ...proven temporary only by a LATER success of the same job.
           EXISTS (SELECT 1 FROM net._http_response ok
                     JOIN public.cron_http_requests okt ON okt.request_id = ok.id
                      AND okt.created_at BETWEEN ok.created - interval '15 minutes' AND ok.created
                    WHERE okt.jobname = tag.jobname
                      AND ok.created > resp.created
                      AND ok.status_code BETWEEN 200 AND 299) AS later_success
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
      IF r.first_run_grace THEN
        IF r.later_success THEN
          -- The function arrived. Not written to error_logs: every error_logs
          -- row, whatever its severity, reaches Slack and the ledger, which is
          -- the alert this exists to stop. Counted in the sweep's result
          -- (cron_run_log via cron_record_work; not watched, and a response
          -- is counted again on each re-read inside the 60-minute lookback).
          v_grace := v_grace + 1;
          IF NOT (v_job = ANY (v_grace_names)) THEN
            v_grace_names := v_grace_names || v_job;
          END IF;
          CONTINUE;
        ELSIF r.created > now() - interval '30 minutes' THEN
          -- Too young to judge: the next run reads it again. 30 minutes, not
          -- more: the 60-minute lookback then still gives a never-recovering
          -- 404 two sweep runs (every 15 min) to be filed in (review of
          -- 8c4321157).
          CONTINUE;
        END IF;
        -- Still failing 45 minutes on: filed below like any other failure.
      END IF;
      -- Gateway 5xx: the same rule for a gateway 5xx that never reached a
      -- catch-up sweep. The job's own next run proves the platform answered
      -- again and does the lost run's work; a job that has not succeeded since
      -- is filed once the failure is 30 minutes old, so a gateway that stays
      -- down still pages within the hour. Counted in the sweep's result
      -- (cron_run_log via cron_record_work; not watched, and, like the 404
      -- grace, counted again on each re-read inside the 60-minute lookback).
      IF r.gateway_5xx AND r.later_success THEN
        v_gw := v_gw + 1;
        IF NOT (v_job = ANY (v_gw_names)) THEN
          v_gw_names := v_gw_names || v_job;
        END IF;
        CONTINUE;
      ELSIF r.gateway_5xx AND r.created > now() - interval '30 minutes' THEN
        CONTINUE;
      END IF;
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
                            'untagged_jobs', to_jsonb(v_untagged_names),
                            'first_run_404_skipped', v_grace,
                            'first_run_404_jobs', to_jsonb(v_grace_names),
                            'gateway_5xx_skipped', v_gw,
                            'gateway_5xx_jobs', to_jsonb(v_gw_names));
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_cron_http_failures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_cron_http_failures() TO service_role;
