-- Make RLS honour the "Admin" role the product already advertises.
--
-- THE GAP
-- -------
-- src/components/business/roles.ts ships Admin as "Manages team members,
-- billing, and approval threshold" (canManage: true), and
-- src/pages/BusinessTeam.tsx derives `isAdminOrOwner = canManageTeam(role)`
-- to open the invite form, the bulk-CSV button, the per-member role select
-- and the Remove button to admins as well as owners.
--
-- The server disagreed. Verified live against pg_policies BEFORE this file:
--   INSERT "Owner can invite members"                     WITH CHECK is_business_owner(business_id, auth.uid())
--   DELETE "Owner can remove members"                     USING      is_business_owner(...) AND role <> 'owner'
--   UPDATE "Owner can update members; invitee can accept…" USING     is_business_owner(...) OR <own pending invite>
--
-- is_business_owner() reads businesses.owner_id, so a non-owner Admin was
-- shown the invite form and the Remove button and got a bare RLS rejection
-- when they used either. Advertised, and non-functional.
--
-- THE DECISION: (a) — make the server honour the documented role.
-- ---------------------------------------------------------------
-- Chosen over "hide the UI" because the intent is not merely documented in a
-- comment, it is already IMPLEMENTED server-side for the sibling operations.
-- 20260609170000 ships four SECURITY DEFINER RPCs whose authorization is
-- explicitly `owner OR active admin`:
--   update_business_member_role  (an admin may change roles, never to/from owner)
--   approve_pending_job / reject_pending_job
--   reassign_business_jobs       ("Only owners + admins reassign")
-- So an Admin can already change a teammate's role and reassign their jobs,
-- but could not invite or remove one. That is an inconsistency in the RLS
-- layer, not a deliberate product boundary — (b) would have to delete working,
-- deliberately-written admin authorization from four RPCs to be coherent.
--
-- WIDENING PRECISELY (this reopens ground SEC-002 just closed — 20260818140000)
-- ---------------------------------------------------------------------------
-- 20260818140000 removed an INSERT clause `(role = 'owner' AND user_id =
-- auth.uid())` that constrained NOTHING about business_id, letting any
-- authenticated user insert themselves into ANY business. The new grant must
-- not reintroduce any part of that shape:
--   • it is scoped to a specific business_id — is_business_admin(business_id, …)
--     is evaluated against the row's own business_id, so an admin of X gets
--     nothing at Y;
--   • it requires status = 'active', so a pending invitee or a removed member
--     does not qualify;
--   • it requires extended_role = 'admin', so a viewer/poster/approver does not;
--   • it explicitly forbids writing role = 'owner' or extended_role = 'owner',
--     so an admin can neither crown themselves nor crown anyone else — the
--     owner set stays rooted in businesses.owner_id, which only business
--     creation can set. This also keeps the seat cap intact:
--     enforce_business_member_limit() returns early for NEW.role = 'owner',
--     so admitting an owner-row insert would have handed admins a seat-cap
--     bypass on top of the escalation.
-- The privilege chain therefore still roots at the owner: admin rows are
-- created only by the owner (or by an existing admin) via
-- update_business_member_role, which likewise refuses p_role = 'owner'.
--
-- WHY A SECURITY DEFINER HELPER RATHER THAN AN INLINE SUBQUERY
-- -----------------------------------------------------------
-- The predicate reads business_members from inside a policy ON
-- business_members. Inlined, that recurses through RLS. is_business_admin() is
-- SECURITY DEFINER with a pinned search_path, exactly like the
-- is_business_owner()/is_business_member() pair it sits beside, so the lookup
-- runs as the definer and terminates. It is also STABLE, so the planner hoists
-- it to one call per statement instead of one per row.
--
-- UPDATE IS DELIBERATELY LEFT OWNER-ONLY
-- --------------------------------------
-- The only member field the UI lets an admin change is extended_role, and that
-- already works for admins through update_business_member_role — a SECURITY
-- DEFINER RPC that validates `p_role NOT IN ('owner')` before writing. A raw
-- UPDATE grant would additionally let an admin rewrite user_id, status, and
-- business_id on an existing row, which buys the product nothing and adds
-- escalation surface. (BusinessTeam.tsx's direct-UPDATE branch is a PGRST202
-- fallback for the RPC being absent; the RPC is present in production —
-- to_regprocedure('public.update_business_member_role(uuid,text)') is non-null.)
--
-- REPLAY-SAFE
-- -----------
-- public.business_members, the business_member_role enum and
-- public.is_business_owner all come from 20260425233224; the extended_role
-- column and its CHECK come from 20260609170000. Both sort earlier, so every
-- object referenced here exists by the time this file runs in a from-scratch
-- rebuild. CREATE OR REPLACE FUNCTION and DROP POLICY IF EXISTS make a re-run
-- idempotent. `TO authenticated` and the (select auth.uid()) wrapper match the
-- surrounding policies, so there is no role or initplan regression.

-- ---------------------------------------------------------------------
-- 1. Helper: is the user an ACTIVE admin of THIS business?
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_business_admin(_business_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = _business_id
      AND user_id = _user_id
      AND status = 'active'
      AND extended_role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_business_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_business_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_admin(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.is_business_admin(uuid, uuid) IS
  'True when _user_id is an ACTIVE business_members row for _business_id with extended_role = ''admin''. SECURITY DEFINER so RLS policies on business_members can call it without recursing. Never confers owner rights — owner is businesses.owner_id, read by is_business_owner().';

-- ---------------------------------------------------------------------
-- 2. INSERT — an admin may invite into their own business, never as owner
-- ---------------------------------------------------------------------
-- Separate permissive policy rather than widening "Owner can invite members":
-- permissive WITH CHECKs are OR'd, so the owner path keeps its own (broader)
-- rule and the admin path carries its own anti-escalation guard. An owner's
-- insert is unaffected by the guard below; an admin's insert can only pass
-- through this policy, and therefore only with a non-owner role.
DROP POLICY IF EXISTS "Admin can invite members" ON public.business_members;

CREATE POLICY "Admin can invite members"
ON public.business_members FOR INSERT
TO authenticated
WITH CHECK (
  public.is_business_admin(business_id, (select auth.uid()))
  AND role <> 'owner'::public.business_member_role
  AND (extended_role IS NULL OR extended_role <> 'owner')
);

-- ---------------------------------------------------------------------
-- 3. DELETE — an admin may remove teammates, never the owner row
-- ---------------------------------------------------------------------
-- Mirrors the owner policy's `role <> 'owner'` guard and adds the
-- extended_role twin, so neither spelling of "owner" can be deleted by an
-- admin. Removing the owner's membership row would strand the business.
DROP POLICY IF EXISTS "Admin can remove members" ON public.business_members;

CREATE POLICY "Admin can remove members"
ON public.business_members FOR DELETE
TO authenticated
USING (
  public.is_business_admin(business_id, (select auth.uid()))
  AND role <> 'owner'::public.business_member_role
  AND (extended_role IS NULL OR extended_role <> 'owner')
);
