-- Q399: the messages UPDATE policy "Users can mark messages as read" applies
-- TO public, so it is the one write policy on public.messages that names a
-- signed-out caller.
--
-- Newest definition: 20260819060000_security_authz_hardening.sql re-created it
-- without a TO clause (roles {public}), USING (auth.uid() = receiver_id) WITH
-- CHECK (auth.uid() = receiver_id); 20260924063540_rls_initplan_wrap_auth_uid
-- then restated both expressions with the call wrapped. Every other write
-- policy on messages is already TO authenticated (send: 20260914210443, edit:
-- 20260831003117, delete: 20260325024053).
--
-- Why it matters although nobody signed out can pass it: USING needs
-- receiver_id = auth.uid(), which is NULL for anon, so no row matches today.
-- But scripts/ci/sensitive-anon-grants.sql's WRITE rule treats a command that
-- an anon/public policy covers as "RLS doing its job", so with this policy TO
-- public an anon UPDATE grant on messages (which prod's default privileges
-- hand back on any recreation; Q340 revoked it in 20260925144708) would not go
-- red. TO authenticated closes that exemption, and the check's new
-- write:anon-policy rule (same file) reports any anon/public write policy on
-- messages from now on.
--
-- Predicate unchanged, only the role. Replay-safe: guarded on the table, and
-- DROP IF EXISTS + CREATE is idempotent.

SET lock_timeout = '5s';

DO $q399$
BEGIN
  IF to_regclass('public.messages') IS NULL THEN
    RAISE NOTICE 'public.messages absent: Q399 policy restatement skipped';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Users can mark messages as read" ON public.messages;
  CREATE POLICY "Users can mark messages as read"
    ON public.messages
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = receiver_id)
    WITH CHECK ((SELECT auth.uid()) = receiver_id);
END
$q399$;

RESET lock_timeout;
