-- Restore EXECUTE on public.has_role(uuid, public.app_role) to `authenticated`.
--
-- Symptom (2026-05-28, reproduced on iPhone 17 Pro sim): every sign-in
-- shows the "Welcome back" toast, then bounces back to /login. The
-- captured iOS system log surfaced the underlying database error:
--
--   [error] - [StrikeBanner] failed to load ban status:
--     {"code":"42501","message":"permission denied for function has_role"}
--
-- Why one missing grant cascades into a full /login bounce:
--
--   * has_role() is invoked from many SELECT / UPDATE RLS policies —
--     profiles ("Admins can view all profiles"), user_roles ("Admins can
--     view all roles"), legal_acceptances, applications, jobs
--     admin-override paths, etc.
--   * Postgres does NOT guarantee short-circuit evaluation across an
--     OR-combined set of RLS policies. When the has_role branch is
--     evaluated first and the calling role lacks EXECUTE on the function,
--     the whole query raises 42501 — even though the user's own-rows
--     policy would have permitted the row on its own.
--   * useCurrentUser (src/hooks/useCurrentUser.ts) fetches profiles +
--     user_roles in parallel; both hit 42501; React Query exhausts its
--     retries; { isError: true }.
--   * ProtectedRoute (src/components/ProtectedRoute.tsx) treats an
--     unrecoverable profile-fetch error as defense-in-depth and bounces
--     to /login — by design. That is the redirect that lands the user
--     back on the login screen right after "Welcome back".
--
-- Likely cause of the lost grant: a Supabase advisor "fix" or a manual
-- REVOKE applied through the dashboard. The original function definition
-- (migration 20260311000404, lines 94-102) does not include an explicit
-- GRANT and relied on the default PUBLIC EXECUTE that something later
-- stripped.
--
-- Idempotent — re-running once the grant is in place is a no-op.
-- Replay-safe — guarded on the function actually existing, so a
-- from-scratch rebuild that happens to run this before 20260311000404 is
-- a harmless skip rather than an aborting error.

DO $$
BEGIN
  IF to_regprocedure('public.has_role(uuid, public.app_role)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
  END IF;
END $$;
