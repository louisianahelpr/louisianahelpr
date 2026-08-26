-- The watcher could name the WRONG cron in an alert.
--
-- 20260828010000 attributed a response to a cron by timestamp proximity, on
-- the stated grounds that this "is unambiguous in practice because pg_net
-- resolves in seconds and no two HTTP crons share a start second."
--
-- That premise is false. Four pairs share a schedule outright:
--
--   0 * * * *    auto-expire-jobs        + void-cancelled-payments
--   0 */6 * * *  auto-resolve-disputes   + saved-helper-availability-push
--   0 16 * * *   engagement-automations  + review-nag-cron
--   0 9 * * *    cleanup-abandoned-accounts + cleanup-notifications
--
-- and auto-release-payment (*/30) lands on the same second as the first pair
-- every hour, making it a three-way tie across two money crons. Measured on
-- live data, proximity attribution credited auto-expire-jobs and
-- void-cancelled-payments with 4 responses each against 3 scheduled runs, while
-- auto-release-payment showed 4 against 6 — responses were being shuffled
-- between jobs that fire together.
--
-- Consequence: an alert saying "void-cancelled-payments returned 500" could be
-- auto-expire-jobs, sending whoever reads it into the wrong file during an
-- incident. That matters more now that the scheduled functions also answer
-- non-2xx on partial failure, because these alerts stop being rare.
--
-- Exact attribution from pg_net alone is impossible: net.http_request_queue
-- holds the URL, but rows are deleted the moment the request resolves, so
-- nothing is joinable by the time this sweep runs (verified: 0 of the last
-- hour's responses had a surviving queue row). So the functions now state their
-- own name in the response body via _shared/cron-result.ts, and this reads it
-- back. Proximity remains only as a fallback, and is now labelled as a guess
-- instead of being presented as fact.

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
BEGIN
  FOR r IN
    SELECT resp.id,
           resp.status_code,
           resp.timed_out,
           resp.error_msg,
           resp.created,
           left(coalesce(resp.content::text, ''), 500) AS body,
           -- Self-reported name, read straight out of the body. Deliberately a
           -- regex rather than a jsonb cast: the content may be plain text
           -- ("Unauthorized"), an HTML gateway error, or JSON cut short, and a
           -- cast would raise on all three. A regex just finds nothing and
           -- falls through to the proximity guess below.
           substring(coalesce(resp.content::text, '') from '"fn"\s*:\s*"([a-zA-Z0-9_-]+)"') AS self_fn,
           -- Defect count the function reported about itself, when it said so.
           substring(coalesce(resp.content::text, '') from '"defects"\s*:\s*([0-9]+)') AS self_defects,
           (SELECT j.jobname
              FROM cron.job_run_details d
              JOIN cron.job j ON j.jobid = d.jobid
             WHERE j.command ILIKE '%net.http_post%'
               AND d.start_time BETWEEN resp.created - interval '2 minutes' AND resp.created
             ORDER BY abs(extract(epoch FROM (resp.created - d.start_time)))
             LIMIT 1) AS nearest_jobname,
           -- How many HTTP crons started in the same second. >1 means the
           -- proximity guess is a coin flip, and the alert must say so.
           (SELECT count(DISTINCT d2.jobid)
              FROM cron.job_run_details d2
              JOIN cron.job j2 ON j2.jobid = d2.jobid
             WHERE j2.command ILIKE '%net.http_post%'
               AND d2.start_time BETWEEN resp.created - interval '2 minutes' AND resp.created
               AND abs(extract(epoch FROM (resp.created - d2.start_time))) <=
                   (SELECT min(abs(extract(epoch FROM (resp.created - d3.start_time))))
                      FROM cron.job_run_details d3
                      JOIN cron.job j3 ON j3.jobid = d3.jobid
                     WHERE j3.command ILIKE '%net.http_post%'
                       AND d3.start_time BETWEEN resp.created - interval '2 minutes' AND resp.created
                   ) + 1
           ) AS tied_candidates
      FROM net._http_response resp
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
      IF r.self_fn IS NOT NULL THEN
        -- The function named itself. Trust it over any inference.
        v_job := r.self_fn;
        v_attribution := 'self-reported';
      ELSIF r.nearest_jobname IS NOT NULL AND coalesce(r.tied_candidates, 1) > 1 THEN
        -- More than one HTTP cron started in that second. Name the best guess
        -- but mark it, so nobody reads a coin flip as a fact.
        v_job := r.nearest_jobname;
        v_attribution := format('ambiguous (%s crons started together)', r.tied_candidates);
      ELSIF r.nearest_jobname IS NOT NULL THEN
        v_job := r.nearest_jobname;
        v_attribution := 'nearest-start-time';
      ELSE
        v_job := 'unknown';
        v_attribution := 'unattributed';
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
                           -- Whether the job name above is fact or inference.
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

  -- One Slack message per run, never one per failure. A cron that fails every
  -- 5 minutes must not turn the ops channel into the thing people mute — the
  -- durable per-failure detail is already in error_logs above.
  IF v_errors > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s cron HTTP failure(s) in the last hour', v_errors),
          'message', format('Affected: %s. Details in error_logs (tags.source = cron-http).',
                            array_to_string(v_names, ', ')),
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
                            'paged',   v_errors > 0,
                            'jobs',    to_jsonb(v_names));
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_cron_http_failures() FROM PUBLIC, anon, authenticated;
