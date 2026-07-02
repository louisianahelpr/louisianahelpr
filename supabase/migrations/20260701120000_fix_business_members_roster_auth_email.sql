-- Fix: business_members RLS referenced auth.users inline, which the
-- `authenticated` role has no SELECT grant on. Postgres evaluates an RLS
-- USING clause as the querying role, so the correlated subquery
-- `(SELECT email FROM auth.users WHERE id = auth.uid())` raised
-- `42501 permission denied for table users` for EVERY authenticated read of
-- business_members — bricking the entire business team feature (roster,
-- approvals, activity, seats) in production.
--
-- auth.email() returns the email straight from the request JWT claim and
-- touches no table, so it needs no grant. Swap both policies to use it.
-- Replay-safe: drop-if-exists then recreate.

DROP POLICY IF EXISTS "Members can view their business roster" ON public.business_members;
CREATE POLICY "Members can view their business roster"
ON public.business_members FOR SELECT
USING (
  user_id = auth.uid()
  OR public.is_business_member(business_id, auth.uid())
  OR public.is_business_owner(business_id, auth.uid())
  OR public.has_role(auth.uid(), 'admin')
  OR (
    invited_email IS NOT NULL
    AND status = 'pending'
    AND lower(invited_email) = lower(auth.email())
  )
);

DROP POLICY IF EXISTS "Owner can update members; invitee can accept own invite" ON public.business_members;
CREATE POLICY "Owner can update members; invitee can accept own invite"
ON public.business_members FOR UPDATE
USING (
  public.is_business_owner(business_id, auth.uid())
  OR (
    status = 'pending'
    AND invited_email IS NOT NULL
    AND lower(invited_email) = lower(auth.email())
  )
);
