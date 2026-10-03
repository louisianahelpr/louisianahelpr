-- Q1156 (owner, 2026-10-03: "Yes: self-heal + page"): open_jobs_browse puts
-- itself back to a definer view, and pages, within 5 minutes of a flip.
--
-- What happened: on 2026-10-02 at 21:25:07Z and 21:25:17Z a Supabase DASHBOARD
-- session (postgres_logs `-- source: dashboard`) ran
--   ALTER VIEW public.open_jobs_browse SET (security_invoker = true);
-- the statement the Security Advisor's one-click "security definer view" fix
-- runs. As an invoker view it returns 401 / 42501 to anon (no SELECT on jobs)
-- and 42501 to signed-in users (no SELECT on jobs.offered_to_helper_id), so
-- every browse surface failed for hours until 20261003020841 restored it. Why
-- the view MUST stay definer: 20260923205337 (Q182) and the COMMENT on it.
--
-- The repair, independent of any person or GitHub job:
--   * check_browse_view_definer(), every 5 minutes from pg_cron
--     ('open-jobs-browse-heal'): when pg_class.reloptions carries a true
--     security_invoker (read through pg_options_to_table and a ::boolean cast,
--     so every spelling Postgres accepts counts: true/on/yes/1 and also t, tru,
--     y, ye, which it stores as typed), it sets it back to false, restates the
--     SELECT-only client grants, and writes one error_logs row (source
--     'open-jobs-browse-healed') -> Slack (notify_slack_on_error_log) and the
--     alert ledger (trg_error_logs_zz_ledger), naming what it found. Severity
--     is 'fatal': clients may INSERT error_logs, and a client row with the same
--     source at 'error' would sit in the Slack throttle and mute this page;
--     clients cannot write 'fatal' (stamp_error_log_origin), and its throttle
--     window is 10 minutes. A person still has to find who flips it.
--   * a cron_work_expectations row (30 min gap), so sweep_dead_crons pages if
--     the heal itself stops running.
--
-- It changes nothing while the view is definer: the healthy run is a no-op.
-- ALTER VIEW needs the view's owner; the function runs as its owner (the
-- migration role that also owns the view), and pg_cron runs it as the job's
-- owner. search_path puts pg_temp last and pg_class is schema-qualified, so a
-- caller's temp table cannot stand in for the catalog; lock_timeout keeps the
-- ALTER (an AccessExclusiveLock) from queueing browse reads behind it: on a
-- timeout the run fails, sweep_dead_crons pages it, and the next run retries. Clients cannot call it: EXECUTE is revoked from PUBLIC, anon and
-- authenticated (service_role keeps it for an on-demand check).
--
-- REPLAY-SAFETY: CREATE OR REPLACE; the function skips when the view is absent;
-- the expectation row upserts; cron.schedule upserts by job name and is
-- skipped without pg_cron. Proof: src/test/pglite/openJobsBrowseHeals.pglite.mjs.
-- Guard: src/test/openJobsBrowseHeals.test.ts.

CREATE OR REPLACE FUNCTION public.check_browse_view_definer()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_was     text[];
  v_flipped boolean;
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NULL THEN
    -- A missing view is an outage of its own; uptime and the anon contract see it.
    RETURN jsonb_build_object('ok', true, 'skipped', 'open_jobs_browse is absent');
  END IF;

  SELECT c.reloptions INTO v_was
    FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.open_jobs_browse'::regclass;

  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_options_to_table(v_was) AS o(option_name, option_value)
     WHERE o.option_name = 'security_invoker'
       AND o.option_value::boolean
  ) INTO v_flipped;

  IF NOT v_flipped THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  ALTER VIEW public.open_jobs_browse SET (security_invoker = false);
  REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    'fatal',
    format(
      'open_jobs_browse was flipped to an invoker view (reloptions %s), which breaks browse for guests and signed-in users (42501). Healed back to a definer view at %s. Someone ran ALTER VIEW outside a migration (on 2026-10-02 it was the Supabase Security Advisor''s one-click fix): find who. See docs/OPEN.md Q1156.',
      coalesce(array_to_string(v_was, ','), '(none)'),
      to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS"Z"')),
    jsonb_build_object('source', 'open-jobs-browse-healed', 'area', 'security'),
    jsonb_build_object('reloptions_before', to_jsonb(v_was), 'healed_at', now()));

  RETURN jsonb_build_object('ok', false, 'healed', true, 'reloptions_before', to_jsonb(v_was));
END;
$fn$;

REVOKE ALL ON FUNCTION public.check_browse_view_definer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_browse_view_definer() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('open-jobs-browse-heal', interval '30 minutes',
            'Q1156: every 5 minutes, puts open_jobs_browse back to a definer view if anything flipped it to security_invoker, and pages.',
            'exempt',
            'A definer view is the healthy state, so a run that changes nothing is not a silent failure. A heal raises its own error_logs page.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('open-jobs-browse-heal', '*/5 * * * *',
                          $c$SELECT public.cron_record_work('open-jobs-browse-heal', to_jsonb(public.check_browse_view_definer()));$c$);
  END IF;
END
$do$;
