-- Two "Deny all …" policies on public.user_roles. Neither enforces anything.
-- One of them is wrong in a way that is invisible, and it is on the table
-- that grants admin.
--
-- Measured on prod (fncmgoasalhdgfwzhsqa) 2026-09-02, six policies, all
-- PERMISSIVE, zero RESTRICTIVE:
--
--   DELETE  "Admins can delete roles"          PERMISSIVE  USING has_role(uid,'admin')
--   DELETE  "Deny all deletes to user_roles"   PERMISSIVE  USING false
--   UPDATE  "Deny all updates to user_roles"   PERMISSIVE  USING false WITH CHECK false
--
-- Permissive policies are OR-ed. A permissive `USING (false)` therefore
-- contributes nothing — it can never subtract access, only fail to add any.
-- So:
--
--   * DELETE is governed ENTIRELY by "Admins can delete roles", exactly as if
--     the deny policy did not exist. The deny reads as a hard stop, is named
--     as a hard stop, and is a no-op.
--
--   * UPDATE really is denied — but by ACCIDENT, not by the deny. It is denied
--     because "Deny all updates" is the only permissive UPDATE policy and it
--     never passes, so nothing grants the command. The moment anyone adds a
--     legitimate permissive UPDATE policy (say, "admins can change a role"),
--     the deny silently stops mattering and updates open up. Two policies
--     written identically, one inert and one working by luck.
--
-- This migration makes each one say what it does.
--
--   1. The DELETE deny is DROPPED. Admin deletion is the intended behaviour
--      (the sibling policy is deliberate), so the honest change is to remove
--      the control that pretends to forbid it rather than to start enforcing
--      a rule nobody wants. Net DELETE behaviour is unchanged: admins can
--      delete, nobody else can.
--
--   2. The UPDATE deny is recreated AS RESTRICTIVE. Restrictive policies are
--      AND-ed, so `USING (false)` now genuinely subtracts: no UPDATE can pass
--      regardless of what permissive policy is added later. Net UPDATE
--      behaviour is also unchanged today — updates are denied now and denied
--      after — but it becomes enforced rather than incidental.
--
-- Net effect on access: NONE. This is a correctness-of-controls change. What
-- changes is that the table stops lying about which rules are load-bearing.
--
-- Replay-safe: every statement is IF EXISTS / guarded, and the whole file is
-- wrapped in a to_regclass check so it is inert if the table is ever dropped.

DO $$
BEGIN
  IF to_regclass('public.user_roles') IS NULL THEN
    RAISE WARNING 'public.user_roles is missing — skipping the deny-policy repair';
    RETURN;
  END IF;

  -- 1. The inert DELETE deny. Dropping it does not widen access: it never
  --    narrowed any.
  DROP POLICY IF EXISTS "Deny all deletes to user_roles" ON public.user_roles;

  -- 2. The UPDATE deny, re-declared so it actually denies. DROP first because
  --    a policy's PERMISSIVE/RESTRICTIVE nature cannot be altered in place.
  DROP POLICY IF EXISTS "Deny all updates to user_roles" ON public.user_roles;
  CREATE POLICY "Deny all updates to user_roles"
    ON public.user_roles
    AS RESTRICTIVE
    FOR UPDATE
    USING (false)
    WITH CHECK (false);
END
$$;

-- Verification. Warns rather than raises: a policy drift here should surface
-- in the deploy log, not abort a deploy that has already applied.
DO $verify$
DECLARE
  v_delete_deny int;
  v_update_restrictive int;
BEGIN
  IF to_regclass('public.user_roles') IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_delete_deny
    FROM pg_policy
   WHERE polrelid = 'public.user_roles'::regclass
     AND polname = 'Deny all deletes to user_roles';

  SELECT count(*) INTO v_update_restrictive
    FROM pg_policy
   WHERE polrelid = 'public.user_roles'::regclass
     AND polname = 'Deny all updates to user_roles'
     AND polpermissive IS FALSE;

  IF v_delete_deny <> 0 THEN
    RAISE WARNING 'the inert PERMISSIVE "Deny all deletes to user_roles" policy is still present on public.user_roles';
  END IF;

  IF v_update_restrictive <> 1 THEN
    RAISE WARNING '"Deny all updates to user_roles" is not RESTRICTIVE on public.user_roles — UPDATE is once again denied only by the absence of a permissive policy, which the next permissive policy will silently undo';
  END IF;
END
$verify$;
