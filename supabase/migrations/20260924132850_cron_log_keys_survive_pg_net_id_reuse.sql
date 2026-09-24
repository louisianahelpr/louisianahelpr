-- pg_net's response ids RESTARTED on 2026-09-24 around 10:04Z (new ids ~1,450,
-- cron_run_log already held ids up to 62,593). Everything that keyed a run on
-- the id ALONE then matched a week-old row:
--   * cron_run_log's UNIQUE (response_id) + ON CONFLICT DO NOTHING dropped
--     every new run whose id a 2026-09-16 run had used (90 of 91 in 3h), so
--     health-check read "newest cron run is 189 min old" and edge-function-smoke
--     went red (ledger d2074c4a) while pg_cron ran 120 jobs an hour;
--   * sweep_cron_http_failures would skip a new failure whose id an old
--     cron-http error_logs row carried, and could read a new response as an
--     old catch-up's outcome;
--   * a tag upsert kept the old row's created_at.
-- An id now means (id, time): the log is unique on (response_id, occurred_at),
-- and every join back to net._http_response also matches its time.
-- The next hourly sweep re-reads pg_net's last 6 hours, so the gap refills.

DROP INDEX IF EXISTS public.cron_run_log_response_idx;
CREATE UNIQUE INDEX IF NOT EXISTS cron_run_log_response_occurred_idx
  ON public.cron_run_log (response_id, occurred_at);

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
     -- pg_net ids restart (2026-09-24 ~10:04Z); a tag is only its own request's.
     AND t.created_at BETWEEN resp.created - interval '15 minutes' AND resp.created
   WHERE resp.created > now() - interval '6 hours'
     AND resp.content::text ~ '"fn"\s*:\s*"'
  ON CONFLICT (response_id, occurred_at) DO NOTHING;

  GET DIAGNOSTICS v_recorded = ROW_COUNT;

  -- Fill in the parsed body separately so a malformed one cannot abort the
  -- whole INSERT above.
  FOR r IN
    SELECT l.id, resp.content::text AS raw
      FROM public.cron_run_log l
      JOIN net._http_response resp ON resp.id = l.response_id AND resp.created = l.occurred_at
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
              WHERE e.tags->>'source' = 'cron-http'
                AND e.context->>'response_id' = resp.id::text
                AND e.created_at >= resp.created)
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
$function$;

CREATE OR REPLACE FUNCTION public.cron_http_tag(p_request_id bigint, p_jobname text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_request_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.cron_http_requests (request_id, jobname)
      VALUES (p_request_id, p_jobname)
      ON CONFLICT (request_id) DO UPDATE SET jobname = EXCLUDED.jobname, created_at = now();
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
$function$;

REVOKE ALL ON FUNCTION public.sweep_silent_cron_failures() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_cron_http_failures() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_http_tag(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_silent_cron_failures() TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_cron_http_failures() TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_http_tag(bigint, text) TO service_role;

-- check_ops_digest_delivery: a digest's request_id must match ITS response,
-- sent within minutes of the error_logs row, not a later request that reused the id.
CREATE OR REPLACE FUNCTION public.check_ops_digest_delivery()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_records   int;
  v_delivered int := 0;
  v_failed    int := 0;
  v_problem   text;
  v_has_row   boolean;
BEGIN
  SELECT count(*) INTO v_records
    FROM public.error_logs e
   WHERE jsonb_typeof(e.tags) = 'object'
     AND e.tags ->> 'source' = 'ops-digest'
     AND e.created_at > now() - interval '30 hours';

  IF to_regclass('net._http_response') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FILTER (WHERE r.status_code = 200 AND r.content::text ~ '"ok"\s*:\s*true'),
             count(*) FILTER (WHERE r.id IS NOT NULL
                               AND NOT (r.status_code IS NOT DISTINCT FROM 200
                                        AND r.content::text ~ '"ok"\s*:\s*true'))
             + count(*) FILTER (WHERE e.context ->> 'request_id' IS NULL)
        FROM public.error_logs e
        LEFT JOIN net._http_response r ON r.id = (e.context ->> 'request_id')::bigint
                                       AND r.created BETWEEN e.created_at - interval '5 minutes'
                                                         AND e.created_at + interval '1 hour'
       WHERE jsonb_typeof(e.tags) = 'object'
         AND e.tags ->> 'source' = 'ops-digest'
         AND e.created_at > now() - interval '30 hours'
         AND e.created_at < now() - interval '10 minutes'
    $q$ INTO v_delivered, v_failed;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.cron_work_expectations c WHERE c.jobname = 'ops-daily-digest')
    INTO v_has_row;

  v_problem := CASE
    -- Without the expectation row "none in 30 h" can never fire, so ok:true
    -- would be a false clear (and ops_alert_verify would close on it).
    WHEN NOT v_has_row THEN 'Daily ops digest delivery cannot be checked: cron_work_expectations has no ops-daily-digest row.'
    -- Grace: the digest's first run is up to a day after this migration, so
    -- "none in 30 h" only counts once the digest has existed for 30 h.
    WHEN v_records = 0 AND EXISTS (
           SELECT 1 FROM public.cron_work_expectations c
            WHERE c.jobname = 'ops-daily-digest'
              AND c.registered_at < now() - interval '30 hours') THEN 'No daily ops digest has been sent in 30 hours (ops-daily-digest did not run or raised).'
    WHEN v_delivered = 0 AND v_failed > 0 THEN 'The daily ops digest was sent but Slack did not accept it (see net._http_response / slack-ops-alert logs). Alerts may not be reaching #ops-alerts.'
    ELSE NULL
  END;

  IF v_problem IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'records', v_records, 'delivered', v_delivered);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'ops-digest-undelivered'
       AND e.created_at > date_trunc('day', now())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'already_reported', true);
  END IF;

  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES ('error', v_problem,
          jsonb_build_object('source', 'ops-digest-undelivered', 'area', 'alerting'),
          jsonb_build_object('records', v_records, 'delivered', v_delivered, 'failed', v_failed));

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'title', 'Daily ops digest not delivered',
        'message', v_problem,
        'severity', 'critical'));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', false, 'problem', v_problem);
END;
$function$;

REVOKE ALL ON FUNCTION public.check_ops_digest_delivery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_ops_digest_delivery() TO service_role;
