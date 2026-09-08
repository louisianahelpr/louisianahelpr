-- Two functions shipped in the last day with the wrong EXECUTE grants. The
-- db-deploy migration-lint gate caught one of them and I did not read it,
-- because a LATER db-deploy run went green and I checked the wrong thing: by
-- then the flagged migration was no longer new relative to the diff base, so
-- the gate had nothing to say about it. A green run does not re-litigate an
-- earlier red one. (Same family as the vercel.json lesson in CLAUDE.md: the
-- deploy that matters is not always the run you are looking at.)
--
-- 1. job_hours_until_start(date, time, timestamptz) — 20260905021859.
--    Created with NO grant statement at all, so it took the default and PUBLIC
--    holds EXECUTE (`=X/postgres` in proacl). That is exactly the rule the gate
--    enforces: "New public function(s) defined without an explicit GRANT or
--    REVOKE". Its real callers are poster_cancel_job and block_user_and_settle,
--    both SECURITY DEFINER, which execute as the owner and need no grant here.
--
-- 2. admin_reverse_violation(uuid, text, boolean) — 20260905025756.
--    This one is mine and it is the worse of the two. That migration ends with
--        REVOKE ALL ON FUNCTION ... FROM PUBLIC;
--        GRANT EXECUTE ON FUNCTION ... TO authenticated;
--    which READS like least privilege and is not. Supabase's ALTER DEFAULT
--    PRIVILEGES grants EXECUTE on new public functions to anon, authenticated
--    and service_role INDIVIDUALLY. Revoking from PUBLIC removes the implicit
--    world grant and leaves every explicit one untouched — so anon kept EXECUTE
--    on an admin-only function, and the migration that intended to prevent
--    exactly that is what shipped it.
--
--    Measured after the fact: of 241 public functions, 168 have anon revoked,
--    so revoking anon is the established norm here — and admin_reverse_violation
--    was the ONLY function named admin_* that anon could call.
--
--    No exploit existed: the function's first statement is
--        IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin') THEN
--          RAISE EXCEPTION 'not_authorized';
--    and an anon caller has a null auth.uid(), so it refuses. This is
--    defence-in-depth being restored, not a hole being closed. But the grant
--    was the layer that was supposed to make the check unreachable, and a
--    REVOKE that silently achieves nothing is worse than no REVOKE at all,
--    because it reads as done.
--
-- THE GENERAL RULE, which is why this is a migration and not a quiet patch:
-- REVOKE ... FROM PUBLIC does NOT imply FROM anon on Supabase. Name the roles.

REVOKE ALL ON FUNCTION public.admin_reverse_violation(uuid, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reverse_violation(uuid, text, boolean)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.job_hours_until_start(date, time, timestamptz)
  FROM PUBLIC, anon;
-- A pure calculator over values the caller already supplies — it reads no
-- tables and can leak nothing — but it decides a cancellation FEE, so keep the
-- surface to the roles that have a reason to compute one.
GRANT EXECUTE ON FUNCTION public.job_hours_until_start(date, time, timestamptz)
  TO authenticated, service_role;
