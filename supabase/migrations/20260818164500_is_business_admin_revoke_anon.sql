-- Strip the anon EXECUTE grant that public schema default privileges hand every
-- new function, so is_business_admin() matches its siblings.
--
-- WHAT WENT WRONG IN 20260818160000
-- ---------------------------------
-- That migration ended with the intended pair:
--   REVOKE ALL ON FUNCTION public.is_business_admin(uuid,uuid) FROM PUBLIC;
--   GRANT EXECUTE ... TO authenticated;  GRANT EXECUTE ... TO service_role;
-- REVOKE ... FROM PUBLIC only removes the implicit PUBLIC grant. It does NOT
-- remove a grant held explicitly by a named role, and this database carries
-- default privileges that attach one at CREATE time:
--
--   pg_default_acl, grantor postgres, schema public, objtype f:
--     {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
-- So the function was created with anon=X already attached, the REVOKE FROM
-- PUBLIC sailed past it, and the live ACL read back as:
--   {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- against is_business_owner()'s
--   {postgres=X/postgres,             service_role=X/postgres, authenticated=X/postgres}
--
-- WHY IT MATTERS
-- --------------
-- is_business_admin is SECURITY DEFINER and takes both ids as arguments, so it
-- never consults auth.uid(). Executable by anon, it is an unauthenticated
-- membership oracle: anyone holding a business UUID and a user UUID can ask
-- "is this person an active admin of that business?" and get a boolean back.
-- Low severity on its own — it discloses no PII and both ids must already be
-- known — but it is a gratuitous widening of an authorization helper, and the
-- asymmetry with is_business_owner is the kind of drift that later reads as
-- intentional. The RLS policies and the send-business-invite-email function
-- both call it as authenticated / service_role, so anon needs nothing here.
--
-- Note this is invisible to scripts/check-migration-grants.mjs, which asserts
-- that an explicit GRANT or REVOKE exists — 20260818160000 had both. The guard
-- cannot see that a default privilege re-added a role the REVOKE never covered.
--
-- Replay-safe: guarded on to_regprocedure so a from-scratch rebuild that has
-- not yet reached 20260818160000 (or a branch where it was reverted) skips
-- rather than aborting. REVOKE is idempotent.

DO $$
BEGIN
  IF to_regprocedure('public.is_business_admin(uuid,uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.is_business_admin(uuid, uuid) FROM anon;
  END IF;
END
$$;
