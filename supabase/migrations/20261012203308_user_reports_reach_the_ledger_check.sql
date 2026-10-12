-- Q1717 (lh-silent-failure review of Q1582, 2026-10-12, finding
-- lh-silent-failure@2e6746ea3#2): trg_reports_zz_ledger ->
-- ops_alert_ledger_from_report catches every error (EXCEPTION WHEN OTHERS,
-- RAISE WARNING only), so a real reporter's report (a support request
-- included) can exist with no open ledger item, and nothing notices. The
-- reports row, the support email and the Slack post still exist.
--
-- check_user_reports_reach_ledger(): hourly, every report from a REAL reporter
-- (user_report_is_real, and a reporter still on the row: a deleted account's
-- reports are SET NULL, and user_report_is_real(NULL) is true even for a test
-- account) made between 25 hours and 10 minutes ago must have reached the
-- ledger: its own item (title = ops_alert_normalise(user_report_title(type,
-- reason)), last_seen at or after the report; ops_alert_apply keeps the
-- greatest seen_at), the flood-cap overflow item bumped at or after it when the
-- cap's own condition held at the report's time, or a row queued
-- in ops_alert_pending in the last 2 hours (the ledger's lock-timeout queue,
-- folded hourly; an older row is stuck, not waiting). Reports that did not are
-- filed as ONE error_logs row (source 'user-report-unrecorded', which reaches
-- Slack and the ledger itself) naming their ids; a report already named in
-- such a row is not named again. Returns how many reports were missing.
--
-- Known limit (lh-silent-failure review of dacc6fccd): titles are type plus
-- reason from a fixed list, so ONE failed report followed by a successful one
-- with the same type and reason is excused by the later bump. A systematic
-- trigger failure is still caught. Also: the per-reporter count reads each
-- item's LATEST reporter (ops_alert_apply replaces sample_ref on every bump),
-- exactly as the live cap does; a later same-title report from someone else
-- can lower it and file a capped report as unrecorded (a false alarm, never a
-- miss).
--
-- Replay-safe: CREATE OR REPLACE; the cron and its expectation row only where
-- they exist. Grants: service_role only.
-- Proof: src/test/pglite/userReportsReachTheLedgerCheck.pglite.mjs. Guard:
-- src/test/userReportsReachTheLedgerCheck.test.ts.

CREATE OR REPLACE FUNCTION public.check_user_reports_reach_ledger()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_overflow text := public.ops_alert_normalise('user reports: new-item cap reached (see the admin queues)');
  v_ids      text[];
BEGIN
  SELECT coalesce(array_agg(r.id::text ORDER BY r.created_at), ARRAY[]::text[])
    INTO v_ids
    FROM public.reports r
   WHERE r.created_at >  now() - interval '25 hours'
     AND r.created_at <= now() - interval '10 minutes'
     AND r.reporter_id IS NOT NULL
     AND public.user_report_is_real(r.reporter_id)
     AND NOT EXISTS (
           SELECT 1 FROM public.ops_alert_ledger l
            WHERE l.source_kind = 'user-report' AND l.source = 'user-report'
              AND l.title = public.ops_alert_normalise(public.user_report_title(r.reported_type, r.reason))
              AND l.last_seen >= r.created_at)
     -- The flood-cap overflow item keeps only its latest bump, so it cannot
     -- say which reports it counted. A report is excused by it only when the
     -- cap could have refused it: an overflow bump at or after it, AND the
     -- cap's own condition rebuilt from the ledger at the report's time (5+
     -- new non-overflow items from this reporter, or 20+ overall, first seen
     -- in the hour before it; ops_alert_record_user_report's rule).
     AND NOT (
           EXISTS (SELECT 1 FROM public.ops_alert_ledger l
                    WHERE l.source_kind = 'user-report' AND l.source = 'user-report'
                      AND l.title = v_overflow
                      AND l.last_seen >= r.created_at)
           AND (SELECT count(*) FILTER (WHERE c.sample_ref ->> 'reporter_id' = r.reporter_id::text) >= 5
                       OR count(*) >= 20
                  FROM public.ops_alert_ledger c
                 WHERE c.source_kind = 'user-report' AND c.source = 'user-report'
                   AND NOT coalesce((c.sample_ref ->> 'overflow')::boolean, false)
                   AND c.first_seen >  r.created_at - interval '1 hour'
                   AND c.first_seen <= r.created_at))
     AND NOT EXISTS (
           SELECT 1 FROM public.ops_alert_pending p
            WHERE p.source_kind = 'user-report' AND p.source = 'user-report'
              AND p.seen_at >= r.created_at
              AND p.queued_at > now() - interval '2 hours'
              AND public.ops_alert_normalise(p.title) IN
                  (public.ops_alert_normalise(public.user_report_title(r.reported_type, r.reason)), v_overflow))
     AND NOT EXISTS (
           SELECT 1 FROM public.error_logs e
            WHERE e.tags ->> 'source' = 'user-report-unrecorded'
              AND coalesce(e.tags ->> 'origin', '') <> 'client'
              AND e.context -> 'report_ids' ? r.id::text);

  IF cardinality(v_ids) > 0 THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error',
            format('%s user report(s) never reached the ops ledger (no item, overflow bump or queued row was found for them): %s. Each report is still in its admin queue; read it there.',
                   cardinality(v_ids), array_to_string(v_ids, ', ')),
            jsonb_build_object('source', 'user-report-unrecorded', 'area', 'ops'),
            jsonb_build_object('report_ids', to_jsonb(v_ids), 'docs', 'docs/OPEN.md Q1717'));
  END IF;
  RETURN cardinality(v_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.check_user_reports_reach_ledger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_reports_reach_ledger() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('user-reports-reach-ledger', interval '2 hours',
            'Q1717: hourly, every real report from the last day must have reached the ops ledger, and the ones that did not are filed.',
            'exempt',
            'Almost every run finds nothing missing: a run that files nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('user-reports-reach-ledger', '29 * * * *',
                          $c$SELECT public.cron_record_work('user-reports-reach-ledger', to_jsonb(public.check_user_reports_reach_ledger()));$c$);
  END IF;
END
$do$;
