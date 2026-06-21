-- Fix: "infinite recursion detected in policy for relation profiles"
--
-- The "Users can update their own safe fields" UPDATE policy had a WITH CHECK
-- that compared each privileged column against a subquery `SELECT ... FROM
-- public.profiles`. Evaluating a same-table subquery inside a WITH CHECK
-- re-enters profiles' RLS and Postgres flags it as infinite recursion, so
-- EVERY authenticated profile UPDATE failed with a 500 (surfaced in-app as the
-- "new row violates row-level security policy" toast on the complete-profile
-- "Enter app" step).
--
-- The privileged-field invariant is already enforced — without recursion — by
-- the BEFORE UPDATE trigger `tr_prevent_self_escalation` (function
-- public.prevent_self_escalation), which force-resets approval_status,
-- ban_status, subscription_tier, stripe_account_id, idv_status and ~25 other
-- sensitive columns to OLD for any non-admin. A BEFORE trigger sees OLD/NEW
-- directly and never re-enters RLS, so the WITH CHECK subqueries are pure
-- redundancy. Drop them and keep only the ownership check.

DROP POLICY IF EXISTS "Users can update their own safe fields" ON public.profiles;

CREATE POLICY "Users can update their own safe fields"
ON public.profiles
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);
