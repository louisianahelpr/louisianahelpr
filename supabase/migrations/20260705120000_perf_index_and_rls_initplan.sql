-- Performance advisor 2026-07-05 pass.
--
-- 1. Missing FK index: payment_refunds.initiated_by_user_id
--    The payment_refunds_ledger migration (20260704120000) indexed customer_id,
--    job_id, and created_at but omitted this FK. Without it, any ON DELETE SET NULL
--    cascade from auth.users and any admin query joining on this column does a seq scan.
--
-- 2. auth_rls_initplan fixes: 5 RLS policies across business_members and
--    payment_refunds call auth.uid() / auth.email() as bare function calls, causing
--    Postgres to re-evaluate the auth function for every row scanned. Wrapping them
--    in (select auth.uid()) / (select auth.email()) forces a single evaluation per
--    query (an initplan), matching every other policy in the codebase.
--
-- All statements are replay-safe (IF NOT EXISTS / DROP POLICY IF EXISTS).

-- ============================================================
-- 1. Missing FK index
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_payment_refunds_initiated_by_user_id
  ON public.payment_refunds (initiated_by_user_id);

-- ============================================================
-- 2. business_members RLS — wrap bare auth calls
--    Source: 20260701120000_fix_business_members_roster_auth_email.sql
--    Two policies flagged: SELECT "Members can view their business roster"
--                          UPDATE "Owner can update members; invitee can accept own invite"
-- ============================================================

DROP POLICY IF EXISTS "Members can view their business roster" ON public.business_members;
CREATE POLICY "Members can view their business roster"
ON public.business_members FOR SELECT
USING (
  user_id = (select auth.uid())
  OR public.is_business_member(business_id, (select auth.uid()))
  OR public.is_business_owner(business_id, (select auth.uid()))
  OR public.has_role((select auth.uid()), 'admin')
  OR (
    invited_email IS NOT NULL
    AND status = 'pending'
    AND lower(invited_email) = lower((select auth.email()))
  )
);

DROP POLICY IF EXISTS "Owner can update members; invitee can accept own invite" ON public.business_members;
CREATE POLICY "Owner can update members; invitee can accept own invite"
ON public.business_members FOR UPDATE
USING (
  public.is_business_owner(business_id, (select auth.uid()))
  OR (
    status = 'pending'
    AND invited_email IS NOT NULL
    AND lower(invited_email) = lower((select auth.email()))
  )
);

-- ============================================================
-- 3. payment_refunds RLS — wrap bare auth calls
--    Source: 20260704120000_payment_refunds_ledger.sql
--    Three policies flagged: SELECT "Customers can read their own refunds"
--                            SELECT "Admins read all refunds"
--                            INSERT "Admins can write refunds (manual reconciliation)"
-- ============================================================

DROP POLICY IF EXISTS "Customers can read their own refunds" ON public.payment_refunds;
CREATE POLICY "Customers can read their own refunds"
  ON public.payment_refunds FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = customer_id);

DROP POLICY IF EXISTS "Admins read all refunds" ON public.payment_refunds;
CREATE POLICY "Admins read all refunds"
  ON public.payment_refunds FOR SELECT
  TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can write refunds (manual reconciliation)" ON public.payment_refunds;
CREATE POLICY "Admins can write refunds (manual reconciliation)"
  ON public.payment_refunds FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role((select auth.uid()), 'admin'::app_role));
