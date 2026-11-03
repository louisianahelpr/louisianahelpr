-- Q2368 (lead 11-03): a stripe-connect `reset` and stripe-webhook accountUpdated's dead-account gate close now leave a
-- durable record: one server-side severity-info error_logs row each (tags.source 'stripe-connect', tags.kind
-- 'connect-reset' / 'connect-dead-account-close', the user and the old and new account ids). Before, the first was
-- console only and the second a function log only, so on 2026-10-23 a lost account and three closed gates could not
-- be traced once edge logs aged out.
--
-- Those rows record a change; they are not alerts. Nothing new may reach the owner, so:
--   * public.error_log_is_record_only(tags) names exactly those two kinds (from the server: tags.origin 'server',
--     which stamp_error_log_origin sets and a client cannot claim);
--   * notify_slack_on_error_log (restated from 20261004004835, prod md5(prosrc) d1432bbba6237e5468953f74d0c8ddf0
--     read 11-03, byte for byte that file) returns before posting for them;
--   * ops_alert_ledger_from_error_log (restated from 20261102225216, prod md5(prosrc) d042a79c060d2905423a421ba0e37549
--     read 11-03, byte for byte that file) records no ledger item for them, so open-sync-trackers never sees them.
-- The ledger function's only change is that one early return. The Slack function also leaves record-only rows out
-- of its once-per-source throttle count (they never posted, so they must not mute the next real stripe-connect post). Guard: src/test/connectRecordOnlyRowsNeverPage.test.ts;
-- PGlite src/test/pglite/connectRecordOnlyRowsNeverPage.pglite.mjs.
--
-- Replay-safe: CREATE OR REPLACE throughout; the triggers already point at the functions by name.

CREATE OR REPLACE FUNCTION public.error_log_is_record_only(p_tags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT jsonb_typeof(p_tags) = 'object'
     AND coalesce(p_tags ->> 'origin', '') = 'server'
     AND coalesce(p_tags ->> 'source', '') = 'stripe-connect'
     AND coalesce(p_tags ->> 'kind', '') IN ('connect-reset', 'connect-dead-account-close');
$fn$;

REVOKE ALL ON FUNCTION public.error_log_is_record_only(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.error_log_is_record_only(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_slack_on_error_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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

  -- ADDED 20261103203658 (Q2368, lead 11-03): stripe-connect's record-only rows (a member's payout-account reset,
  -- the webhook closing a dead account's cached gate) are the durable record of a change, not something broken.
  -- They never page; they stay in error_logs.
  IF public.error_log_is_record_only(NEW.tags) THEN
    RETURN NEW;
  END IF;

  -- Seed/E2E data (tags.seed or a '-seed' source) goes to the daily digest,
  -- which lists every error_logs row by source. It never pages. Real rows are
  -- untouched (20260923052520).
  IF public.error_log_is_seed(NEW.tags) THEN
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
  WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.id <> NEW.id
    -- ADDED 20261103203658 (Q2368): a record-only row never posted, so it must not mute the next real post.
    AND NOT public.error_log_is_record_only(e.tags)
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
$fn$;

REVOKE ALL ON FUNCTION public.notify_slack_on_error_log() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ops_alert_ledger_from_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tags   jsonb := CASE WHEN jsonb_typeof(NEW.tags) = 'object' THEN NEW.tags ELSE '{}'::jsonb END;
  v_source text;
BEGIN
  -- Same trust line as notify_slack_on_error_log: a browser can write these.
  IF v_tags ->> 'origin' = 'client' THEN
    RETURN NULL;
  END IF;
  -- ADDED 20261103203658 (Q2368, lead 11-03): stripe-connect's record-only rows are never a ledger item (and so
  -- never an OPEN item through open-sync-trackers); the error_logs row stays.
  IF public.error_log_is_record_only(v_tags) THEN
    RETURN NULL;
  END IF;
  -- Seed/E2E data: listed in the daily digest under its '-seed' source, not a
  -- to-do in the ledger (20260923052520). Same predicate as the Slack trigger.
  IF public.error_log_is_seed(v_tags) THEN
    RETURN NULL;
  END IF;
  v_source := coalesce(v_tags ->> 'source', v_tags ->> 'area', 'app');
  -- postSlackOpsAlert records its own ledger entry; ops-digest is the digest's
  -- delivery receipt (read by check_ops_digest_delivery), not an alert.
  -- sweep_old_notifications' info row is its own "I ran, deleted N" receipt
  -- (owner closed Q2545 11-02: an intended notice, not a defect). The row stays
  -- in error_logs for anyone checking the sweeper; it is never a ledger item.
  IF v_source IN ('ops-alert', 'ops-digest', 'sweep_old_notifications') THEN
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM public.ops_alert_record(
      'error_logs',
      v_source,
      split_part(coalesce(NEW.message, ''), ' — ', 1),
      coalesce(NEW.severity, 'error'),
      left(coalesce(NEW.message, ''), 1000),
      jsonb_strip_nulls(jsonb_build_object(
        'error_log_id', NEW.id,
        'job', v_tags ->> 'job',
        'job_id', v_tags ->> 'job_id',
        'queue', v_tags ->> 'queue',
        'url', NEW.url)),
      NULL, NULL,
      coalesce(NEW.created_at, now()));
  EXCEPTION WHEN OTHERS THEN
    -- The ledger must never take down the write that raised the alert. Loud in
    -- the Postgres log, and the error_logs row itself still exists.
    RAISE WARNING 'ops_alert_ledger_from_error_log: % (error_logs.id=%)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_ledger_from_error_log() FROM PUBLIC, anon, authenticated;
