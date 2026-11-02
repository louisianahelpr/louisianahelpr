-- Shipping S6 part 2e (Q2259; docs/specs/shipping-draft.md 5.3 "Debts (review fix 4)": "a seller with an open shipping
-- debt cannot ship again"; section 11 fix 4: "no new shipped sales while a shipping debt is open"). TEST MODE ONLY:
-- declutter_shipping stays testers; ship orders exist only for testers.
--
-- Before: a seller who owed a spent label (ship_void_rejected, 20261102045553) or any other shipping debt could keep
-- selling by mail: each new shipped sale bought another label the platform pays for first.
-- Now: a BEFORE INSERT trigger on declutter_orders refuses a new order with handover 'ship' while its seller has a
-- shipping fee debt still owed (source_kind ship_label / ship_adjustment / ship_hazmat_fee / ship_void_rejected,
-- remaining_cents > 0). It raises the code checkout already uses for a way the seller does not offer
-- ('handover_not_offered', 22023; its member copy exists), with a hint to choose another way. Every other handover,
-- and a seller whose shipping debts are paid off (declutter_consume_fee_debt brings remaining_cents to 0), is untouched.
-- A trigger rather than a restated declutter_start_checkout: it covers every writer of a new order. An order created
-- before the debt (awaiting payment, reused by the same checkout) is not a new sale and is left alone.
-- The trigger function is not callable by members. Proof: src/test/pglite/shippingDebtBlocksNewShipSales.pglite.mjs
-- (applied 3x; NEW_MIGRATION=skip is red; planted defects). REPLAY-SAFETY: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.declutter_ship_debt_blocks_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.handover = 'ship' AND EXISTS (
       SELECT 1 FROM public.declutter_seller_fee_debts d
        WHERE d.seller_id = NEW.seller_id
          AND d.source_kind IN ('ship_label', 'ship_adjustment', 'ship_hazmat_fee', 'ship_void_rejected')
          AND d.remaining_cents > 0) THEN
    RAISE EXCEPTION 'handover_not_offered' USING ERRCODE = '22023',
      HINT = 'This seller can''t ship right now. Choose another way to get it.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_debt_blocks_sale() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_declutter_orders_ship_debt ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_ship_debt BEFORE INSERT ON public.declutter_orders
  FOR EACH ROW WHEN (NEW.handover = 'ship')
  EXECUTE FUNCTION public.declutter_ship_debt_blocks_sale();
