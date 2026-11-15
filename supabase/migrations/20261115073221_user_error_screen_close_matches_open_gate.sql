-- Q2806 (follow-up to Q2780; lead lexilombas-7b, 2026-11-15): an open BootWatchdog / LiveJobsSection
-- error-screen item never closed while link scanners kept hitting the page.
--
-- 20261115001106 stopped ONE row on these two public low-stakes read surfaces from OPENING a ledger item: it
-- opens only on 3 rows of that screen in 24 hours (any visitors) or 2 distinct members. The close question,
-- the 'user-error-screen' branch of ops_alert_condition, still treated ANY one real-looking row in the last
-- 24 hours as "still failing". Every boot-stall row 11-09..11-13 came from a datacenter IP that sent only the
-- beacon (Microsoft Safe Links range, M247, Secure Data Systems, Leaseweb; Q2779/Q2790), so one crawler hit a
-- day kept an item open that one hit could never have opened.
--
-- The branch now asks the open gate's question for those two surfaces (sample_ref.surface, which
-- ops_alert_record_user_error_screen has written on every item since 20260923092838; the open ones on prod
-- carry it, read 11-15): still failing while 3 rows of this screen and surface landed in 24 hours or 2
-- distinct members saw it. Below that, the item goes on to the existing press-probe half (Q94), so it closes
-- only after a clean press-every-control pass of its screen, as every quiet item does. Every other surface,
-- and the overflow item, are unchanged: any one real row keeps them open.
--
-- Every other branch is restated verbatim from the newest body, 20261012072223 (md5 of the live prosrc equal
-- to it, 102aead54e8f5d79d0a3550908a1be5a, read 11-15). Replay-safe: CREATE OR REPLACE on the same signature;
-- the helpers it calls resolve at call time. Grants restated as live (service_role only), revoked FROM
-- PUBLIC, anon.

CREATE OR REPLACE FUNCTION public.ops_alert_condition(p_source text, p_sample_ref jsonb, p_since timestamp with time zone, p_probe_only boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job   text := p_sample_ref ->> 'job';
  v_ues_rows    int := 0;
  v_ues_members int := 0;
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
    -- Q1594: minus every job Stripe has freshly answered for THIS checkout
    -- as not paid (stuck_payment_stripe_checks, 20261009223355), the
    -- detector's own not_paid disposition. Without it the close question was
    -- a superset (any real unfinished checkout) and kept the item open. Money
    -- moved, or no current answer (awaiting_stripe, filed under this source),
    -- still counts: a dead checker must never close the item.
    RETURN EXISTS (
      SELECT 1 FROM public.jobs j
       LEFT JOIN public.stuck_payment_stripe_checks c
         ON c.job_id = j.id AND c.stripe_session_id = j.stripe_session_id
       WHERE j.stripe_session_id IS NOT NULL
         AND NOT coalesce(c.money_moved IS NOT TRUE
                          AND (c.checked_at > now() - interval '45 minutes'
                               OR c.session_status IN ('expired', 'missing')), false)
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
    -- Q2806 (follow-up to Q2780, 20261115001106): on the public low-stakes read surfaces (LiveJobsSection,
    -- BootWatchdog) one row is not an outage, so it is not "still failing" either. The close question asks what
    -- the open gate asks: 3 rows of this screen and surface in 24 hours (guests share no per-client id, so they
    -- count by rows), or 2 distinct members. Below that the item falls through to the press-probe half like any
    -- quiet item. The scan stops at 50 rows, as the gate's does. Every other surface: any one row, as before.
    IF p_sample_ref ->> 'surface' IN ('LiveJobsSection', 'BootWatchdog') THEN
      SELECT count(*), count(DISTINCT x.user_id) INTO v_ues_rows, v_ues_members FROM (
        SELECT e.user_id FROM public.error_logs e
         WHERE e.created_at > now() - interval '24 hours'
           AND e.tags ->> 'source' = p_sample_ref ->> 'surface'
           AND public.is_user_error_screen_row(e.tags)
           AND public.user_error_screen_is_real(e.user_id, e.tags)
           AND public.ops_alert_normalise(public.user_error_screen_title(e.tags ->> 'screen', e.message))
               = p_sample_ref ->> 'title_norm'
         LIMIT 50) x;
      IF v_ues_rows >= 3 OR v_ues_members >= 2 THEN RETURN true; END IF;
    ELSIF EXISTS (
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
