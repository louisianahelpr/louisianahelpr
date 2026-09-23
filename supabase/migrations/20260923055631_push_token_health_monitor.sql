-- Q82: "no device can receive a push" must never sit silent again.
--
-- ── WHAT WAS MEASURED (prod, 2026-09-23) ──────────────────────────────────
--   push_tokens: 0 rows; pg_stat_user_tables.n_tup_ins = 0 since the
--     2026-09-22 15:23 restart.
--   notification_logs channel='push': 3,532 'skipped: no_registered_devices'
--     across 87 users since 2026-09-01. Every push the product has tried to
--     send in three weeks went nowhere, and the only record was a 'skipped'
--     status nobody reads.
--   The owner's iPhone signed into the native app 10 times (2026-09-03..09)
--   on a build that could register. No row. No error. Nothing paged.
--
-- The client-side cause is fixed in src/lib/nativePush.ts (boot race, see
-- src/lib/nativePush.bootRegister.test.tsx). This migration is the detector,
-- so the next silent death of the same capability is an OPEN alert rather
-- than a number someone happens to query.
--
-- ── WHAT THIS ADDS ────────────────────────────────────────────────────────
-- 1. public.check_push_token_health() — the question, plus the report.
--    Problem when NO non-seed user has a push_tokens row. Writes one
--    error_logs row per UTC day (tags.source 'push-tokens-empty', severity
--    'error'); trg_error_logs_zz_ledger turns it into an ops_alert_ledger
--    item. Returns the numbers either way (tokens, registrations in the last
--    14 days, native signed-in users in the last 14 days, pushes skipped for
--    no device in the last 7 days) so a scoreboard can read them.
-- 2. ops_alert_condition gains a 'push-tokens-empty' branch, so the ledger
--    item is verify_kind 'sql_condition' and ops_alert_verify() closes it
--    ONLY when a real device's row exists — not when someone marks it done.
-- 3. A daily cron 'push-token-health' plus its cron_work_expectations row, so
--    the detector itself cannot stop silently (cronLivenessCoverage.test.ts).
--
-- HONEST LIMIT: "a row exists" is not "push is delivered". A token APNs
-- rejects is deleted by send-push-notification (status 'token_deleted' in
-- notification_logs), which drops the count back to zero and re-raises this
-- alert — that is the intended behaviour, not a false positive.
--
-- Replay-safe: CREATE OR REPLACE, ON CONFLICT, and cron.schedule upserts by
-- name. The ops_alert_condition body is the 20260923052520 definition
-- verbatim plus the one new branch.

CREATE OR REPLACE FUNCTION public.check_push_token_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tokens        bigint;
  v_recent        bigint;
  v_native_users  bigint := 0;
  v_skipped_7d    bigint := 0;
  v_problem       text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE t.updated_at > now() - interval '14 days')
    INTO v_tokens, v_recent
    FROM public.push_tokens t
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.user_id = t.user_id AND p.is_seed IS TRUE);

  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    SELECT count(DISTINCT a.user_id) INTO v_native_users
      FROM public.analytics_events a
     WHERE a.platform IN ('ios', 'android')
       AND a.user_id IS NOT NULL
       AND a.created_at > now() - interval '14 days';
  END IF;

  IF to_regclass('public.notification_logs') IS NOT NULL THEN
    SELECT count(*) INTO v_skipped_7d
      FROM public.notification_logs n
     WHERE n.channel = 'push'
       AND n.status = 'skipped'
       AND n.error_message = 'no_registered_devices'
       AND n.created_at > now() - interval '7 days';
  END IF;

  IF v_tokens = 0 THEN
    v_problem := format(
      'No device can receive a push — push_tokens has 0 rows for real users, so every push is skipped (%s skipped in 7 days; %s signed-in native users in 14 days). See docs/OPEN.md Q82.',
      v_skipped_7d, v_native_users);
  END IF;

  IF v_problem IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tokens', v_tokens, 'registered_14d', v_recent,
                              'native_users_14d', v_native_users, 'skipped_no_device_7d', v_skipped_7d);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'push-tokens-empty'
       AND e.created_at > date_trunc('day', now())
  ) THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', v_problem,
            jsonb_build_object('source', 'push-tokens-empty', 'area', 'push'),
            jsonb_build_object('tokens', v_tokens, 'registered_14d', v_recent,
                               'native_users_14d', v_native_users,
                               'skipped_no_device_7d', v_skipped_7d));
  END IF;

  RETURN jsonb_build_object('ok', false, 'problem', v_problem, 'tokens', v_tokens,
                            'registered_14d', v_recent, 'native_users_14d', v_native_users,
                            'skipped_no_device_7d', v_skipped_7d);
END;
$fn$;

REVOKE ALL ON FUNCTION public.check_push_token_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_push_token_health() TO service_role;

CREATE OR REPLACE FUNCTION public.ops_alert_condition(
  p_source     text,
  p_sample_ref jsonb,
  p_since      timestamptz,
  p_probe_only boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_job   text := p_sample_ref ->> 'job';
  v_dlq   text;
  v_depth bigint;
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
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('push-token-health', interval '30 hours',
            'Q82: daily check that at least one real device holds a push token.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('push-token-health', '17 15 * * *',
                          'SELECT public.check_push_token_health();');
  END IF;
END
$do$;
