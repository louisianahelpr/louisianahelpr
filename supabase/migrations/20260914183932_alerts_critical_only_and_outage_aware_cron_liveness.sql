-- Alerts: few, meaningful, and never a false "31 crons are not running".
--
-- ── What happened on 2026-09-14 ─────────────────────────────────────────────
-- Prod was down from 2026-09-13 10:03 UTC (last pg_cron firing of any job) to
-- 2026-09-14 17:40 UTC (first firing after). sweep-dead-crons fired at 17:53,
-- thirteen minutes after recovery, before any hourly or daily job had had its
-- first post-outage slot. Every job's `last_start` was therefore ~31 hours old
-- and 31 jobs were graded "dead" (measured read-only in error_logs,
-- tags.source = 'cron-dead', and cron.job_run_details). By 18:34 every hourly
-- job had fired again. The alert described the outage, not 31 broken crons,
-- and the five sweeps moved to */15 by 20260914174329 were NOT among the
-- flagged (their 1 h / 30 min tolerances are wider than 15 minutes).
--
-- It would also have repeated: the dedupe is per job per UTC day, so at 00:53
-- on 09-15 every daily job not yet past its slot (charge-recurring-visits at
-- 06:06, money-reconciliation at 08:20, ...) would have been "dead" again.
--
-- Two further defects surfaced by the same event:
--   * sweep_cron_blackouts, whose whole job is to report a scheduler outage,
--     never reported this one. It looked for gaps with lag() over only the
--     last 24 hours, so a gap LONGER than 24 hours has no previous row inside
--     the window and is invisible. Zero 'cron-blackout' rows exist for it.
--   * The per-cron messages beside the roll-up came from trg_error_logs_slack
--     (20260907234009), which posted EVERY error_logs row. It also looped:
--     Slack answered `ratelimited`, slack-ops-alert logged that as an
--     error_logs row, and the trigger posted that row too (616 such rows in
--     three days).
--
-- ── Changes ─────────────────────────────────────────────────────────────────
-- 1. sweep_dead_crons: for a job that was healthy going into a scheduler
--    blackout (45+ min with no firing of any job), the clock restarts when the
--    scheduler comes back; a job already dead before the blackout keeps its
--    clock. The outage itself is reported once, by (2). Severity 'critical'.
-- 2. sweep_cron_blackouts: finds gaps over the retained 8 days and reports one
--    that ENDED in the last 24 hours, so a gap of any length is seen.
--    Severity 'critical' (prod was down).
-- 3. trg_error_logs_slack posts only server-written severity='fatal' rows and
--    a short list of money/security sources (error_logs.severity is CHECKed to
--    info/warning/error/fatal, so 'critical' is not a storable value).
--    Everything else is counted in (4).
-- 4. send_ops_daily_digest(): one message a day summarising the last 24 hours
--    of error_logs by source. Scheduled 14:40 UTC (09:40 Central).
-- 5. check_ops_digest_delivery(), run hourly by (1): pages when no digest has
--    been delivered in 30 hours.
--
-- The severity policy these implement is written once, in
-- supabase/functions/_shared/alertPolicy.ts.
--
-- Replay-safe: CREATE OR REPLACE throughout, cron (re)scheduling guarded by
-- pg_cron's presence, expectation upsert guarded by the table's presence.

-- ── 1. Liveness that survives an outage ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_dead_crons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_flagged    int := 0;
  v_names      text[] := ARRAY[]::text[];
  v_resumed_at timestamptz;
  v_gap_start  timestamptz;
  v_digest     jsonb;
  r            record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN jsonb_build_object('flagged', 0, 'jobs', '[]'::jsonb,
                              'skipped', 'pg_cron not installed');
  END IF;

  -- The most recent scheduler blackout: a hole of 45+ minutes in the AGGREGATE
  -- dispatch stream (no job of any kind fired; process-email-queue alone fires
  -- every 5 minutes and sync-profiles-update-grants every 10). 45, not 15, so a
  -- few frequent jobs stopping together can never pass for a blackout and
  -- reset clocks. 8 days covers the 7-day retention of prune-cron-run-details.
  -- NULL when there has been no blackout.
  SELECT g.prev_start, g.start_time
    INTO v_gap_start, v_resumed_at
    FROM (
      SELECT d.start_time,
             lag(d.start_time) OVER (ORDER BY d.start_time) AS prev_start
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '8 days'
    ) g
   WHERE g.prev_start IS NOT NULL
     AND g.start_time - g.prev_start >= interval '45 minutes'
   ORDER BY g.start_time DESC
   LIMIT 1;

  FOR r IN
    WITH expected AS (
      SELECT c.jobname, c.expected_max_gap, c.registered_at
        FROM public.cron_work_expectations c
       WHERE c.expected_max_gap IS NOT NULL
    ),
    live AS (
      SELECT e.jobname,
             e.expected_max_gap,
             e.registered_at,
             j.jobid,
             j.active,
             (SELECT max(d.start_time)
                FROM cron.job_run_details d
               WHERE d.jobid = j.jobid)                     AS last_start,
             (SELECT count(*) FILTER (WHERE d.status <> 'succeeded')
                FROM (SELECT d2.status
                        FROM cron.job_run_details d2
                       WHERE d2.jobid = j.jobid
                         AND d2.end_time IS NOT NULL
                       ORDER BY d2.start_time DESC
                       LIMIT 3) d)                          AS recent_bad,
             (SELECT count(*)
                FROM (SELECT 1
                        FROM cron.job_run_details d3
                       WHERE d3.jobid = j.jobid
                         AND d3.end_time IS NOT NULL
                       ORDER BY d3.start_time DESC
                       LIMIT 3) d)                          AS recent_total
        FROM expected e
        LEFT JOIN cron.job j ON j.jobname = e.jobname
    )
    SELECT l.jobname,
           l.expected_max_gap,
           l.last_start,
           l.registered_at,
           CASE
             WHEN l.jobid IS NULL THEN 'unscheduled'
             WHEN l.active IS FALSE THEN 'inactive'
             -- The blackout grace applies ONLY to a job that was healthy going
             -- into it (its own clock had not already run out when the
             -- scheduler went quiet). A job already dead before the blackout
             -- keeps its original clock, so an outage never hides it.
             -- GREATEST ignores NULLs: with no blackout the anchor is exactly
             -- what it was before this migration.
             WHEN l.last_start IS NULL
                  AND GREATEST(l.registered_at,
                        CASE WHEN l.registered_at >= v_gap_start - l.expected_max_gap
                             THEN v_resumed_at END) < now() - l.expected_max_gap
               THEN 'never-ran'
             WHEN l.last_start IS NOT NULL
                  AND GREATEST(l.last_start,
                        CASE WHEN l.last_start >= v_gap_start - l.expected_max_gap
                             THEN v_resumed_at END) < now() - l.expected_max_gap
               THEN 'dead'
             WHEN l.recent_total >= 3 AND l.recent_bad = l.recent_total THEN 'erroring'
             ELSE NULL
           END AS verdict
      FROM live l
  LOOP
    CONTINUE WHEN r.verdict IS NULL;

    IF NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.tags->>'source' = 'cron-dead'
         AND e.tags->>'job' = r.jobname
         AND e.created_at > date_trunc('day', now())
    ) THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        CASE r.verdict
          WHEN 'unscheduled' THEN
            format('Cron %s is expected to run but does not exist in cron.job', r.jobname)
          WHEN 'inactive' THEN
            format('Cron %s exists but is disabled (active = false)', r.jobname)
          WHEN 'never-ran' THEN
            format('Cron %s has never fired since it was registered at %s (tolerance %s)',
                   r.jobname, r.registered_at, r.expected_max_gap)
          WHEN 'erroring' THEN
            format('Cron %s is firing but its last 3 runs all failed inside pg_cron', r.jobname)
          ELSE
            format('Dead cron: %s has not fired since %s (tolerance %s)',
                   r.jobname, r.last_start, r.expected_max_gap)
        END,
        jsonb_build_object('source', 'cron-dead', 'area', 'cron',
                           'job', r.jobname, 'verdict', r.verdict),
        jsonb_build_object('last_start',         r.last_start,
                           'registered_at',      r.registered_at,
                           'scheduler_resumed_at', v_resumed_at,
                           'expected_max_gap',   r.expected_max_gap::text,
                           'verdict',            r.verdict));
      v_flagged := v_flagged + 1;
      v_names := v_names || r.jobname;
    END IF;
  END LOOP;

  IF v_flagged > 0 THEN
    -- ONE message for the whole roll-up. The per-job rows above are severity
    -- 'error', which trg_error_logs_slack no longer posts.
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s cron(s) are not running as scheduled', v_flagged),
          'message', format('Affected: %s. Each missed at least one full tolerance while the scheduler was running. See error_logs (tags.source = cron-dead).',
                            array_to_string(v_names, ', ')),
          'severity', 'critical'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- The digest is watched from here (hourly). Its failure must not take this
  -- sweep down, but it is recorded, never swallowed.
  BEGIN
    v_digest := public.check_ops_digest_delivery();
  EXCEPTION WHEN OTHERS THEN
    v_digest := jsonb_build_object('ok', false, 'check_error', SQLERRM);
    INSERT INTO public.error_logs (severity, message, tags)
    VALUES ('error', 'check_ops_digest_delivery raised: ' || SQLERRM,
            jsonb_build_object('source', 'cron-dead', 'area', 'alerting', 'job', 'check_ops_digest_delivery'));
  END;

  RETURN jsonb_build_object('flagged', v_flagged, 'jobs', to_jsonb(v_names),
                            'scheduler_resumed_at', v_resumed_at,
                            'digest_delivery', v_digest);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_dead_crons() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sweep_dead_crons() IS
  'Liveness for every scheduled job from cron.job_run_details. A job''s tolerance is measured from the later of its last firing and the end of the most recent scheduler blackout, so an outage is reported once (sweep_cron_blackouts) instead of as every job being dead. One Slack roll-up per run.';

-- ── 2. A blackout of any length is seen ─────────────────────────────────────
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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN jsonb_build_object('flagged', 0, 'skipped', 'pg_cron not installed');
  END IF;

  -- Differenced over the whole retained history, then restricted to gaps that
  -- ENDED in the last 24 hours. Restricting the rows first (the old version)
  -- made any gap longer than the window invisible.
  SELECT g.prev_start, g.start_time,
         extract(epoch FROM (g.start_time - g.prev_start)) / 60
    INTO v_gap_start, v_gap_end, v_minutes
    FROM (
      SELECT d.start_time,
             lag(d.start_time) OVER (ORDER BY d.start_time) AS prev_start
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '8 days'
    ) g
   WHERE g.prev_start IS NOT NULL
     AND g.start_time > now() - interval '24 hours'
   ORDER BY (g.start_time - g.prev_start) DESC
   LIMIT 1;

  IF v_minutes IS NULL OR v_minutes < 15 THEN
    RETURN jsonb_build_object('flagged', 0,
                              'largest_gap_minutes', COALESCE(round(v_minutes, 1), 0));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE e.tags->>'source' = 'cron-blackout'
       AND e.context->>'gap_start' = v_gap_start::text
  ) THEN
    RETURN jsonb_build_object('flagged', 0, 'already_reported', v_gap_start);
  END IF;

  -- Stored as text so the dedupe above compares like with like.
  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    'error',
    format('pg_cron dispatched nothing for %s minutes (%s → %s) — every scheduled job in the product was silent',
           round(v_minutes, 1), v_gap_start, v_gap_end),
    jsonb_build_object('source', 'cron-blackout', 'area', 'cron'),
    jsonb_build_object('gap_start',   v_gap_start::text,
                       'gap_end',     v_gap_end::text,
                       'gap_minutes', round(v_minutes, 1)));

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'title', format('Prod scheduler was down for %s', CASE WHEN v_minutes >= 120
                          THEN round(v_minutes / 60, 1) || ' hours'
                          ELSE round(v_minutes, 0) || ' minutes' END),
        'message', format('No scheduled job fired between %s and %s UTC (database or pg_cron down). It is running again; missed payouts, releases and emails catch up on their next runs. See error_logs (tags.source = cron-blackout).',
                          to_char(v_gap_start AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                          to_char(v_gap_end AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')),
        'severity', 'critical'));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('flagged', 1,
                            'gap_start', v_gap_start,
                            'gap_minutes', round(v_minutes, 1));
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_cron_blackouts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_cron_blackouts() TO service_role;

-- ── 3. Only critical, server-written error_logs rows post immediately ───────
--
-- error_logs.severity is CHECKed to info/warning/error/fatal (verified live,
-- error_logs_severity_check), so "critical" is decided here, not by a severity
-- value nobody can write:
--   * severity = 'fatal', or
--   * tags.source in the money/security list below (kept identical to
--     CRITICAL_ERROR_LOG_SOURCES in supabase/functions/_shared/alertPolicy.ts;
--     src/test/alertPolicy.test.ts compares the two).
-- The cron watchers (cron-dead, cron-http, cron-silent, cron-blackout,
-- instant-payout-reaper) are deliberately absent: they post one roll-up each.
CREATE OR REPLACE FUNCTION public.notify_slack_on_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent   int;
  v_title    text;
  v_source   text;
  v_role     text;
  v_critical_sources CONSTANT text[] := ARRAY[
    'detect_stuck_payments',
    'auto_start_due_jobs',
    'detect_suspicious_user_patterns',
    'rls-escalation-refused'
  ];
BEGIN
  v_source := COALESCE(
    CASE WHEN jsonb_typeof(NEW.tags) = 'object' THEN COALESCE(NEW.tags ->> 'source', NEW.tags ->> 'area') END,
    'app');

  IF NOT (NEW.severity = 'fatal' OR v_source = ANY (v_critical_sources)) THEN
    RETURN NEW;  -- counted in send_ops_daily_digest()
  END IF;

  -- error_logs accepts inserts from any client (anyone_can_insert_errors), so a
  -- browser-written row never pages; it still appears in the digest. The one
  -- exception is rls-escalation-refused, which a SERVER trigger writes inside
  -- the offending user's own request (so its role is 'authenticated'); the
  -- per-source throttle below bounds any forged copies.
  BEGIN
    v_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;
  IF v_role IN ('anon', 'authenticated') AND v_source <> 'rls-escalation-refused' THEN
    RETURN NEW;
  END IF;

  -- At most one post per source per 10 minutes (the rest are in error_logs and
  -- the digest). Bounds a burst and any forged rows.
  SELECT count(*) INTO v_recent
  FROM public.error_logs e
  WHERE e.id <> NEW.id
    AND e.created_at > now() - interval '10 minutes'
    AND (e.message = NEW.message
         OR (jsonb_typeof(e.tags) = 'object'
             AND COALESCE(e.tags ->> 'source', e.tags ->> 'area') = v_source));
  IF v_recent > 0 THEN
    RETURN NEW;
  END IF;

  v_title := left(format('[%s] %s', v_source, NEW.message), 140);

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'kind', 'custom',
        'severity', 'critical',
        'title', v_title,
        'message', left(COALESCE(NEW.message, ''), 900),
        'fields', jsonb_build_object(
          'url', COALESCE(NEW.url, '—'),
          'error_logs.id', NEW.id::text),
        'link', '/admin?view=health'));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_slack_on_error_log() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_error_logs_slack ON public.error_logs;
CREATE TRIGGER trg_error_logs_slack
  AFTER INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.notify_slack_on_error_log();

COMMENT ON TRIGGER trg_error_logs_slack ON public.error_logs IS
  'Posts server-written fatal rows and money/security sources to #ops-alerts (one per source per 10 min). Everything else goes to the daily digest (send_ops_daily_digest). Supersedes the 2026-09-07 every-row rule.';

-- ── 4. One daily digest for everything that is not critical ─────────────────
CREATE OR REPLACE FUNCTION public.send_ops_daily_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_total   int;
  v_groups  int;
  v_lines   text;
  v_message text;
  v_request bigint;
BEGIN
  WITH src AS (
    SELECT COALESCE(
             CASE WHEN jsonb_typeof(e.tags) = 'object'
                  THEN COALESCE(e.tags ->> 'source', e.tags ->> 'area') END,
             CASE WHEN jsonb_typeof(e.context) = 'string' THEN e.context #>> '{}' END,
             'app') AS source,
           e.severity,
           e.message,
           e.created_at
      FROM public.error_logs e
     WHERE e.created_at > now() - interval '24 hours'
       AND NOT (jsonb_typeof(e.tags) = 'object' AND e.tags ->> 'source' = 'ops-digest')
  ),
  grouped AS (
    SELECT s.source,
           count(*) AS n,
           string_agg(DISTINCT s.severity, '/') AS severities,
           (array_agg(s.message ORDER BY s.created_at DESC))[1] AS latest
      FROM src s
     GROUP BY s.source
  )
  SELECT (SELECT count(*) FROM src),
         (SELECT count(*) FROM grouped),
         string_agg(format('• *%s* ×%s (%s): %s', g.source, g.n, g.severities,
                           replace(left(g.latest, 110), E'\n', ' ')),
                    E'\n' ORDER BY g.n DESC)
           FILTER (WHERE g.rn <= 15)
    INTO v_total, v_groups, v_lines
    FROM (SELECT grouped.*, row_number() OVER (ORDER BY n DESC) AS rn FROM grouped) g;

  v_message := CASE
    WHEN COALESCE(v_total, 0) = 0 THEN 'Nothing logged in the last 24 hours. (This message is the daily proof that alerting works.)'
    ELSE left(v_lines, 2700)
         || CASE WHEN v_groups > 15 THEN format(E'\n…and %s more sources.', v_groups - 15) ELSE '' END
         || E'\nNone of these paged. Critical items (prod down, money at risk, deploy failed, security) post on their own.'
  END;

  BEGIN
    v_request := net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'kind', 'digest',
        'severity', 'info',
        'title', format('Daily ops digest: %s event(s) in 24h', COALESCE(v_total, 0)),
        'message', v_message,
        'link', '/admin?view=health'));
  EXCEPTION WHEN OTHERS THEN
    v_request := NULL;
  END;

  -- The delivery record check_ops_digest_delivery() reads. Written even when
  -- the enqueue failed (request_id null), so a failure is seen, not inferred.
  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES ('info',
          format('Daily ops digest enqueued (%s events)', COALESCE(v_total, 0)),
          jsonb_build_object('source', 'ops-digest', 'area', 'alerting'),
          jsonb_build_object('request_id', v_request));

  RETURN jsonb_build_object('total', COALESCE(v_total, 0), 'sources', COALESCE(v_groups, 0),
                            'request_id', v_request, 'posted', v_request IS NOT NULL);
END;
$fn$;

REVOKE ALL ON FUNCTION public.send_ops_daily_digest() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_ops_daily_digest() TO service_role;

-- ── 5. The digest is itself watched ─────────────────────────────────────────
-- Called hourly from sweep_dead_crons(). Pages (critical, once per UTC day) when
-- there has been no SUCCESSFULLY delivered digest in 30 hours:
--   * no digest record at all in 30 h (the cron did not run or raised), or
--   * the latest record's HTTP response is known and is not a delivered post
--     (non-200, timed out, or slack-ops-alert answered ok:false — it answers
--     200 with ok:false when Slack refuses), and no earlier one in the window
--     was delivered.
-- pg_net keeps responses for ~6 hours, so a response that has aged out is
-- "unknown", not failed; the 30-hour record check still covers a dead cron.
CREATE OR REPLACE FUNCTION public.check_ops_digest_delivery()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_records   int;
  v_delivered int := 0;
  v_failed    int := 0;
  v_problem   text;
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
       WHERE jsonb_typeof(e.tags) = 'object'
         AND e.tags ->> 'source' = 'ops-digest'
         AND e.created_at > now() - interval '30 hours'
         AND e.created_at < now() - interval '10 minutes'
    $q$ INTO v_delivered, v_failed;
  END IF;

  v_problem := CASE
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
$fn$;

REVOKE ALL ON FUNCTION public.check_ops_digest_delivery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_ops_digest_delivery() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping ops-daily-digest';
    RETURN;
  END IF;
  PERFORM cron.unschedule('ops-daily-digest')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-daily-digest');
  -- 14:40 UTC: clear of 14:00 sweep-daily-job-digest, 14:14 expiring-jobs-push
  -- and 14:19 weekly-helper-report.
  PERFORM cron.schedule('ops-daily-digest', '40 14 * * *',
    $cron$SELECT public.send_ops_daily_digest();$cron$);
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap)
  VALUES ('ops-daily-digest', interval '30 hours')
  ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
END;
$$;
