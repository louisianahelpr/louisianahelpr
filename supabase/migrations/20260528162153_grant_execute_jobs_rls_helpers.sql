-- Restore EXECUTE on the SQL functions invoked by `public.jobs` SELECT
-- policies and by the `public.open_jobs_browse` view. Same regression
-- shape as PR #355 (the `has_role` grant fix) — the originating
-- migrations relied on the default PUBLIC EXECUTE that something later
-- (likely a Supabase advisor pass) stripped.
--
-- Symptom (2026-05-28): after PR #355 fixed the post-sign-in /login
-- bounce, sign-in lands on /dashboard but the BrowseTasks feed still
-- renders the ErrorState. The view query
--   supabase.from('open_jobs_browse').select(...)
-- (src/hooks/useDashboardData.ts:148) throws inside React Query, so
-- BrowseTasksFeed shows the "Something went wrong" card to every signed-
-- in user — even those with no business membership and no admin role.
--
-- Cascade mechanism — identical to PR #355:
--   * `public.jobs` has multiple permissive SELECT policies combined with
--     OR. Postgres does not guarantee short-circuit evaluation across
--     them. When the planner evaluates the `is_business_member` branch
--     first and the calling role lacks EXECUTE on it, the whole query
--     raises 42501 — regardless of whether the user's open-jobs branch
--     would have permitted the row.
--   * `public.open_jobs_browse` (a regular view, not SECURITY DEFINER)
--     calls `mask_job_location(location)` in its projection on every
--     row. A missing grant there fails every row of every query that
--     touches the view — including the dashboard feed and the public
--     unauthenticated browse path.
--
-- Functions covered, with the policies / call sites that need them:
--   public.is_business_member(uuid, uuid)
--     → "Business members can view team jobs" SELECT policy on
--       public.jobs (migration 20260425233224, lines 237-249).
--   public.is_business_owner(uuid, uuid)
--     → defined alongside is_business_member; defensive grant in case a
--       sibling policy adds it later. Same Supabase-advisor risk surface.
--   public.mask_job_location(text)
--     → projection in public.open_jobs_browse (migration 20260426123151,
--       lines 40-82) AND in public.get_public_open_jobs (same migration,
--       lines 22-37). Grant to both authenticated and anon because the
--       public landing-page RPC is reachable unauthenticated.
--
-- Idempotent and replay-safe: each GRANT is guarded by to_regprocedure
-- so a from-scratch rebuild that runs this before the originating CREATE
-- statements is a harmless skip rather than an aborting error. Re-runs
-- after the grants are in place are no-ops.

DO $$
BEGIN
  IF to_regprocedure('public.is_business_member(uuid, uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.is_business_member(uuid, uuid) TO authenticated;
  END IF;

  IF to_regprocedure('public.is_business_owner(uuid, uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.is_business_owner(uuid, uuid) TO authenticated;
  END IF;

  IF to_regprocedure('public.mask_job_location(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.mask_job_location(text) TO authenticated, anon;
  END IF;
END $$;
