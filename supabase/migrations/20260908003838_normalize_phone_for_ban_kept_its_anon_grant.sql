-- One REVOKE in 20260908002148 named PUBLIC and stopped there.
--
-- The other six functions in that migration were revoked `FROM PUBLIC, anon,
-- authenticated`. `normalize_phone_for_ban` got `REVOKE ALL ... FROM PUBLIC`
-- alone, and Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every new
-- public function to anon, authenticated and service_role INDIVIDUALLY — so
-- revoking PUBLIC dropped the implicit world grant and left all three explicit
-- ones untouched.
--
-- Read from prod after the deploy, which is the only way this is visible:
--
--   normalize_phone_for_ban  {postgres=X/postgres,anon=X/postgres,
--                             authenticated=X/postgres,service_role=X/postgres}
--   ban_fingerprint          {postgres=X/postgres,service_role=X/postgres}
--
-- The consequence is small — it is a pure string normaliser with no data
-- access, and the fingerprint function that consumes it is correctly locked —
-- so this is least privilege, not a breach. It is worth its own migration
-- anyway for the reason the house rule exists: a REVOKE that silently does
-- nothing reads as done in review, and the next person to copy this block
-- inherits the bug.

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.normalize_phone_for_ban(text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.normalize_phone_for_ban(text) TO service_role';
EXCEPTION WHEN undefined_object THEN
  -- PGlite / CI replay has no Supabase roles.
  NULL;
END;
$$;
