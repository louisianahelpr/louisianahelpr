-- Q113 (docs/OPEN.md; MEDIUM, from the Q106/Q98 authz review).
--
-- WHAT WAS BROKEN. throttle_client_error_log (20260923094457) kept ONE shared
-- bucket for every guest: 120 client rows per minute across all anonymous
-- callers. Anyone holding the public anon key could fill it with junk, and for
-- the rest of that minute every REAL guest's error row was dropped. The drop
-- was RETURN NULL and nothing recorded it, so the thing that blinds incident
-- detection was itself invisible, exactly when an incident is under way.
--
-- (a) ONE SOURCE CANNOT FILL THE BUCKET. Measured on prod 2026-09-23, 30 days
--     of guest client rows (user_id NULL; tags.origin = 'client', or
--     pre-stamp rows with a user_agent): 145 rows in 78 active minutes; peak
--     7 rows in one minute; peak 6 rows of ONE fingerprint in one minute (p99
--     also 6); peak 5 distinct fingerprints in one minute; 51 fingerprints in
--     the month. The fingerprint is the normalised message + the normalised
--     url PATH (ops_alert_normalise: ids, numbers, uuids, emails collapse), so
--     a loop that only varies an id or a counter is one fingerprint.
--       v_guest_fp_cap = 20   per fingerprint per minute (3.3x the peak of 6)
--       v_guest_cap    = 300  all guests together (was 120; 43x the peak of 7)
--     A single flooding message now spends at most 20 of the 300, so it takes
--     15+ DIFFERENT fingerprints to fill the bucket. HONEST LIMIT: a caller who
--     varies the words of the message can still do that. What changes is (b):
--     it can no longer do it silently.
--     The fingerprint is computed once, at insert, and stored as
--     tags.guest_fp (overwriting anything the client sent), so the count is a
--     plain equality over the last minute's guest rows.
--
-- (b) DROPS ARE VISIBLE.
--     public.error_log_throttle_drops: one row per (minute, backend pid, kind),
--       bumped by record_error_log_throttle_drop(kind) each time the throttle
--       drops a row. kind: 'guest' (global), 'guest_fp' (per fingerprint),
--       'account' (per signed-in account, cap unchanged at 60). Keyed by
--       backend pid, so the upsert only ever meets a row written by an EARLIER
--       transaction on the same connection: it cannot wait on another live
--       transaction. It is still bounded (lock_timeout 50ms + a
--       lock_not_available fallback, as src/test/errorLogTriggersNeverWait.test.ts
--       requires) and never raises: if the count cannot be written the row is
--       still dropped, never kept or errored. Bounded size: at most
--       minutes x backends x 3 rows; 14 days kept.
--     check_error_log_throttle() (pg_cron every 5 minutes): when drops landed
--       in >= 2 of the last 10 COMPLETE minutes ("sustained"), writes one
--       server error_logs row, source 'error-log-throttled' (at most one per
--       15 minutes), which trg_error_logs_zz_ledger turns into an
--       ops_alert_ledger item. A one-minute burst is still in the counter
--       table, it just does not page.
--     ops_alert_condition('error-log-throttled'): still failing while the
--       latest COMPLETE minute had drops; cleared only when that minute began
--       after the last occurrence and was clean; before such a minute exists,
--       NULL (cannot tell), never "cleared". Body = the live
--       pg_get_functiondef (20260923090536's, md5 bf7aab70... on prod) plus
--       this one branch and its variable.
--
-- Replay-safe: the table is created only if missing, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS, cron.schedule upserts by name, cron_work_expectations ON CONFLICT.

-- ── 1. the drop counter (server-only) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.error_log_throttle_drops (
  minute      timestamptz NOT NULL,
  backend_pid int         NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('guest', 'guest_fp', 'account')),
  dropped     int         NOT NULL DEFAULT 1,
  first_at    timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (minute, backend_pid, kind)
);
ALTER TABLE public.error_log_throttle_drops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.error_log_throttle_drops FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.error_log_throttle_drops TO service_role;
COMMENT ON TABLE public.error_log_throttle_drops IS
  'Q113: rows dropped by throttle_client_error_log, per minute x backend pid x kind (guest | guest_fp | account). Written only by record_error_log_throttle_drop; read by check_error_log_throttle and ops_alert_condition(''error-log-throttled''). 14 days kept.';

-- ── 2. record a drop: bounded, never raises ────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_error_log_throttle_drop(p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $rec$
DECLARE
  v_prev text := current_setting('lock_timeout');
BEGIN
  BEGIN
    -- Keyed by backend pid: the only row this can meet was written by an
    -- earlier transaction on this same connection. Bounded anyway.
    IF v_prev IN ('0', '') OR v_prev::interval > interval '50 milliseconds' THEN
      PERFORM set_config('lock_timeout', '50ms', true);
    END IF;
    INSERT INTO public.error_log_throttle_drops AS d (minute, backend_pid, kind, dropped, first_at, last_at)
    VALUES (date_trunc('minute', now()), pg_backend_pid(), p_kind, 1, now(), now())
    ON CONFLICT (minute, backend_pid, kind)
    DO UPDATE SET dropped = d.dropped + 1, last_at = EXCLUDED.last_at;
    PERFORM set_config('lock_timeout', v_prev, true);
  EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
    -- The sub-block's abort restored lock_timeout. The row is still dropped.
    NULL;
  WHEN OTHERS THEN
    NULL;
  END;
END;
$rec$;

COMMENT ON FUNCTION public.record_error_log_throttle_drop(text) IS
  'Q113: bumps error_log_throttle_drops for this minute/backend/kind. lock_timeout 50ms, swallows every error: counting a drop can never block or break the insert path.';

REVOKE ALL ON FUNCTION public.record_error_log_throttle_drop(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_error_log_throttle_drop(text) TO service_role;

-- ── 3. the throttle (from the live pg_get_functiondef) ─────────────────────
CREATE OR REPLACE FUNCTION public.throttle_client_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $throttle$
DECLARE
  v_account_cap  CONSTANT int := 60;   -- per signed-in account per minute
  v_guest_cap    CONSTANT int := 300;  -- all guests together per minute (Q113: was 120)
  v_guest_fp_cap CONSTANT int := 20;   -- one guest fingerprint per minute (Q113)
  v_n  int;
  v_fp text;
BEGIN
  -- Server rows (edge functions, cron, SECURITY DEFINER paths) are never
  -- throttled. tags.origin was stamped by trg_error_logs_00_stamp_origin and
  -- a client cannot claim 'server'.
  IF coalesce(NEW.tags ->> 'origin', '') <> 'client' THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.user_id IS NULL THEN
      -- Q113: normalised message + normalised url path. Stored on the row
      -- (overwriting anything the client sent) so the count is an equality.
      v_fp := md5(
        coalesce(public.ops_alert_normalise(left(coalesce(NEW.message, ''), 300)), '') || '|' ||
        coalesce(public.ops_alert_normalise(
          substring(coalesce(NEW.url, '') from '^(?:[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*)?([^?#]*)')), ''));
      NEW.tags := jsonb_set(NEW.tags, '{guest_fp}', to_jsonb(v_fp), true);

      SELECT count(*) INTO v_n FROM (
        SELECT 1 FROM public.error_logs e
         WHERE e.user_id IS NULL
           AND e.created_at > now() - interval '1 minute'
           AND e.tags ->> 'origin' = 'client'
           AND e.tags ->> 'guest_fp' = v_fp
         LIMIT v_guest_fp_cap) x;
      IF v_n >= v_guest_fp_cap THEN
        PERFORM public.record_error_log_throttle_drop('guest_fp');
        RETURN NULL;
      END IF;

      SELECT count(*) INTO v_n FROM (
        SELECT 1 FROM public.error_logs e
         WHERE e.user_id IS NULL
           AND e.created_at > now() - interval '1 minute'
           AND e.tags ->> 'origin' = 'client'
         LIMIT v_guest_cap) x;
      IF v_n >= v_guest_cap THEN
        PERFORM public.record_error_log_throttle_drop('guest');
        RETURN NULL;
      END IF;
    ELSE
      SELECT count(*) INTO v_n FROM (
        SELECT 1 FROM public.error_logs e
         WHERE e.user_id = NEW.user_id
           AND e.created_at > now() - interval '1 minute'
           AND e.tags ->> 'origin' = 'client'
         LIMIT v_account_cap) x;
      IF v_n >= v_account_cap THEN
        PERFORM public.record_error_log_throttle_drop('account');
        RETURN NULL;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The logger must never break the app: on any failure, keep the row.
    RETURN NEW;
  END;

  RETURN NEW;
END;
$throttle$;

COMMENT ON FUNCTION public.throttle_client_error_log() IS
  'BEFORE INSERT on error_logs (after the origin stamp). Drops (RETURN NULL) a client-origin row once, in the last minute, that account has 60 client rows, that guest fingerprint (normalised message + url path, stored as tags.guest_fp) 20, or all guests together 300; every drop is counted in error_log_throttle_drops (Q113). Never raises; server rows untouched (Q98).';

REVOKE ALL ON FUNCTION public.throttle_client_error_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.throttle_client_error_log() TO service_role;

DROP TRIGGER IF EXISTS trg_error_logs_01_throttle ON public.error_logs;
CREATE TRIGGER trg_error_logs_01_throttle
  BEFORE INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.throttle_client_error_log();

-- ── 4. the check: sustained throttling -> one error_logs row -> ledger ─────
CREATE OR REPLACE FUNCTION public.check_error_log_throttle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $chk$
DECLARE
  v_min_minutes CONSTANT int := 2;    -- "sustained": drops in >= 2 minutes ...
  v_lookback    CONSTANT int := 10;   -- ... of the last 10 complete minutes
  v_now_min  timestamptz := date_trunc('minute', now());
  v_minutes  int;
  v_dropped  bigint;
  v_by_kind  jsonb;
  v_raised   boolean := false;
BEGIN
  SELECT count(DISTINCT d.minute), coalesce(sum(d.dropped), 0)
    INTO v_minutes, v_dropped
    FROM public.error_log_throttle_drops d
   WHERE d.minute >= v_now_min - make_interval(mins => v_lookback)
     AND d.minute < v_now_min;
  SELECT coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) INTO v_by_kind
    FROM (SELECT d.kind, sum(d.dropped) n FROM public.error_log_throttle_drops d
           WHERE d.minute >= v_now_min - make_interval(mins => v_lookback)
             AND d.minute < v_now_min
           GROUP BY d.kind) k;

  IF v_minutes >= v_min_minutes AND NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE e.created_at > now() - interval '15 minutes'
       AND jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'error-log-throttled')
  THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error',
            format('Client error logs throttled — %s rows dropped in %s of the last %s minutes (%s). See docs/OPEN.md Q113.',
                   v_dropped, v_minutes, v_lookback, v_by_kind::text),
            jsonb_build_object('source', 'error-log-throttled', 'area', 'observability'),
            jsonb_build_object('dropped', v_dropped, 'minutes', v_minutes, 'lookback_minutes', v_lookback,
                               'by_kind', v_by_kind));
    v_raised := true;
  END IF;

  DELETE FROM public.error_log_throttle_drops WHERE minute < now() - interval '14 days';

  RETURN jsonb_build_object('ok', v_minutes < v_min_minutes, 'dropped', v_dropped, 'minutes', v_minutes,
                            'lookback_minutes', v_lookback, 'by_kind', v_by_kind, 'raised', v_raised);
END;
$chk$;

REVOKE ALL ON FUNCTION public.check_error_log_throttle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_error_log_throttle() TO service_role;

-- ── 5. ledger close rule (live body + one branch) ──────────────────────────
CREATE OR REPLACE FUNCTION public.ops_alert_condition(p_source text, p_sample_ref jsonb, p_since timestamp with time zone, p_probe_only boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job   text := p_sample_ref ->> 'job';
  v_dlq   text;
  v_depth bigint;
  v_probs text[];
  v_logp  text;
  v_min   timestamptz;
BEGIN
  IF p_source = 'detect_stuck_payments' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- The detector's own predicate for REAL jobs, minus its notification
    -- dedupe. Seed jobs are the '-seed' source's, which never reaches here.
    RETURN EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.stripe_session_id IS NOT NULL
         AND j.payment_status = 'unpaid'
         AND j.created_at < now() - interval '10 minutes'
         AND j.created_at > now() - interval '24 hours'
         AND NOT (j.status = 'cancelled'
                  AND coalesce(j.cancelled_at, j.updated_at) > now() - interval '2 hours')
         AND NOT coalesce(j.is_seed, false)
         AND NOT EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.user_id = j.customer_id AND p.is_seed IS TRUE));

  ELSIF p_source = 'ops-digest-undelivered' THEN
    IF p_probe_only THEN RETURN true; END IF;
    IF to_regprocedure('public.check_ops_digest_delivery()') IS NULL THEN RETURN NULL; END IF;
    -- SIDE EFFECTS: this is not a pure question. When delivery is NOT ok,
    -- check_ops_digest_delivery() INSERTs an error_logs row (which feeds this
    -- ledger through trg_error_logs_zz_ledger) and POSTs to Slack via
    -- slack-ops-alert — at most once per UTC day (its own dedupe). So an hourly
    -- ops_alert_verify() can raise the day's digest alert itself. 'ok' is
    -- computed before that dedupe, so it is honest on a day already reported.
    RETURN NOT coalesce((public.check_ops_digest_delivery() ->> 'ok')::boolean, false);

  ELSIF p_source = 'push-tokens-empty' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q82. Still failing while no REAL user has a push token. Pure question:
    -- the daily cron owns the report, so re-asking here writes nothing.
    RETURN NOT EXISTS (
      SELECT 1 FROM public.push_tokens t
       WHERE NOT EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.user_id = t.user_id AND p.is_seed IS TRUE));

  ELSIF p_source = 'db-saturation' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q53. Judged by a 5-minute sample taken AFTER the last occurrence. None
    -- yet (or the cron has stopped) = cannot tell, never "cleared".
    SELECT s.db_problems INTO v_probs
      FROM public.db_saturation_samples s
     WHERE s.origin = 'cron' AND s.sampled_at > p_since
     ORDER BY s.sampled_at DESC LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN cardinality(v_probs) > 0;

  ELSIF p_source = 'db-statement-timeouts' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q53. Judged by the next postgres_logs count the workflow passes in.
    SELECT s.log_problem INTO v_logp
      FROM public.db_saturation_samples s
     WHERE s.log_timeouts IS NOT NULL AND s.sampled_at > p_since
     ORDER BY s.sampled_at DESC LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN v_logp IS NOT NULL;

  ELSIF p_source = 'error-log-throttled' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q113. Judged by the latest COMPLETE minute. It must have begun after the
    -- last occurrence; until one has, cannot tell (NULL), never "cleared".
    -- Still failing while that minute dropped anything; a clean one clears it.
    v_min := date_trunc('minute', now()) - interval '1 minute';
    IF v_min < p_since THEN RETURN NULL; END IF;
    RETURN EXISTS (SELECT 1 FROM public.error_log_throttle_drops d WHERE d.minute = v_min);

  ELSIF p_source IN ('email-dlq-auth', 'email-dlq-transactional') THEN
    IF p_probe_only THEN RETURN true; END IF;
    v_dlq := CASE p_source WHEN 'email-dlq-auth' THEN 'auth_emails_dlq' ELSE 'transactional_emails_dlq' END;
    IF to_regclass('pgmq.q_' || v_dlq) IS NULL THEN RETURN NULL; END IF;
    -- Evidence per recipient, not queue depth (Q29): archiving a dead letter
    -- empties the queue without anyone receiving anything. Still failing while
    --   (a) a dead letter to a NON-seed recipient is still queued, or
    --   (b) an ARCHIVED one has no later 'sent' email_send_log row to that
    --       recipient for that template (label, else the source queue name —
    --       the name process-email-queue logs under).
    EXECUTE format(
      'SELECT count(*) FROM pgmq.%I m WHERE NOT public.is_seed_email(m.message ->> %L)',
      'q_' || v_dlq, 'to') INTO v_depth;
    IF v_depth > 0 THEN RETURN true; END IF;
    IF to_regclass('pgmq.a_' || v_dlq) IS NOT NULL THEN
      EXECUTE format(
        'SELECT count(*) FROM pgmq.%I a
          WHERE NOT public.is_seed_email(a.message ->> %L)
            AND NOT EXISTS (
              SELECT 1 FROM public.email_send_log s
               WHERE lower(s.recipient_email) = lower(a.message ->> %L)
                 AND s.status = %L
                 AND s.template_name = coalesce(a.message ->> %L, %L)
                 AND s.created_at > a.enqueued_at)',
        'a_' || v_dlq, 'to', 'to', 'sent', 'label', replace(v_dlq, '_dlq', '')) INTO v_depth;
      IF v_depth > 0 THEN RETURN true; END IF;
    END IF;
    RETURN false;

  ELSIF p_source IN ('cron-dead', 'cron-startup-timeout') AND v_job IS NOT NULL THEN
    IF p_probe_only THEN RETURN true; END IF;
    IF to_regclass('cron.job_run_details') IS NULL THEN RETURN NULL; END IF;
    -- Cleared only by a run that SUCCEEDED after the last report.
    RETURN NOT EXISTS (
      SELECT 1 FROM cron.job_run_details d
        JOIN cron.job c ON c.jobid = d.jobid
       WHERE c.jobname = v_job
         AND d.status = 'succeeded'
         AND d.start_time > p_since);

  ELSIF p_source = 'user-error-screen' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q39. Re-asks error_logs itself, not the ledger's last_seen: still failing
    -- while a REAL (non-seed) person was shown this screen+message in the last
    -- 24 hours. The overflow item ("new-screen cap reached") has no single
    -- screen, so it is still failing while ANY real user-error-screen row
    -- landed in the last 24 hours.
    IF coalesce((p_sample_ref ->> 'overflow')::boolean, false) THEN
      RETURN EXISTS (
        SELECT 1 FROM public.error_logs e
         WHERE e.created_at > now() - interval '24 hours'
           AND public.is_user_error_screen_row(e.tags)
           AND public.user_error_screen_is_real(e.user_id, e.tags));
    END IF;
    IF p_sample_ref ->> 'title_norm' IS NULL THEN RETURN NULL; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.created_at > now() - interval '24 hours'
         AND public.is_user_error_screen_row(e.tags)
         AND public.user_error_screen_is_real(e.user_id, e.tags)
         AND public.ops_alert_normalise(public.user_error_screen_title(e.tags ->> 'screen', e.message))
             = p_sample_ref ->> 'title_norm');
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) TO service_role;

-- ── 6. schedule + liveness ─────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('error-log-throttle-check', interval '20 minutes',
            'Q113: 5-minute check that the client error_logs throttle is not dropping rows in a sustained way (error_log_throttle_drops).')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('error-log-throttle-check', '*/5 * * * *',
                          'SELECT public.check_error_log_throttle();');
  END IF;
END
$do$;
