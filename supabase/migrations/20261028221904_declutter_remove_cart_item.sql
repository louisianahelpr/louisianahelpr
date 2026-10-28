-- A buyer can take an item out of their cart (Declutter audit 2 B2-4 / lead A2-8, 2026-10-28).
--
-- BROKEN: no RPC removed a cart line. A reserved item stayed held for the whole 48 hours (the seller could not sell
-- it to anyone else), and a second "Buy now" from the same seller was forced into the same checkout as the first.
--
-- declutter_remove_cart_item(p_line_id) RETURNS text, 'removed' or 'already' (a repeat), behind 'declutter':
--   - only the caller's OWN line that is 'in_cart'; anyone else's line, or no line, is item_not_found (no oracle);
--     a line that is paid or already closed another way is not_in_cart;
--   - refused with checkout_open while the line's order has a Stripe page that can still be paid (awaiting_payment,
--     a session attached, created in the last 35 minutes: pages live 31, PAGE_LIFETIME_S in declutter-checkout).
--     Money safety does not rest on that check: the order is superseded below, and a payment on a superseded
--     order is refunded in full by declutter_mark_order_paid (the restarted-checkout path);
--   - releases the hold the way the deadline sweep's missed checkout does (20261014224914), WITHOUT the strike
--     (lead 2026-10-28, A2-8: letting it go early is the buyer giving the item back, not missing a deadline):
--     the line becomes 'removed' (new status, kept 30 days in declutter_my_cart like any closed line), the item goes
--     reserved -> live (reserved -> ended when the seller can no longer sell, as in the sweep), the line's
--     awaiting_payment order is superseded and its other lines are let go of it (order_id NULL) so the next checkout
--     starts a fresh order, and the seller is told the item is back on sale.
-- Lock order as everywhere in Declutter: items -> orders -> lines.
-- REVOKE FROM PUBLIC, anon; GRANT authenticated. Proof: src/test/pglite/declutterRemoveCartItem.pglite.mjs (3x).
-- REPLAY-SAFETY: the CHECK is dropped IF EXISTS and re-added with every earlier status; CREATE OR REPLACE.

ALTER TABLE public.declutter_cart_items DROP CONSTRAINT IF EXISTS declutter_cart_items_status_check;
ALTER TABLE public.declutter_cart_items ADD CONSTRAINT declutter_cart_items_status_check CHECK (status IN (
  'in_cart',             -- waiting for checkout (48 h, row 59)
  'paid',                -- its order is paid
  'missed',              -- deadline passed: buyer strike, item back on sale
  'cancelled_by_seller', -- seller backed out: seller strike
  'removed'              -- the buyer took it out of their cart (A2-8): no strike, item back on sale
));

CREATE OR REPLACE FUNCTION public.declutter_remove_cart_item(p_line_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item uuid;
  l record;
  o public.declutter_orders;  -- a row type, so o.id reads NULL when the line has no order
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT c.item_id INTO v_item FROM public.declutter_cart_items c WHERE c.id = p_line_id AND c.buyer_id = v_uid;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i WHERE i.id = v_item FOR UPDATE;
  SELECT c.*, i.title INTO l
    FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.id = p_line_id AND c.buyer_id = v_uid;
  IF l.order_id IS NOT NULL THEN
    SELECT x.* INTO o FROM public.declutter_orders x WHERE x.id = l.order_id FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.id = p_line_id FOR UPDATE;
  SELECT c.status INTO v_status FROM public.declutter_cart_items c WHERE c.id = p_line_id;
  IF v_status = 'removed' THEN
    RETURN 'already';
  END IF;
  IF v_status <> 'in_cart' THEN
    RAISE EXCEPTION 'not_in_cart' USING ERRCODE = '55000', HINT = 'This item is not in your cart any more.';
  END IF;
  IF o.id IS NOT NULL AND o.status = 'awaiting_payment' AND o.stripe_checkout_session_id IS NOT NULL
     AND o.created_at > now() - interval '35 minutes' THEN
    RAISE EXCEPTION 'checkout_open' USING ERRCODE = '55000',
      HINT = 'You opened checkout for this. Close the payment page, then try again in a few minutes.';
  END IF;

  UPDATE public.declutter_cart_items SET status = 'removed', closed_at = now()
   WHERE id = p_line_id AND status = 'in_cart';
  IF o.id IS NOT NULL AND o.status = 'awaiting_payment' THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = o.id AND status = 'awaiting_payment';
    UPDATE public.declutter_cart_items SET order_id = NULL
     WHERE order_id = o.id AND status = 'in_cart';
  END IF;
  IF public.declutter_seller_out(l.seller_id) THEN
    UPDATE public.declutter_items SET status = 'ended', updated_at = now() WHERE id = l.item_id AND status = 'reserved';
  ELSE
    UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = l.item_id AND status = 'reserved';
    PERFORM public.declutter_notify(l.seller_id, 'new_offers', 'Back on sale',
      format('The buyer let "%s" go before checking out. It''s back on sale.', l.title),
      '/declutter?tab=selling', v_uid);
  END IF;
  RETURN 'removed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_remove_cart_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_cart_item(uuid) TO authenticated, service_role;
