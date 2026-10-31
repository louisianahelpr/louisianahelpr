-- declutter_setup_fee_from_payout_cents reads the seller's admin role from public.user_roles directly, not through
-- has_role(). has_role is scoped to its caller (20261012184600): it answers false for someone else's role unless the
-- caller is that person, an admin or the server. declutter_complete_handover (20261031214749) builds the seller's
-- handover notice while running as the BUYER, so for an admin seller has_role(seller, 'admin') read false there and the
-- notice promised "a one-time $2.00 account setup fee comes out", a fee the server-side take (run as service_role) never
-- takes. Reading user_roles directly gives the same answer to every caller.
--
-- Safe to read directly: the function is SECURITY DEFINER, EXECUTE stays revoked from PUBLIC, anon and authenticated
-- (definer callers only), and it answers only an amount, never whether the seller is an admin.
--
-- Restated from its newest CREATE, 20261031214749_seller_setup_fee_from_payout_restated.sql:53. The only change is the
-- admin test. Behind identity_check as before: while the switch is off identity_check_exempt() is true and this answers
-- 0 for every member, so nothing changes until the switch goes on.
-- Lead 10-31 (B37 order 1a, before identity_check can go on).
-- Replay-safe: CREATE OR REPLACE, grants restated.
-- Proof: src/test/pglite/sellerSetupFeeFromPayout.pglite.mjs (applied 3x; FIX=skip is red: an admin seller's handover
-- notice, written as the buyer, names the fee).

CREATE OR REPLACE FUNCTION public.declutter_setup_fee_from_payout_cents(p_seller uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_seller IS NULL OR public.identity_check_exempt(p_seller)
      OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p_seller AND r.role = 'admin') THEN 0
    ELSE public.declutter_setup_fee_due_cents(p_seller)
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_setup_fee_from_payout_cents(uuid) FROM PUBLIC, anon, authenticated;
