-- Q355 (docs/OPEN.md): admin-queue Slack posts close themselves.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- An operator notification to an admin with no push token is mirrored to
-- #ops-alerts by send-push-notification (postSlackOpsAlert, kind 'custom'),
-- which records it in the ledger as edge_slack / 'ops-alert:custom', one item
-- per title, sample_ref {link, oncePerDayKey = 'admin-push:<title>|<link>'}.
-- ops_alert_condition had no branch for that source, so ops_alert_apply gave
-- it verify_kind 'companions'. The companions rule in ops_alert_verify()
-- (20260924005818, restated 20260924041136) counts only error_logs rows whose
-- source is NOT 'ops-alert', and the post's only rows are 'ops-alert' ones: 0
-- companions, so the item could never close. "Ban review needed" (1d617a04)
-- sat open 36h with the ban-review queue empty, and was closed by hand.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--  * admin_alert_close_rule(title): which admin QUEUE a mirrored title is
--    about, by normalised-title prefix; NULL for any other 'custom' post
--    (those keep 'companions', unchanged). The prefix table is the inventory
--    src/test/adminQueueAlertsClose.test.ts checks two-way against every
--    admin fan-out in the SQL and edge sources.
--  * admin_alert_ref(sample_ref): the title and link the post carried, read
--    from 'admin_title'/'admin_link' (set by the re-point below) or the
--    mirror's oncePerDayKey, plus the user / job the link names (the same
--    user= / job= / /jobs/ shapes as alertSubjectFromLink in alertPolicy.ts).
--  * admin_queue_still_pending(rule, ref, since): re-asks the queue itself.
--    Still failing while the NAMED subject still has a to-do in it, or ANY
--    real (non-seed) subject does: the ledger keeps ONE item per title, whose
--    sample_ref names only the newest subject, so "named subject only" would
--    close the item over an older subject still waiting. Seed subjects never
--    page (they go to the digest), so they never hold an item open.
--      ban-review      user_violations.action_taken = 'pending_ban_review'
--                      (/admin?view=banreview reads exactly that)
--      idv-review      profiles.idv_status = 'manual_review'; for the named
--                      person also 'failed' until an admin_audit_log decision
--                      (manual_verify_user / idv_reject / request_id_reupload)
--                      on them after the post (/admin?view=idvreview lists
--                      both; 'failed' stays listed as a rescue list)
--      reported-user   an open (pending/new/investigating) report against the
--                      person, directly or through their application
--                      (auto_escalate_reports' own subject rule)
--      dispute-open    the /admin?view=disputes queue (AdminDisputes.tsx):
--                      a job still 'disputed', or dispute-unsettled
--      dispute-unsettled a 'decided' dispute whose execution is NULL or not
--                      'executed' (AdminDisputes' unsettled read)
--      stalled-job     job_completion_nudges escalated and not resolved
--                      (admin_stalled_job_queue's predicate)
--      stuck-payment   the 'detect_stuck_payments' branch, re-asked
--  * ops_alert_condition: restated from its NEWEST definition
--    (20260923215732_cron_http_untagged_close_rule.sql, no later rewrite)
--    verbatim, plus ONE branch: 'ops-alert:custom' whose title has a close
--    rule. New items then get verify_kind 'sql_condition' from ops_alert_apply's
--    default hook (probe = true), verify_ref 'ops-alert:custom'.
--  * Existing items: re-pointed from 'companions' to that condition (ON
--    CONFLICT in ops_alert_apply never rewrites verify_kind), with the title
--    and, for a backfilled item whose sample_ref is only {error_log_id}, the
--    deep link from that error_logs row, kept in sample_ref. The next
--    occurrence replaces sample_ref with the mirror's own, which carries both.
--
-- Titles an admin gets that name NO queue (payout/transfer failures, arrival
-- not confirmed, violation notices, "New member joined", "Dispute
-- auto-resolved") are not covered here; the test lists each with its reason.
--
-- Replay-safe: CREATE OR REPLACE, the UPDATE only touches 'companions' rows.
-- Grants: FROM PUBLIC, anon, authenticated; service_role only.

-- ── 1. which queue a mirrored admin title is about ──────────────────────────
CREATE OR REPLACE FUNCTION public.admin_alert_close_rule(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT r.rule
    FROM (VALUES
      ('ban review needed',                         'ban-review'),
      ('identity verification needs review',        'idv-review'),
      ('user flagged',                              'reported-user'),
      ('dispute escalated',                         'dispute-open'),
      ('escalated dispute overdue',                 'dispute-open'),
      ('dispute stuck — escrow cannot auto-settle', 'dispute-open'),
      ('dispute split did not settle',              'dispute-unsettled'),
      ('job stalled — nobody marked it done',       'stalled-job'),
      ('stuck payment — webhook may be failing',    'stuck-payment')
    ) AS r(prefix, rule)
   WHERE public.ops_alert_normalise(p_title) LIKE r.prefix || '%'
   LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION public.admin_alert_close_rule(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO service_role;

-- ── 2. the title / link / subject a mirrored post carried ───────────────────
CREATE OR REPLACE FUNCTION public.admin_alert_ref(p_sample_ref jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT jsonb_strip_nulls(jsonb_build_object(
           'title',   t.title,
           'link',    t.link,
           'user_id', (regexp_match(lower(coalesce(t.link, '')),
                        '[?&]user(?:_id)?=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1],
           'job_id',  (regexp_match(lower(coalesce(t.link, '')),
                        '(?:[?&]job(?:_id)?=|/jobs?/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1]))
    FROM (SELECT coalesce(nullif(p_sample_ref ->> 'admin_title', ''), k.m[1]) AS title,
                 coalesce(nullif(p_sample_ref ->> 'link', ''), nullif(p_sample_ref ->> 'admin_link', ''),
                          nullif(k.m[2], '')) AS link
            FROM (SELECT regexp_match(coalesce(p_sample_ref ->> 'oncePerDayKey', ''),
                                      '^admin-push:([^|]*)\|(.*)$') AS m) k) t
$fn$;

REVOKE ALL ON FUNCTION public.admin_alert_ref(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_ref(jsonb) TO service_role;

-- ── 3. re-ask the queue ─────────────────────────────────────────────────────
-- TRUE = still waiting on an admin, FALSE = queue clear, NULL = cannot tell.
CREATE OR REPLACE FUNCTION public.admin_queue_still_pending(p_rule text, p_ref jsonb, p_since timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user uuid := (p_ref ->> 'user_id')::uuid;
  v_job  uuid := (p_ref ->> 'job_id')::uuid;
BEGIN
  IF p_rule = 'ban-review' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_violations v
       WHERE v.action_taken = 'pending_ban_review'
         AND (v.user_id = v_user
              OR NOT EXISTS (SELECT 1 FROM public.profiles p
                              WHERE p.user_id = v.user_id AND p.is_seed IS TRUE)));

  ELSIF p_rule = 'idv-review' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.idv_status = 'manual_review'
         AND (p.user_id = v_user OR p.is_seed IS NOT TRUE))
      OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = v_user
         AND p.idv_status = 'failed'
         AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a
                          WHERE a.target_id = v_user::text
                            AND a.action IN ('manual_verify_user', 'idv_reject', 'request_id_reupload')
                            AND a.created_at > p_since));

  ELSIF p_rule = 'reported-user' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.reports r
       CROSS JOIN LATERAL (
         SELECT CASE WHEN r.reported_type = 'user' THEN r.reported_id
                     ELSE (SELECT a.helper_id FROM public.applications a WHERE a.id = r.reported_id) END AS subject) s
       WHERE r.status IN ('pending', 'new', 'investigating')
         AND r.reported_type IN ('user', 'application')
         AND s.subject IS NOT NULL
         AND (s.subject = v_user
              OR NOT EXISTS (SELECT 1 FROM public.profiles p
                              WHERE p.user_id = s.subject AND p.is_seed IS TRUE)));

  ELSIF p_rule = 'dispute-open' THEN
    -- The whole /admin?view=disputes queue (AdminDisputes.tsx): a job still
    -- 'disputed', or a decided dispute whose settlement has not executed
    -- ("Dispute stuck" is also sent for split_pending, a decided split).
    RETURN EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.status = 'disputed'
         AND (j.id = v_job OR j.is_seed IS NOT TRUE))
      OR public.admin_queue_still_pending('dispute-unsettled', p_ref, p_since);

  ELSIF p_rule = 'dispute-unsettled' THEN
    -- AdminDisputes' unsettled read: decided, execution NULL or not 'executed'.
    RETURN EXISTS (
      SELECT 1 FROM public.disputes d
        LEFT JOIN public.jobs j ON j.id = d.job_id
       WHERE d.status = 'decided'
         AND coalesce(d.execution_status, '') <> 'executed'
         AND (d.job_id = v_job OR j.is_seed IS NOT TRUE));

  ELSIF p_rule = 'stalled-job' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.job_completion_nudges n
        LEFT JOIN public.jobs j ON j.id = n.job_id
       WHERE n.escalated_at IS NOT NULL
         AND n.resolved_at IS NULL
         AND (n.job_id = v_job OR j.is_seed IS NOT TRUE));

  ELSIF p_rule = 'stuck-payment' THEN
    RETURN public.ops_alert_condition('detect_stuck_payments', '{}'::jsonb, p_since, false);
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) TO service_role;

-- ── 4. ledger close rule (newest body, 20260923215732 (Q287), + the Q355 branch)
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
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) TO service_role;

-- ── 5. re-point the existing items ──────────────────────────────────────────
-- They were given 'companions', which can never close them. ON CONFLICT in
-- ops_alert_apply never rewrites verify_kind, so this is the only way it
-- changes. The title (and, for a backfilled item, the deep link its
-- error_logs row carried) is kept in sample_ref so the condition can read it.
UPDATE public.ops_alert_ledger l
   SET verify_kind = 'sql_condition',
       verify_ref  = 'ops-alert:custom',
       sample_ref  = l.sample_ref
                     || jsonb_build_object('admin_title', l.title)
                     || coalesce((SELECT jsonb_build_object('admin_link', e.context -> 'fields' ->> 'deep_link')
                                    FROM public.error_logs e
                                   WHERE e.id = CASE WHEN l.sample_ref ->> 'error_log_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                                 THEN (l.sample_ref ->> 'error_log_id')::uuid END
                                     AND jsonb_typeof(e.context -> 'fields') = 'object'
                                     AND e.context -> 'fields' ->> 'deep_link' LIKE '/%'), '{}'::jsonb),
       updated_at  = now()
 WHERE l.source_kind = 'edge_slack'
   AND l.source = 'ops-alert:custom'
   AND l.verify_kind = 'companions'
   AND public.admin_alert_close_rule(l.title) IS NOT NULL;
