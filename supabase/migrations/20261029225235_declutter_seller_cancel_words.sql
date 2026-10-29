-- Declutter: the seller's "Cancel sale" words (audit 1028 part 2, D2-16 and D2-10; builder 43, 2026-10-29).
--
-- declutter_seller_cancel_sale only ever cancels an UNPAID sale (a paid line raises sale_already_paid), yet its
-- notice told the buyer "If you already paid, every cent comes back to your card". Now: "Nothing was charged."
-- Its strike said "after accepting it" even for a Buy now, where the seller accepted nothing; the strike text now
-- follows the cart line's source ('offer' keeps "after accepting it", 'buy' drops it).
--
-- Restated VERBATIM from its newest definition, 20261014224914_declutter_slice3b_payments.sql section 7, which is
-- byte-for-byte what prod runs (pg_get_functiondef md5 aeec40473c6bef24757194d77b03ee08, read 2026-10-29). Only the
-- two strings change. No logic, lock, money, strike kind or grant change; the grants are restated as they are.
--
-- REPLAY-SAFE: CREATE OR REPLACE of an existing function. Applied 3x in PGlite
-- (src/test/pglite/declutterSellerCancelWords.pglite.mjs).
CREATE OR REPLACE FUNCTION public.declutter_seller_cancel_sale(p_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item record;
  v_line record;
BEGIN
  -- Not strike/age/switch-gated: anyone may back out (and takes the strike).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Ownership before any lock (lh-authz-rls review 3b #4): with no switch gate,
  -- a stranger must not be able to lock someone else's items, even briefly.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id = p_item_id
      OR i.id IN (SELECT c2.item_id FROM public.declutter_cart_items c2
                   WHERE c2.order_id = (SELECT c.order_id FROM public.declutter_cart_items c
                                         WHERE c.item_id = p_item_id AND c.status = 'in_cart'))
   ORDER BY i.id FOR UPDATE;
  SELECT i.id, i.status, i.title INTO v_item FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT c.* INTO v_line FROM public.declutter_cart_items c
   WHERE c.item_id = p_item_id AND c.status IN ('in_cart', 'paid');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_sale_to_cancel' USING ERRCODE = '55000';
  END IF;
  IF v_line.status = 'paid' THEN
    RAISE EXCEPTION 'sale_already_paid' USING ERRCODE = '55000',
      HINT = 'The buyer already paid. Contact support to cancel.';
  END IF;
  IF v_line.order_id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_cancelled', closed_at = now()
     WHERE id = v_line.order_id AND status = 'awaiting_payment';
  END IF;
  UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
   WHERE id = v_line.id AND status = 'in_cart';
  IF v_line.order_id IS NOT NULL THEN
    UPDATE public.declutter_cart_items SET order_id = NULL
     WHERE order_id = v_line.order_id AND status = 'in_cart';
  END IF;
  UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
   WHERE id = p_item_id AND status = 'reserved';
  -- D2-16: only an unpaid sale gets here (sale_already_paid above), so nothing was charged.
  PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'The seller cancelled',
    format('The seller cancelled the sale of "%s". Nothing was charged.', v_item.title), '/declutter?view=cart', v_uid);
  -- D2-10: "after accepting it" only when the seller accepted an offer; a Buy now had nothing to accept.
  RETURN public.declutter_give_strike(v_uid, 'seller', 'cancelled_after_offers', p_item_id,
    CASE WHEN v_line.source = 'offer'
         THEN format('You cancelled the sale of "%s" after accepting it.', v_item.title)
         ELSE format('You cancelled the sale of "%s".', v_item.title) END, v_line.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_cancel_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_cancel_sale(uuid) TO authenticated, service_role;
