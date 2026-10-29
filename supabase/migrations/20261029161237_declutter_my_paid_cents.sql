-- A1-B2 (b), Declutter audit on prod 2026-10-29: after a first purchase the app
-- said "You paid $32.20" while Stripe charged $34.20. The three "You paid"
-- screens (BoughtWhatNext, BuyingOrders, DeclutterPorchHandover) print the cart
-- line's total_cents, and the one-time account setup fee sits OUTSIDE
-- total_cents by design (20261026154738: declutter-checkout charges
-- total_cents + setup_fee_cents). setup_fee_cents and setup_fee_state are not
-- granted to members (the seller reads the same order row), so the client
-- cannot add it itself.
--
-- declutter_my_paid_cents(order ids): for each of the CALLER's own orders as
-- buyer (another member's ids answer nothing), what the buyer's card was
-- charged for it, to the cent:
--   total_cents + setup_fee_cents, minus the setup fee when it never stayed
--   charged: 'not_charged' (the page did not carry it), 'refund_due' (another
--   path paid the account's fee first; the stripe-webhook sends exactly it
--   back) or 'refunded' (sent back).
-- Read-only: no write, no lock. The seller never sees the buyer's setup fee.
--
-- Replay-safe: CREATE OR REPLACE with one signature, grants restated by role
-- name. Proof: src/test/pglite/declutterMyPaidCents.pglite.mjs (applied 3x).

CREATE OR REPLACE FUNCTION public.declutter_my_paid_cents(p_order_ids uuid[])
RETURNS TABLE (order_id uuid, paid_cents integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_order_ids), 0) > 200 THEN
    RAISE EXCEPTION 'too_many_orders' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT o.id,
           (o.total_cents
             + CASE WHEN o.setup_fee_state IN ('not_charged', 'refund_due', 'refunded') THEN 0
                    ELSE o.setup_fee_cents END)::integer
      FROM public.declutter_orders o
     WHERE o.id = ANY (p_order_ids)
       AND o.buyer_id = v_uid;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_my_paid_cents(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_paid_cents(uuid[]) TO authenticated, service_role;
