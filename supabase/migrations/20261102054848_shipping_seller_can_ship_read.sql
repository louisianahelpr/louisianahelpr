-- Shipping S6 part 2e, the buyer's side (Q2259; lead 11-01 after the 2e verdict): checkout offered "Ship it to me" for
-- a seller who owes a shipping debt, and only the server's refusal (20261102054411, handover_not_offered) said no, after
-- the buyer had typed an address and bought a quote.
-- Now: declutter_seller_can_ship(seller) answers whether that seller may make a new shipped sale, by the SAME rule as the
-- order trigger (no ship_label / ship_adjustment / ship_hazmat_fee / ship_void_rejected debt with remaining_cents > 0).
-- Checkout reads it and leaves "Ship it to me" out when it is false. It returns one yes/no, never an amount, a kind or a
-- count; the refusal at checkout already tells a buyer the same thing.
-- Signed-in members only, behind the testers switch (require_feature('declutter_shipping'), 42501 otherwise); anon may
-- not call it. Proof: src/test/pglite/shippingSellerCanShip.pglite.mjs. REPLAY-SAFETY: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.declutter_seller_can_ship(p_seller_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter_shipping');
  RETURN NOT EXISTS (
    SELECT 1 FROM public.declutter_seller_fee_debts d
     WHERE d.seller_id = p_seller_id
       AND d.source_kind IN ('ship_label', 'ship_adjustment', 'ship_hazmat_fee', 'ship_void_rejected')
       AND d.remaining_cents > 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_can_ship(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_can_ship(uuid) TO authenticated, service_role;
