-- declutter_seller_can_ship(NULL) answered TRUE (lead 11-02): NOT EXISTS over "seller_id = NULL" finds no debt, so a
-- missing seller read as "may ship". Low risk (the order trigger 20261102054411 still refuses a shipped sale for a
-- seller who owes a shipping debt), but a yes/no read must never say yes about nobody: a NULL seller now answers
-- FALSE. Everything else is restated unchanged from the newest definition (20261102054848): signed-in members only
-- (42501 otherwise), behind the testers switch (require_feature('declutter_shipping')), one yes/no and nothing more,
-- anon may not call it. Proof: src/test/pglite/shippingSellerCanShipNull.pglite.mjs.
-- REPLAY-SAFETY: CREATE OR REPLACE only; the grants are restated after it.

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
  -- No seller, no yes.
  IF p_seller_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM public.declutter_seller_fee_debts d
     WHERE d.seller_id = p_seller_id
       AND d.source_kind IN ('ship_label', 'ship_adjustment', 'ship_hazmat_fee', 'ship_void_rejected')
       AND d.remaining_cents > 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_can_ship(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_can_ship(uuid) TO authenticated, service_role;
