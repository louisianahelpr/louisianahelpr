-- Q157 + Q159 + Q160: the Q137 seed boundary, made honest and observable.
--
-- Q137 (20260923121354) drops a notifications row whose subject is seed and
-- whose recipient is real, in a BEFORE INSERT trigger. Two things followed:
--
-- 1. Q157. An ADMIN client (src/components/admin/AdminJobs.tsx) inserts the
--    "Job removed by admin" / "Admin updated your job status" rows directly,
--    with .select("id") + unwrapMutation. A row the trigger drops returns zero
--    rows, which unwrapMutation reads (correctly, in general) as a rejected
--    write, so the admin was told "the poster could not be notified" when the
--    rule had worked. Prod 2026-09-23: 13 seed jobs have a real customer_id.
--    notification_crosses_seed_boundary is service_role only, so the client
--    cannot ask it. admin_notification_crosses_seed_boundary() lets an ADMIN
--    ask the same function with the same arguments the trigger uses (no actor:
--    the trigger reads none from a direct insert), so the client can call a
--    deliberate drop a skip, and still treat any OTHER zero-row insert as the
--    real rejection it is.
--
-- 2. Q160. A dropped row is logged in notification_logs either way, and the
--    two cases were told apart only by error_message text: 'seed subject to a
--    non-seed recipient' (the rule) or 'seed boundary check failed, dropped:
--    ...' (the check itself errored, which fails CLOSED and would drop
--    real-to-real notifications). Nothing read the second. Now:
--      check_seed_boundary_failures()  hourly (cron 'seed-boundary-failures'):
--        counts rows LIKE 'seed boundary check failed%' and writes one
--        error_logs row (tags.source 'seed-boundary-check-failed', severity
--        'error') whenever a failure is newer than the last such report;
--        trg_error_logs_zz_ledger turns that into an ops_alert_ledger item.
--      ops_alert_condition gains that source: still failing while any such
--        row exists in the last 24 hours, so the item closes only when the
--        failures have actually stopped.
--    send-notification-email (same commit) logs its own check failure with
--    the same 'seed boundary check failed' prefix, so the email channel is
--    covered by the same monitor (Q159).
--
-- Replay-safe: CREATE OR REPLACE, ON CONFLICT, and cron.schedule upserts by
-- name. ops_alert_condition is the 20260923100454 body verbatim (md5 of prosrc
-- 96306edd897e2bf363fb7f1f679f5e61, equal to prod on 2026-09-23) plus one
-- branch.

-- ── 1. the admin question (Q157) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_notification_crosses_seed_boundary(
  p_recipient uuid,
  p_job_id uuid,
  p_link text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- Admins only: the answer says whether an account is seed. A NULL caller is
  -- not an admin (has_role(NULL, ...) is false).
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  -- Exactly what trg_notifications_seed_boundary asks for a row with this
  -- user_id / job_id / link: the prediction and the trigger cannot disagree.
  RETURN public.notification_crosses_seed_boundary(p_recipient, p_job_id, p_link, NULL);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_notification_crosses_seed_boundary(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_notification_crosses_seed_boundary(uuid, uuid, text) TO authenticated, service_role;

-- ── 2. the detector (Q160) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_seed_boundary_failures()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_24h        bigint;
  v_newest     timestamptz;
  v_reported   timestamptz;
  v_sample     text;
  v_problem    text;
BEGIN
  SELECT count(*), max(l.created_at)
    INTO v_24h, v_newest
    FROM public.notification_logs l
   WHERE l.created_at > now() - interval '24 hours'
     AND l.error_message LIKE 'seed boundary check failed%';

  IF v_24h = 0 THEN
    RETURN jsonb_build_object('ok', true, 'failed_24h', 0);
  END IF;

  SELECT l.error_message INTO v_sample
    FROM public.notification_logs l
   WHERE l.created_at = v_newest
     AND l.error_message LIKE 'seed boundary check failed%'
   LIMIT 1;

  v_problem := format(
    'The seed-boundary check errored and dropped %s notification(s) in 24 hours — the check fails CLOSED, so real people may be missing notifications. Newest: %s. See docs/OPEN.md Q160.',
    v_24h, left(coalesce(v_sample, ''), 300));

  -- Report every failure that is newer than the last report: a fix that
  -- stops and a failure that returns later must both be seen.
  SELECT max(e.created_at) INTO v_reported
    FROM public.error_logs e
   WHERE jsonb_typeof(e.tags) = 'object'
     AND e.tags ->> 'source' = 'seed-boundary-check-failed';

  IF v_reported IS NULL OR v_newest > v_reported THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', v_problem,
            jsonb_build_object('source', 'seed-boundary-check-failed', 'area', 'notifications'),
            jsonb_build_object('failed_24h', v_24h, 'newest', v_newest, 'sample', v_sample));
  END IF;

  RETURN jsonb_build_object('ok', false, 'problem', v_problem, 'failed_24h', v_24h, 'newest', v_newest);
END;
$fn$;

REVOKE ALL ON FUNCTION public.check_seed_boundary_failures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_seed_boundary_failures() TO service_role;

-- ── 3. ledger close rule (live body + one branch) ──────────────────────────
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

-- ── 4. schedule + liveness ─────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('seed-boundary-failures', interval '3 hours',
            'Q160: hourly check that no notification was dropped because the seed-boundary check errored.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('seed-boundary-failures', '41 * * * *',
                          'SELECT public.check_seed_boundary_failures();');
  END IF;
END
$do$;
