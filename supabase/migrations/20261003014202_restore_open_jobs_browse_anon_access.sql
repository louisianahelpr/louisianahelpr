-- Restore anon access to the masked browse view without granting SELECT on jobs.
--
-- The read-only production probe found that anon receives 42501 on
-- open_jobs_browse because access to jobs is being checked as the caller.
-- Anon deliberately has no SELECT on jobs: the view is the only guest browse
-- path, and its projection masks private job fields. Reassert the view's
-- owner-evaluated posture and its SELECT-only client grants; do not open jobs.
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
