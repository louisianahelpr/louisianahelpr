-- Restore guest and signed-in browse: open_jobs_browse is a definer view again.
--
-- Measured on prod 2026-10-03 ~02:10Z: pg_class.reloptions for open_jobs_browse
-- was {security_invoker=true}, and an anon GET /rest/v1/open_jobs_browse
-- returned 401 / 42501 "permission denied for table jobs". No migration in the
-- repo after 20260927012806 (which recreated the view WITH security_invoker =
-- false) mentions security_invoker, and every live schema_migrations version
-- since 2026-10-01 has a file here, so the flip was made outside a migration.
--
-- Anon deliberately has no SELECT on jobs and authenticated has no SELECT on
-- jobs.offered_to_helper_id: the view is the only browse path and its
-- projection masks private fields (Q182, 20260923205337). Reassert the
-- owner-evaluated posture and the SELECT-only client grants; never open jobs.
-- Adapted from PR #2172.
--
-- REPLAY-SAFETY: a fresh database may not have the view yet.

DO $$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NULL THEN
    RAISE NOTICE 'open_jobs_browse absent: skipped';
    RETURN;
  END IF;

  ALTER VIEW public.open_jobs_browse SET (security_invoker = false);
  REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;
END
$$;
