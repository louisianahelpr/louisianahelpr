-- Q1(e): nothing watched public.ops_alert_pending.
--
-- ops_alert_record() queues an occurrence in ops_alert_pending when the ledger
-- row is busy (100 ms lock bound, 20260923050059). Only ops_alert_verify(),
-- called by the HOURLY GitHub job (prod-errors.yml `ops-alert-ledger.mjs
-- sync`), folds the queue in. If that job stops, queued alerts never reach
-- the ledger and nothing says so: the one thing that would notice is the job
-- that stopped.
--
-- This adds a second, independent path inside the database:
--   * check_ops_alert_pending(), hourly from pg_cron ('ops-alert-pending-
--     watchdog'): folds the queue itself (ops_alert_fold_pending, SKIP LOCKED,
--     so it never contends with the GitHub fold), then, if any row is STILL
--     queued after more than 2 hours (a row that cannot fold, or a fold that
--     keeps failing), writes one error_logs row per UTC day with source
--     'ops-alert-pending-stale' -> Slack (notify_slack_on_error_log) and the
--     ledger (trg_error_logs_zz_ledger);
--   * ops_alert_condition gains that source's close rule (sql_condition):
--     still failing while any row has been queued for more than 2 hours;
--   * a cron_work_expectations row (3h gap), so sweep_dead_crons pages if the
--     watchdog itself stops.
--
-- ops_alert_condition is restated from its newest body (20260926034740, Q298,
-- itself on top of 20260925155922, Q355) with ONLY the new
-- 'ops-alert-pending-stale' branch added.
--
-- REPLAY-SAFETY: CREATE OR REPLACE throughout; the expectation row upserts;
-- cron.schedule upserts by job name and is skipped without pg_cron.

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

  ELSIF p_source = 'ops-alert-pending-stale' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q1(e). Pure question: still failing while an occurrence has sat in the
    -- queue for more than 2 hours. The hourly watchdog owns the report.
    IF to_regclass('public.ops_alert_pending') IS NULL THEN RETURN NULL; END IF;
    RETURN EXISTS (SELECT 1 FROM public.ops_alert_pending q
                    WHERE q.queued_at < now() - interval '2 hours');

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

  ELSIF p_source IN ('cron-dead', 'cron-startup-timeout', 'cron-caught-up') AND v_job IS NOT NULL THEN
    -- Q30: 'cron-caught-up' (a missed slot re-run by run_missed_cron_catch_up)
    -- closes by the same evidence: the job's next REGULAR run succeeded.
    IF p_probe_only THEN RETURN true; END IF;
    IF to_regclass('cron.job_run_details') IS NULL THEN RETURN NULL; END IF;
    -- Cleared only by a run that SUCCEEDED after the last report.
    RETURN NOT EXISTS (
      SELECT 1 FROM cron.job_run_details d
        JOIN cron.job c ON c.jobid = d.jobid
       WHERE c.jobname = v_job
         AND d.status = 'succeeded'
         AND d.start_time > p_since);

  ELSIF p_source = 'cron-http-untagged' AND v_job IS NOT NULL THEN
    -- Q287. Re-asks cron.job itself, with the sweep's own predicate
    -- (sweep_cron_http_failures, 20260923172145): still failing while an
    -- ACTIVE job filed under this name calls net.http_post without
    -- cron_http_tag(. Tagging it, pausing it or unscheduling it clears it.
    -- The name is the one the sweep filed: jobname, else 'jobid <n>'.
    IF p_probe_only THEN RETURN true; END IF;
    IF to_regclass('cron.job') IS NULL THEN RETURN NULL; END IF;
    RETURN EXISTS (
      SELECT 1 FROM cron.job j
       WHERE coalesce(j.jobname, 'jobid ' || j.jobid) = v_job
         AND j.active
         AND j.command LIKE '%net.http_post(%'
         AND j.command NOT LIKE '%cron_http_tag(%');

  ELSIF p_source = 'seed-boundary-check-failed' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q160. Still failing while ANY notification was dropped (in-app, digest
    -- queue or email) because the seed-boundary check itself errored in the
    -- last 24 hours. A deliberate seed suppression never matches: its
    -- error_message is 'seed subject to a non-seed recipient'.
    RETURN EXISTS (
      SELECT 1 FROM public.notification_logs l
       WHERE l.created_at > now() - interval '24 hours'
         AND l.error_message LIKE 'seed boundary check failed%');

  ELSIF p_source = 'user-report' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q64. Re-asks public.reports itself: still failing while ANY real report
    -- with this normalised title is still open (pending/new/investigating) in
    -- its admin queue. Resolving or dismissing it there is what clears it.
    -- The status list is spelled out (not only user_report_is_open) so the
    -- planner filters on the column before any per-row function call.
    --
    -- The overflow item (the new-item cap) has no single title: still failing
    -- while ANY open real report has no item of its own.
    IF coalesce((p_sample_ref ->> 'overflow')::boolean, false) THEN
      RETURN EXISTS (
        SELECT 1 FROM public.reports r
         WHERE r.status IN ('pending', 'new', 'investigating')
           AND public.user_report_is_real(r.reporter_id)
           AND NOT EXISTS (
             SELECT 1 FROM public.ops_alert_ledger l
              WHERE l.source_kind = 'user-report' AND l.source = 'user-report'
                AND l.title = public.ops_alert_normalise(public.user_report_title(r.reported_type, r.reason))));
    END IF;
    IF p_sample_ref ->> 'title_norm' IS NULL THEN RETURN NULL; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.status IN ('pending', 'new', 'investigating')
         AND public.user_report_is_open(r.status)
         AND public.user_report_is_real(r.reporter_id)
         AND public.ops_alert_normalise(public.user_report_title(r.reported_type, r.reason))
             = p_sample_ref ->> 'title_norm');

  ELSIF p_source = 'ops-alert:support_request' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q64. The Slack ping contact-support posts. The per-report user-report
    -- items carry the tracking; this one clears when none of them is open.
    RETURN EXISTS (
      SELECT 1 FROM public.ops_alert_ledger l
       WHERE l.source_kind = 'user-report' AND l.status <> 'closed');

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
    IF EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.created_at > now() - interval '24 hours'
         AND public.is_user_error_screen_row(e.tags)
         AND public.user_error_screen_is_real(e.user_id, e.tags)
         AND public.ops_alert_normalise(public.user_error_screen_title(e.tags ->> 'screen', e.message))
             = p_sample_ref ->> 'title_norm') THEN
      RETURN true;
    END IF;
    -- Q94, the synthetic half: 24h without a real person seeing it is not
    -- enough; the press run must also have walked the item's screen cleanly
    -- AFTER its last occurrence (p_since = the item's last_seen). An item with
    -- no screen has nothing to probe, so it stays open for a person to close.
    -- Q298: that means an EARLY return. ops_route_key(null or '') is '/', so
    -- without it any clean press pass on / would close a screenless item.
    IF nullif(p_sample_ref ->> 'screen', '') IS NULL THEN RETURN true; END IF;
    RETURN NOT EXISTS (
      SELECT 1 FROM public.ops_route_probe p
       WHERE p.route = public.ops_route_key(p_sample_ref ->> 'screen')
         AND p.passed_at > p_since);

  ELSIF p_source = 'ops-alert:custom'
        AND public.admin_alert_close_rule(public.admin_alert_ref(p_sample_ref) ->> 'title') IS NOT NULL THEN
    -- Q355. An admin-queue post mirrored to Slack (send-push-notification ->
    -- postSlackOpsAlert, kind 'custom'). Re-asks the queue the post was
    -- about (admin_queue_still_pending); any other 'custom' post has no
    -- rule, so it falls through to NULL and keeps 'companions'.
    IF p_probe_only THEN RETURN true; END IF;
    RETURN public.admin_queue_still_pending(
             public.admin_alert_close_rule(public.admin_alert_ref(p_sample_ref) ->> 'title'),
             public.admin_alert_ref(p_sample_ref), p_since);

  ELSIF p_source = 'cron-silent' AND v_job IS NOT NULL
        AND public.cron_silent_rule(p_sample_ref) IN ('idle', 'unrecorded') THEN
    -- CJ-007 (20260926035556). The two rules sweep_silent_cron_failures files
    -- that have live state to re-ask; 'candidates' has none and falls through.
    IF p_probe_only THEN RETURN true; END IF;
    RETURN public.cron_silent_still_failing(public.cron_silent_rule(p_sample_ref), v_job, p_since);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.check_ops_alert_pending()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_folded  int := 0;
  v_left    bigint;
  v_stale   bigint;
  v_oldest  timestamptz;
  v_problem text;
BEGIN
  -- Fold first: the queue drains even while the GitHub hourly job is down.
  -- A fold error must not stop the check below from reporting.
  BEGIN
    v_folded := public.ops_alert_fold_pending();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'check_ops_alert_pending: fold failed: %', SQLERRM;
  END;

  SELECT count(*), count(*) FILTER (WHERE queued_at < now() - interval '2 hours'), min(queued_at)
    INTO v_left, v_stale, v_oldest
    FROM public.ops_alert_pending;

  IF v_stale = 0 THEN
    RETURN jsonb_build_object('ok', true, 'folded', v_folded, 'queued', v_left, 'oldest', v_oldest);
  END IF;

  v_problem := format(
    'Ops alert ledger queue stuck — %s occurrence(s) still queued after 2h (oldest %s); they are not in the ledger. See docs/OPEN.md Q1(e).',
    v_stale, to_char(v_oldest AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI"Z"'));

  IF NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'ops-alert-pending-stale'
       AND e.created_at > date_trunc('day', now())
  ) THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', v_problem,
            jsonb_build_object('source', 'ops-alert-pending-stale', 'area', 'ops'),
            jsonb_build_object('queued', v_left, 'stale', v_stale, 'oldest', v_oldest, 'folded', v_folded));
  END IF;

  RETURN jsonb_build_object('ok', false, 'problem', v_problem, 'folded', v_folded,
                            'queued', v_left, 'stale', v_stale, 'oldest', v_oldest);
END;
$fn$;

REVOKE ALL ON FUNCTION public.check_ops_alert_pending() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_ops_alert_pending() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('ops-alert-pending-watchdog', interval '3 hours',
            'Q1(e): hourly fold of ops_alert_pending independent of the GitHub ledger job, and the page when a queued alert is stuck over 2h.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('ops-alert-pending-watchdog', '37 * * * *',
                          'SELECT public.check_ops_alert_pending();');
  END IF;
END
$do$;
