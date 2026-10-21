-- Q2305: public.user_roles keeps its RLS policies as the SECOND layer, not the only one.
--
-- user_roles is the table that makes an account an admin. Measured read-only on prod
-- 2026-10-21 (information_schema.role_table_grants): anon and authenticated both still held
-- SELECT, INSERT, UPDATE, DELETE and REFERENCES on it, Supabase's default GRANT ALL minus the
-- TRUNCATE/TRIGGER sweep (20260903024453). RLS is on and its five policies hold (INSERT only
-- WITH CHECK has_role(admin), UPDATE false for everyone, DELETE admins only, no anon policy),
-- so nothing was exploitable; but one mistaken policy would have let a member grant themselves
-- admin, with no grant standing behind it.
--
-- After this migration:
--   anon           nothing. No anon policy exists, so anon could only ever read zero rows.
--   authenticated  SELECT (useCurrentUser's own-role read; the admin lists, export, analytics
--                  and health) and DELETE (AdminSettings' removeAdmin, gated by the
--                  "Admins can delete roles" policy). Nothing in the app INSERTs or UPDATEs
--                  as a member: granting admin is admin-user-actions as service_role, and the
--                  sign-up default role is handle_new_user (SECURITY DEFINER, owner postgres).
--   service_role, postgres  unchanged.
-- Every function that reads or writes user_roles on prod is SECURITY DEFINER owned by postgres
-- (24 of them, pg_proc 2026-10-21), and no view or other table's policy reads it, so none of
-- them depends on a client role's grant.
--
-- authenticated is revoked ALL and then granted back exactly SELECT and DELETE, so nothing else
-- survives, including Postgres 17's MAINTAIN (relacl showed authenticated=arwdxm/postgres:
-- the trailing m), which a list of named privileges would have left behind.
--
-- Replay-safe: REVOKE and GRANT are idempotent. PGlite proof:
-- src/test/pglite/userRolesTableGrants.pglite.mjs. Guard: src/test/userRolesTableGrants.test.ts.

REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.user_roles FROM authenticated;
GRANT SELECT, DELETE ON TABLE public.user_roles TO authenticated;
