-- Q174: sweep_cron_http_failures filed manual pg_net probes as cron failures.
--
-- MEASURED (prod, 2026-09-23, docs/OPEN.md Q174): the sweep read EVERY
-- net._http_response row and, when the body did not name its function, guessed
-- the cron by start-time proximity. The 08:00Z "arrival-confirm-reminder ...
-- Timeout of 400 ms" row could not be that cron (its command waits 30000 ms);
-- the "money-reconciliation returned 500" rows at 08:00Z/08:15Z were manual
-- `?include_seed=1` POSTs at 07:52, 07:54 and 08:12Z (function_edge_logs).
--
-- pg_net's response table has no URL or header of the request, and the queue
-- row is deleted once the request resolves (20260828030000's header), so a
-- header tag could never be read back. The one thing both sides share is the
-- request id: net.http_post returns it and net._http_response.id is it. So:
--
--   1. public.cron_http_requests(request_id, jobname): which cron sent which id.
--   2. public.cron_http_tag(request_id, jobname) records one and returns the id.
--      Every HTTP cron command becomes
--        SELECT public.cron_http_tag(q.request_id, '<jobname>')
--          FROM (<the command exactly as it was>) AS q(request_id);
--      Still one SELECT returning the id, so run_missed_cron_catch_up's
--      EXECUTE of the command and cron's return_message are unchanged.
--   3. sweep_cron_http_failures JOINs responses to that table: a tagged
--      response is filed under its job, exactly; an UNTAGGED response (a
--      manual probe, a sweeper's own Slack post) is not a cron's and is not
--      filed. The proximity guess is gone.
--   4. prune_cron_http_requests() hourly: 2 days kept, far past pg_net's ~6h
--      response retention and the sweep's 60-minute lookback.
--
-- WHY THE COMMANDS ARE WRAPPED IN PLACE, NOT RE-TYPED FROM THE MIGRATIONS.
-- The live commands are not the migration text: 20260505220500 and
-- 20260922222716 rewrote them in place, and 20260831190419 deliberately left
-- thirteen pre-existing ones "completely untouched". Re-typing a working money
-- cron's command from a file is how 20260829010000 says escrow gets broken. So
-- each live command is kept byte for byte inside the wrapper (cron.alter_job,
-- jobid and schedule unchanged), the same mechanical approach as
-- 20260922222716. A command is wrapped only when it is unambiguous: one
-- statement, a single SELECT, exactly one net.http_post call, not already
-- wrapped. Anything else is RAISEd by name, never skipped silently.
--
-- The list of HTTP crons the migrations define (derived by
-- src/test/helpers/cronHttpJobs.ts; cronHttpRequestsAreTagged.test.ts holds it
-- equal to the migrations both ways) is compared with cron.job: a listed job
-- missing live, or a live HTTP cron not on the list, is RAISEd too. Both are
-- wrapped regardless, because the live table is the truth.
--
-- If the tag insert ever fails, cron_http_tag logs it (error_logs,
-- source 'cron-http-tag') and still returns the id: a lost tag loses the
-- ATTRIBUTION of one response, never the cron's run.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT; the rewrite
-- skips commands already containing cron_http_tag( and is a no-op without
-- pg_cron or pg_net; cron.schedule upserts by name.

CREATE TABLE IF NOT EXISTS public.cron_http_requests (
  request_id bigint PRIMARY KEY,
  jobname    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cron_http_requests_created_at_idx
  ON public.cron_http_requests (created_at);
ALTER TABLE public.cron_http_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cron_http_requests FROM PUBLIC, anon, authenticated;
-- Server-only: written by cron commands (job owner) and read by the SECURITY
-- DEFINER sweep; no client ever touches it.
GRANT ALL ON TABLE public.cron_http_requests TO service_role;

COMMENT ON TABLE public.cron_http_requests IS
  'Q174: pg_net request id -> the cron that sent it, written by cron_http_tag() inside each HTTP cron command. sweep_cron_http_failures attributes a response by this join and ignores untagged responses (manual probes). Pruned hourly to 2 days.';

CREATE OR REPLACE FUNCTION public.cron_http_tag(p_request_id bigint, p_jobname text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_request_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.cron_http_requests (request_id, jobname)
      VALUES (p_request_id, p_jobname)
      ON CONFLICT (request_id) DO UPDATE SET jobname = EXCLUDED.jobname;
    EXCEPTION WHEN OTHERS THEN
      -- The request is already queued; failing here would roll it back and
      -- lose the cron's run. Record the lost tag instead.
      BEGIN
        INSERT INTO public.error_logs (severity, message, tags, context)
        VALUES ('error',
                format('cron_http_tag could not record request %s for %s: %s', p_request_id, p_jobname, SQLERRM),
                jsonb_build_object('source', 'cron-http-tag', 'area', 'cron', 'job', p_jobname),
                jsonb_build_object('request_id', p_request_id, 'sqlstate', SQLSTATE));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'cron_http_tag: request % for % not recorded: %', p_request_id, p_jobname, SQLERRM;
      END;
    END;
  END IF;
  RETURN p_request_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cron_http_tag(bigint, text) FROM PUBLIC, anon, authenticated;

-- ── Wrap every HTTP cron command ────────────────────────────────────────────
DO $do$
DECLARE
  -- The migrations' HTTP crons (cronHttpRequestsAreTagged.test.ts keeps this
  -- equal to them, both ways).
  v_expected text[] := ARRAY[
    'arrival-confirm-reminder',
    'auto-expire-jobs',
    'auto-release-payment',
    'auto-resolve-disputes',
    'auto-tip-charge',
    'backfill-job-geocode',
    'charge-recurring-visits',
    'cleanup-abandoned-accounts',
    'cleanup-notifications',
    'daily-match-digest',
    'engagement-automations',
    'expire-subscriptions',
    'expiring-jobs-push',
    'marketing-publish',
    'marketing-token-health',
    'money-reconciliation',
    'payment-confirm-reminder',
    'process-email-queue',
    'process-scheduled-payouts',
    'review-nag-cron',
    'saved-helper-availability-push',
    'stalled-completion-reminder',
    'str-ical-sync',
    'subscription-reconciliation',
    'void-cancelled-payments',
    'weekly-helper-report'
  ];
  r          record;
  v_body     text;
  v_new      text;
  v_done     text[] := '{}';
  v_skipped  text[] := '{}';
  v_unlisted text[] := '{}';
  v_missing  text[];
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'Q174: pg_cron not installed, no cron commands to tag';
    RETURN;
  END IF;
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE 'Q174: pg_net signature not as expected, leaving cron commands untouched';
    RETURN;
  END IF;

  FOR r IN
    SELECT jobid, jobname, command
      FROM cron.job
     WHERE command LIKE '%net.http_post(%'
       AND command NOT LIKE '%cron_http_tag(%'
     ORDER BY jobname
  LOOP
    IF NOT (r.jobname = ANY (v_expected)) THEN
      v_unlisted := v_unlisted || r.jobname;
    END IF;

    v_body := regexp_replace(r.command, ';\s*$', '');
    IF (length(r.command) - length(replace(r.command, 'net.http_post(', '')))
       / length('net.http_post(') <> 1 THEN
      v_skipped := v_skipped || (r.jobname || ' (more than one net.http_post call)');
      CONTINUE;
    ELSIF position(';' in v_body) > 0 THEN
      v_skipped := v_skipped || (r.jobname || ' (more than one statement)');
      CONTINUE;
    ELSIF v_body !~* '^\s*select\s' THEN
      v_skipped := v_skipped || (r.jobname || ' (not a single SELECT)');
      CONTINUE;
    END IF;

    v_new := format(E'SELECT public.cron_http_tag(q.request_id, %L)\n  FROM (%s\n) AS q(request_id);',
                    r.jobname, v_body);
    PERFORM cron.alter_job(job_id := r.jobid, command := v_new);
    v_done := v_done || r.jobname;
  END LOOP;

  SELECT coalesce(array_agg(e ORDER BY e), '{}') INTO v_missing
    FROM unnest(v_expected) AS e
   WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = e);

  RAISE NOTICE 'Q174: % HTTP cron command(s) now tag their request id: %',
    coalesce(array_length(v_done, 1), 0), array_to_string(v_done, ', ');
  IF array_length(v_skipped, 1) > 0 THEN
    RAISE WARNING 'Q174: % HTTP cron(s) NOT tagged, their failures will not be filed until wrapped by hand: %',
      array_length(v_skipped, 1), array_to_string(v_skipped, '; ');
  END IF;
  IF array_length(v_unlisted, 1) > 0 THEN
    RAISE WARNING 'Q174: HTTP cron(s) live but in no migration (tagged anyway): %',
      array_to_string(v_unlisted, ', ');
  END IF;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE WARNING 'Q174: HTTP cron(s) the migrations define but cron.job does not have: %',
      array_to_string(v_missing, ', ');
  END IF;
END;
$do$;

-- ── The sweep: 20260828030000's definition, attribution by request id ───────
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

-- ── Prune: same shape as prune_cron_run_log (20260829020000) ───────────────
CREATE OR REPLACE FUNCTION public.prune_cron_http_requests()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.cron_http_requests WHERE created_at < now() - interval '2 days';
$$;

REVOKE ALL ON FUNCTION public.prune_cron_http_requests() FROM PUBLIC, anon, authenticated;

-- Hourly, so it is not a daily/weekly job needing a catch-up policy row; a
-- stop is seen by sweep_dead_crons through the expectation below. SQL-only.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('prune-cron-http-requests', interval '3 hours',
            'Q174: hourly prune of cron_http_requests older than 2 days.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.schedule('prune-cron-http-requests', '28 * * * *',
                          'SELECT public.prune_cron_http_requests();');
  END IF;
END
$do$;
