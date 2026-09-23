-- Every problem a person reports becomes an ops alert ledger item the owner
-- sees (docs/OPEN.md Q64).
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- Every in-app reporting surface writes one table, public.reports:
--   * ReportDialog (report a job / message / user / review)
--   * the Profile support tab (SupportInline: message, suggestion, issue
--     report with screenshot, other)
--   * /support signed in (contact-support edge function, service role)
--   * shake-to-report, which only navigates to /support?topic=report
-- and the admin queues (/admin?view=reports, /admin?view=support) read it.
-- Nothing else did: a report sat in a queue that is only seen when someone
-- opens it. The ledger is the list the owner works from (CLAUDE.md "Every
-- alert, from anywhere, is fixed AND verified fixed"), so a report now opens
-- an item there, and the item closes only when the admin queue says the
-- report was handled.
--
-- A GUEST on /support has no uuid and so no reports row; contact-support
-- records that one straight into the ledger (source 'contact-support-guest',
-- ONE item per topic, the subject kept in sample_ref, so an unauthenticated
-- caller cannot mint items; verify 'manual': the only evidence of handling is
-- the reply email).
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--  * source_kind 'user-report'.
--  * user_report_title(reported_type, reason): the fingerprint text.
--      support  -> 'Support <reason>'   (reason = "[Issue Report] <subject>")
--      other    -> 'Report on <type>: <reason>'
--    ops_alert_normalise strips uuids/ids/numbers, so DEDUPE is: one item per
--    (kind, reason/subject); a double-tapped Send, or ten people reporting the
--    same thing, is one item with a count, not ten.
--  * user_report_severity(reported_type, reason):
--      support "[Issue Report]"                        error
--      support "[Suggestion]"                          info
--      support anything else                           warning
--      a report on a person/job/message/review naming
--        threats, violence, unsafe, harassment, abuse,
--        illegal work                                  critical
--      any other report on a person/job/message/review error
--  * user_report_is_open(status): pending / new / investigating (the three
--    states the admin queues still show as to-do; reports_status_check).
--  * ops_alert_record_user_report(report_id): records one occurrence with
--    sample_ref {report_id, reported_type, title_norm, link} — the LINK BACK
--    is the admin queue that owns the row. Skips a report whose reporter's
--    profile is is_seed (test traffic never pages); a reporter with no
--    profile, or one since deleted (reporter_id NULL), is REAL.
--  * FLOOD CAP (authz review): a NEW item is refused once the reporter opened
--    5 new items in the hour, or 20 were opened overall; those reports count
--    on ONE overflow item (closes when every open real report has its own
--    item or is resolved). An existing item always counts.
--  * trg_reports_zz_ledger (AFTER INSERT on public.reports) calls it. Failure
--    is swallowed with a WARNING: the report write must never fail because of
--    the ledger. ops_alert_record bounds its own row-lock wait (20260923050059).
--  * ops_alert_condition('user-report') — the CLOSE RULE, verify_kind
--    sql_condition, run hourly by ops_alert_verify(): still failing while ANY
--    real report with the same normalised title is still open in its queue.
--    Resolving/dismissing it in /admin is what clears it.
--  * ops_alert_condition('ops-alert:support_request') — the Slack companion
--    item contact-support's postSlackOpsAlert writes (one per topic, verify
--    'companions', which has no companions and so never closed). It now
--    closes when no user-report item is open: the per-report items carry the
--    tracking, the Slack item is only the ping. Existing row re-pointed.
--  * Backfill: every still-open real report from the last 90 days, once.
--
-- Every new function: REVOKE FROM PUBLIC, anon, authenticated; service_role.

-- ── 1. the new source kind ──────────────────────────────────────────────────
ALTER TABLE public.ops_alert_ledger DROP CONSTRAINT IF EXISTS ops_alert_ledger_source_kind_chk;
ALTER TABLE public.ops_alert_ledger ADD CONSTRAINT ops_alert_ledger_source_kind_chk
  CHECK (source_kind IN ('error_logs', 'edge_slack', 'sql_slack', 'workflow', 'nightly_red', 'sentry',
                         'user-error-screen', 'user-report'));

-- ── 2. title, severity, open-ness ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_report_title(p_reported_type text, p_reason text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE WHEN p_reported_type = 'support'
              THEN 'Support ' || left(coalesce(nullif(btrim(p_reason), ''), '(no subject)'), 200)
              ELSE 'Report on ' || coalesce(nullif(btrim(p_reported_type), ''), 'unknown') || ': '
                   || left(coalesce(nullif(btrim(p_reason), ''), '(no reason)'), 200)
         END
$fn$;

REVOKE ALL ON FUNCTION public.user_report_title(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_report_title(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.user_report_severity(p_reported_type text, p_reason text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
           WHEN p_reported_type = 'support' THEN
             CASE WHEN coalesce(p_reason, '') ILIKE '[Issue Report]%' THEN 'error'
                  WHEN coalesce(p_reason, '') ILIKE '[Suggestion]%'   THEN 'info'
                  ELSE 'warning' END
           WHEN coalesce(p_reason, '') ~* '(threat|violen|unsafe|harass|abuse|illegal)' THEN 'critical'
           ELSE 'error'
         END
$fn$;

REVOKE ALL ON FUNCTION public.user_report_severity(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_report_severity(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.user_report_is_open(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT coalesce(p_status, 'pending') IN ('pending', 'new', 'investigating')
$fn$;

REVOKE ALL ON FUNCTION public.user_report_is_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_report_is_open(text) TO service_role;

-- A reporter is a TEST only when their profile says so. Unknown is real.
CREATE OR REPLACE FUNCTION public.user_report_is_real(p_reporter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p_reporter_id IS NOT NULL
                        AND p.user_id = p_reporter_id
                        AND p.is_seed IS TRUE)
$fn$;

REVOKE ALL ON FUNCTION public.user_report_is_real(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_report_is_real(uuid) TO service_role;

-- ── 3. record one report ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_alert_record_user_report(p_report_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r            record;
  v_title      text;
  v_mine       int := 0;
  v_all        int := 0;
BEGIN
  SELECT id, reporter_id, reported_type, reported_id, reason, description, status, created_at
    INTO r
    FROM public.reports
   WHERE id = p_report_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT public.user_report_is_real(r.reporter_id) THEN RETURN NULL; END IF;

  v_title := public.user_report_title(r.reported_type, r.reason);

  -- FLOOD CAP (authz review of this migration, M1): any signed-in person can
  -- INSERT reports, and each distinct reason would otherwise be its own open
  -- item, crowding the hourly verifier and the health card. Same shape as the
  -- user-error-screen caps (20260923085642): an EXISTING item always counts;
  -- a NEW item is refused when this reporter already opened 5 new items in
  -- the last hour, or 20 were opened in the hour overall. A refused one is
  -- counted on ONE overflow item, so a flood is an open alert, never silence,
  -- and every report is still in its admin queue.
  IF NOT EXISTS (SELECT 1 FROM public.ops_alert_ledger
                  WHERE source_kind = 'user-report' AND source = 'user-report'
                    AND title = public.ops_alert_normalise(v_title)) THEN
    SELECT count(*) FILTER (WHERE sample_ref ->> 'reporter_id' = r.reporter_id::text), count(*)
      INTO v_mine, v_all
      FROM public.ops_alert_ledger
     WHERE source_kind = 'user-report' AND source = 'user-report'
       AND first_seen > now() - interval '1 hour'
       AND NOT coalesce((sample_ref ->> 'overflow')::boolean, false);
    IF v_mine >= 5 OR v_all >= 20 THEN
      RETURN public.ops_alert_record(
        'user-report', 'user-report',
        'user reports: new-item cap reached (see the admin queues)',
        'warning',
        format('Report %s (%s) was not given its own item: %s new items from this reporter / %s overall in the last hour.',
               r.id, r.reported_type, v_mine, v_all),
        jsonb_build_object('overflow', true, 'report_id', r.id, 'link', '/admin?view=reports'),
        'sql_condition', 'user-report', r.created_at);
    END IF;
  END IF;

  RETURN public.ops_alert_record(
    'user-report',
    'user-report',
    v_title,
    public.user_report_severity(r.reported_type, r.reason),
    left(coalesce(r.description, ''), 1500),
    jsonb_build_object(
      'report_id',     r.id,
      'reported_type', r.reported_type,
      'reported_id',   r.reported_id,
      'reporter_id',   r.reporter_id,
      'title_norm',    public.ops_alert_normalise(v_title),
      'link',          CASE WHEN r.reported_type = 'support' THEN '/admin?view=support'
                            ELSE '/admin?view=reports' END),
    'sql_condition',
    'user-report',
    r.created_at);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_record_user_report(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_record_user_report(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ops_alert_ledger_from_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  BEGIN
    PERFORM public.ops_alert_record_user_report(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Never take down the report write. Loud in the Postgres log.
    RAISE WARNING 'ops_alert_ledger_from_report: % (reports.id=%)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_ledger_from_report() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reports_zz_ledger ON public.reports;
CREATE TRIGGER trg_reports_zz_ledger
  AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.ops_alert_ledger_from_report();

-- ── 4. ledger close rule (live body + 'user-report' + support companion) ────
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

-- The existing Slack companion item never closed (verify 'companions', no
-- companions). Point it at its condition. ON CONFLICT in ops_alert_record
-- never rewrites verify_kind, so this is the only way it changes.
UPDATE public.ops_alert_ledger
   SET verify_kind = 'sql_condition', verify_ref = 'ops-alert:support_request', updated_at = now()
 WHERE source_kind = 'edge_slack'
   AND source = 'ops-alert:support_request'
   AND verify_kind = 'companions';

-- ── 5. backfill: every still-open real report from the last 90 days ─────────
DO $do$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ops_alert_ledger WHERE source_kind = 'user-report') THEN
    FOR v_id IN
      SELECT r.id FROM public.reports r
       WHERE r.created_at > now() - interval '90 days'
         AND public.user_report_is_open(r.status)
       ORDER BY r.created_at
    LOOP
      PERFORM public.ops_alert_record_user_report(v_id);
    END LOOP;
  END IF;
END
$do$;
