-- Nothing watches what the cron-invoked edge functions actually return.
--
-- pg_cron records only whether the `net.http_post` ENQUEUE succeeded. The HTTP
-- status that comes back later lands in net._http_response, which nothing
-- reads. So a function can return 500 on every single run, forever, and
-- cron.job_run_details still shows an unbroken column of 'succeeded'.
--
-- That is exactly how charge-recurring-visits hid: it returned 500 on every
-- daily run for months (an invalid enum value in its series filter aborted the
-- query), so recurring jobs never produced a second visit — and every dashboard
-- said the cron was healthy. 17 of the 31 scheduled jobs invoke an edge
-- function this way, including auto-release-payment, auto-tip-charge,
-- void-cancelled-payments and expire-subscriptions. All of them share the blind
-- spot; several of them move money.
--
-- This sweep closes it WITHOUT touching those 17 job definitions — re-scheduling
-- working money crons to add instrumentation is a far bigger risk than the one
-- being fixed. Attribution instead comes from cron.job_run_details, which
-- records jobid + start_time: a response is matched to the HTTP cron whose run
-- started closest before it. That is unambiguous in practice because pg_net
-- resolves in seconds and no two HTTP crons share a start second.

-- Keeps the dedupe lookup below from degrading into a seq scan on error_logs.
CREATE INDEX IF NOT EXISTS error_logs_cron_http_response_idx
  ON public.error_logs ((context->>'response_id'))
  WHERE tags->>'source' = 'cron-http';

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
BEGIN
  FOR r IN
    SELECT resp.id,
           resp.status_code,
           resp.timed_out,
           resp.error_msg,
           resp.created,
           left(coalesce(resp.content::text, ''), 500) AS body,
           (SELECT j.jobname
              FROM cron.job_run_details d
              JOIN cron.job j ON j.jobid = d.jobid
             WHERE j.command ILIKE '%net.http_post%'
               AND d.start_time BETWEEN resp.created - interval '2 minutes' AND resp.created
             ORDER BY abs(extract(epoch FROM (resp.created - d.start_time)))
             LIMIT 1) AS jobname
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
      format('Cron HTTP %s: %s returned %s',
             CASE WHEN r.timed_out THEN 'timeout' ELSE 'failure' END,
             coalesce(r.jobname, 'unattributed cron'),
             coalesce(r.status_code::text,
                      nullif(r.error_msg, ''),
                      CASE WHEN r.timed_out THEN 'timeout' ELSE 'no response' END)),
      jsonb_build_object('source', 'cron-http',
                         'area',   'cron',
                         'job',    coalesce(r.jobname, 'unknown')),
      -- The body is kept because it is usually the only thing that says WHICH
      -- function answered and why; charge-recurring-visits' own 500 body was
      -- `{"ok":false,"error":"Internal server error"}`.
      jsonb_build_object('response_id', r.id,
                         'status_code', r.status_code,
                         'timed_out',   r.timed_out,
                         'error_msg',   r.error_msg,
                         'body',        r.body,
                         'occurred_at', r.created));
    v_logged := v_logged + 1;
    IF NOT r.timed_out THEN
      v_errors := v_errors + 1;
      IF NOT (coalesce(r.jobname, 'unattributed') = ANY (v_names)) THEN
        v_names := v_names || coalesce(r.jobname, 'unattributed');
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

-- Every 15 minutes: fast enough that a broken money cron is caught within one
-- run of it breaking, cheap enough to be invisible (it reads at most a few
-- hundred rows).
SELECT cron.unschedule('sweep-cron-http-failures')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-cron-http-failures');

SELECT cron.schedule(
  'sweep-cron-http-failures',
  '*/15 * * * *',
  $cron$SELECT public.sweep_cron_http_failures();$cron$
);
