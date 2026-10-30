-- Declutter: a giver who cancels a FREE claim gets no strike, and the item goes back up (owner 2026-10-30 08:25,
-- pop-up answer 1: "no strike for a giver who cancels a free claim"; built by Builder 100).
--
-- declutter_seller_cancel_sale gave the seller a strike for ANY unpaid line, including a free item someone claimed
-- (or, with the Free change, the person the giver picked) who has not chosen a pickup yet. Now, when the line is
-- free (price_cents = 0):
--   * no strike (the function returns the seller's current active strike count, unchanged);
--   * the item goes back up (live), unless the seller is out of Declutter (then it comes down, as before);
--   * the person who claimed it is told it went back up, nothing was charged and they get no strike.
-- A paid line (price_cents > 0) is untouched: same strike, same words, the listing still comes down.
-- A free pickup already booked (line status 'paid', paid_with 'free') is untouched too: it still raises
-- sale_already_paid, exactly as before.
--
-- Restated from the EFFECTIVE prod definition, which is 20261029225235_declutter_seller_cancel_words.sql
-- (pg_get_functiondef on prod 2026-10-30, md5 9e66c79750aabc2e90a6db88879056b0; identical to that file but for the
-- dollar-quote tag). No queued branch restates this function. Each change is marked "B100". No lock, ownership,
-- paid-line or grant change; the grants are restated as they are.
--
-- REPLAY-SAFE: CREATE OR REPLACE of an existing function. Applied 3x in PGlite
-- (src/test/pglite/declutterFreeClaimCancelNoStrike.pglite.mjs).
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
  -- Not strike/age/switch-gated: anyone may back out (and takes the strike, unless the line is free: B100).
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
  -- B100: a free claim goes back up with no strike for anyone (a seller who is out of Declutter cannot have a live
  -- listing, so theirs comes down as before), and the person who claimed it is told so.
  IF v_line.price_cents = 0 THEN
    IF public.declutter_seller_out(v_uid) THEN
      UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
       WHERE id = p_item_id AND status = 'reserved';
      PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'The giver cancelled',
        format('The giver cancelled your claim on "%s". Nothing was charged and you get no strike.', v_item.title),
        '/declutter?tab=buying', v_uid);
    ELSE
      UPDATE public.declutter_items SET status = 'live', updated_at = now()
       WHERE id = p_item_id AND status = 'reserved';
      PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'The giver cancelled',
        format('The giver cancelled your claim on "%s", so it went back up. Nothing was charged and you get no strike.', v_item.title),
        '/declutter/item/' || p_item_id::text, v_uid);
    END IF;
    RETURN public.declutter_active_strike_count(v_uid);
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
