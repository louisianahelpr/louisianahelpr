-- Every severity reaches Slack now, throttled per source instead of dropped.
--
-- ── WHAT WAS WRONG, and it is not a judgement call ─────────────────────────
-- `notify_slack_on_error_log()` posted only for `severity = 'fatal'` or four
-- allow-listed sources. Everything else returned early with the comment
-- "counted in send_ops_daily_digest()".
--
-- send_ops_daily_digest IS A CRON — `ops-daily-digest`, 14:40 UTC.
--
-- On 2026-09-22 pg_cron refused to START 457 scheduled runs between 06:00 and
-- 15:00 UTC ("job startup timeout": the job did not run late, it did not run).
-- Successes fell from ~78/hour to 8. Nine daily jobs never ran, and
-- `ops-daily-digest` was one of them. So: the outage was reported at severity
-- 'error', 'error' was routed to the digest, and the digest was part of the
-- outage. Nine hours, nobody told.
--
-- Owner, the same day: "I feel like medium and low alerts should show in slack
-- also so that can be fixed."
--
-- This reverses the 2026-09-14 "alerts few and meaningful" rule on purpose.
-- That rule was not wrong about noise; it was wrong to answer noise by
-- DROPPING a severity, because a dropped severity looks exactly like a healthy
-- system.
--
-- ── THE ANSWER TO VOLUME IS A THROTTLE, MEASURED ───────────────────────────
-- error_logs over the 7 days to 2026-09-22: 629 rows, ~90/day. Posting that
-- raw would drown #ops-alerts and teach everyone to skim it — which is how a
-- real page gets missed, so the noise concern is real.
--
-- One post per SOURCE per window, with the window set by severity. Applied to
-- those same 7 days (71 warning source-hours, 49 error, 13 info, 1 fatal):
--
--     fatal     10 min    ~0.1/day
--     error     60 min    ~7/day
--     warning  240 min    ~4/day
--     info     720 min    ~1/day
--
-- ~12 posts/day. Every distinct source still surfaces within hours, and no
-- severity's report depends on a cron surviving.
--
-- Mirrored in supabase/functions/_shared/alertPolicy.ts as
-- SLACK_THROTTLE_MINUTES; src/test/alertPolicy.test.ts asserts the two agree,
-- the same way it already pins CRITICAL_ERROR_LOG_SOURCES.
--
-- ── WHAT IS DELIBERATELY UNCHANGED ─────────────────────────────────────────
--  * THE CLIENT-ORIGIN GUARD. `tags->>'origin' = 'client'` still returns
--    early. A row a browser can write must never be able to page an operator,
--    and widening severities makes that MORE important, not less: it is now
--    the only thing standing between a forged 'warning' and #ops-alerts.
--  * v_critical_sources. Those four still post as CRITICAL whatever severity
--    they carry, so a money/security row cannot be demoted by a stale value.
--  * The failure of the post itself is still swallowed. Slack is the
--    notification; error_logs is the durable record.
--
-- ── THE SEVERITY THE CHANNEL SEES ──────────────────────────────────────────
-- error_logs has four levels, the alert API has three (critical/warning/info).
-- fatal and error both map to 'critical' — that preserves alertPolicy's
-- existing rule that "the SQL watchers send 'error', which has always meant
-- critical here" — while the THROTTLE keys on all four, so an error does not
-- get a fatal's cadence. The DB severity is named in the title so the two are
-- never confused by a reader.

CREATE OR REPLACE FUNCTION public.notify_slack_on_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_recent   int;
  v_title    text;
  v_source   text;
  v_window   interval;
  v_alert_sev text;
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

  -- UNCHANGED AND LOAD-BEARING. A row a browser can write must never page an
  -- operator. Stamped by trg_error_logs_stamp_origin from `current_user`,
  -- which a client cannot choose. Now that every severity posts, this is the
  -- only thing between a forged 'warning' and #ops-alerts.
  IF NEW.tags ->> 'origin' = 'client' THEN
    RETURN NEW;
  END IF;

  -- One post per source per window; the window is the severity's cadence.
  -- Mirrored in alertPolicy.ts SLACK_THROTTLE_MINUTES.
  v_window := CASE NEW.severity
                WHEN 'fatal'   THEN interval '10 minutes'
                WHEN 'error'   THEN interval '60 minutes'
                WHEN 'warning' THEN interval '240 minutes'
                WHEN 'info'    THEN interval '720 minutes'
                ELSE interval '60 minutes'   -- an unreadable severity is not one to quietly drop
              END;

  -- A money/security source keeps the fastest cadence whatever it carries.
  IF v_source = ANY (v_critical_sources) THEN
    v_window := interval '10 minutes';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.error_logs e
  WHERE e.id <> NEW.id
    AND e.created_at > now() - v_window
    AND COALESCE(e.severity, '') = COALESCE(NEW.severity, '')
    AND (jsonb_typeof(e.tags) = 'object'
         AND COALESCE(e.tags ->> 'source', e.tags ->> 'area') = v_source);
  IF v_recent > 0 THEN
    RETURN NEW;
  END IF;

  -- fatal/error -> critical (alertPolicy's existing rule); warning and info
  -- keep their own icon and colour so a page still means "something is broken".
  v_alert_sev := CASE
                   WHEN v_source = ANY (v_critical_sources) THEN 'critical'
                   WHEN NEW.severity IN ('fatal', 'error') THEN 'critical'
                   WHEN NEW.severity = 'warning' THEN 'warning'
                   WHEN NEW.severity = 'info' THEN 'info'
                   ELSE 'critical'
                 END;

  -- The DB severity is in the title because it has four values and the channel
  -- shows three; without this a reader cannot tell an error from a fatal.
  v_title := left(format('[%s/%s] %s', upper(COALESCE(NEW.severity, '?')), v_source, NEW.message), 140);

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'kind', 'custom',
        'severity', v_alert_sev,
        'title', v_title,
        'message', left(COALESCE(NEW.message, ''), 900),
        'fields', jsonb_build_object(
          'url', COALESCE(NEW.url, '—'),
          'db_severity', COALESCE(NEW.severity, '?'),
          'error_logs.id', NEW.id::text),
        'link', '/admin?view=health'));
  EXCEPTION WHEN OTHERS THEN
    -- Slack is the notification; error_logs is the durable record. A failed
    -- post must never take the writing transaction down with it.
    NULL;
  END;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.notify_slack_on_error_log() IS
  'Posts EVERY server-written error_logs severity to #ops-alerts, throttled one post per source per severity-dependent window (fatal 10m, error 60m, warning 240m, info 720m; money/security sources always 10m). Replaces the fatal-only gate of 20260914183932, whose non-fatal path depended on send_ops_daily_digest — itself a cron, which died in the 2026-09-22 startup-timeout outage and left it unreported for nine hours. Client-origin rows still never post.';
