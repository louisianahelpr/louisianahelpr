-- Restore anonymous (guest) access to the public jobs-browse surface.
--
-- Detected 2026-05-29 on a fresh sim cold-launch: guest Dashboard
-- renders the "We couldn't load jobs" ErrorState. Direct REST queries
-- with the anon key confirm two grant regressions:
--
--   GET /rest/v1/open_jobs_browse → 42501
--     "permission denied for table jobs"
--     "Grant the required privileges to the current role with:
--        GRANT SELECT ON public.jobs TO anon;"
--
--   POST /rest/v1/rpc/get_public_open_jobs → 42501
--     "permission denied for function get_public_open_jobs"
--
-- Root causes — both Supabase-advisor-strip pattern, same family as
-- PR #355 / #358 / #364 / #365:
--
--   1. `public.open_jobs_browse` is a regular VIEW. With Postgres /
--      Supabase's default `security_invoker = true`, the underlying
--      `public.jobs` SELECT is checked against the *caller* role. Anon
--      has no SELECT on jobs (intentionally — direct table access would
--      bypass the view's column-masking and bleed private columns). The
--      view originally worked for anon because it was created under the
--      old `security_invoker = false` default, where the underlying
--      SELECT ran as the view OWNER. An advisor pass appears to have
--      flipped it. Restore the original posture explicitly via
--      ALTER VIEW … SET (security_invoker = false). The view itself
--      already filters to status='open' AND only-public-direct-offers,
--      so this stays privacy-safe — anon still cannot see closed jobs
--      or jobs with active direct offers.
--
--   2. `public.get_public_open_jobs(integer)` is the landing-page-facing
--      RPC that returns redacted (City, State only) cards for
--      marketing surfaces (SocialProofSection on Index, PayoutTicker).
--      Defined as STABLE SECURITY DEFINER in migration 20260426123151,
--      it relies on default PUBLIC EXECUTE that the advisor stripped.
--      Grant explicitly to anon and authenticated.
--
-- Idempotent and replay-safe — ALTER VIEW is no-op when the setting
-- already matches; GRANT is no-op when the privilege is already in
-- place; both guarded by existence checks.

-- ── 1. View security posture ─────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NOT NULL THEN
    -- Run the view as its owner so anon's lack of SELECT on the
    -- underlying jobs table is not in the evaluation path. RLS still
    -- applies as the owner role (no BYPASSRLS), but the view's own
    -- WHERE clause (status='open' AND open-to-public) is what gates
    -- anonymous visibility, exactly as it did originally.
    ALTER VIEW public.open_jobs_browse SET (security_invoker = false);
  END IF;
END $$;

-- ── 2. Public landing-page RPC grant ─────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.get_public_open_jobs(integer)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_public_open_jobs(integer)
      TO anon, authenticated;
  END IF;
END $$;
