-- Shops H4, part 1 of 2: the ID check (audit ~/.lh-shots/audit-1105-shops.md H4; "Settled: don't ask" Q1954;
-- owner rule 10-30 "once per account, ever"; L56 "ID check required").
--
-- What was wrong: shops_assert_owner_eligible, shops_publish_item and shops_request_order read no ID rule at all
-- (pg_proc.prosrc on prod has no 'identity' reference, measured 2026-11-05), so with identity_check = everyone a
-- member could open a shop and sell, or order from one, with no ID check, while Declutter asks at both points.
--
-- What this does, reusing Declutter's ONE gate (declutter_identity_gate, 20261021202226; its carve-outs are kept
-- as they are: server writes, admins, identity_check_exempt (enrolled test accounts, the reviewer account, and
-- everyone while the identity_check switch is off) and anyone already verified, through Jobs or Declutter):
--   * the shop owner is checked like a Declutter SELLER, at listing: a shop_items row going from 'draft' into
--     'pending_review' or 'live' (shops_publish_item) when auth.uid() is its owner -> 'identity_required_to_list'.
--     An admin approving a held item, and a live edit that a check sends to review (live -> pending_review), are
--     not new listings and are not judged.
--   * the buyer is checked like a Declutter BUYER, at the first purchase: a shop_orders row INSERTed for
--     auth.uid() as its buyer (shops_request_order, which shop-checkout calls with the buyer's own token)
--     -> 'identity_required_to_buy'. shop-checkout answers 403 with that code and the app opens the one ID sheet.
-- The $2 one-time setup fee (seller: from the first payout; buyer: at the first order) is part 2, a money change
-- that needs the lh-money-escrow review; not here.
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS. No money moves.

CREATE OR REPLACE FUNCTION public.shop_identity_before_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status IN ('pending_review', 'live') AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    PERFORM public.declutter_identity_gate(NEW.owner_id, 'identity_required_to_list');
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_identity_before_list() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_items_identity_before_list ON public.shop_items;
CREATE TRIGGER trg_shop_items_identity_before_list
  BEFORE INSERT OR UPDATE OF status ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.shop_identity_before_list();

CREATE OR REPLACE FUNCTION public.shop_identity_before_buy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.declutter_identity_gate(NEW.buyer_id, 'identity_required_to_buy');
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_identity_before_buy() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_identity_before_buy ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_identity_before_buy
  BEFORE INSERT ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_identity_before_buy();
