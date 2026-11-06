-- DECLUTTER TRADES, slice 4: the handover end of an accepted trade (OWNER-DECISIONS "Declutter trades"; lead brief
-- 11-06). An accepted trade is two $0 orders, one each way, each handed over the normal way. Slice 1's sweep ended a
-- trade only while the other side's line was still in the cart; this restates declutter_swap_sweep (the whole body,
-- slice 1's parts unchanged) so it also closes the cases slice 1 left 'accepted' for ever:
--
--   * One side checked out (its $0 order paid, not yet handed over) and the other side's line ended unfinished (its
--     48-hour pickup choice ran out, or its order was closed without a handover): the checked-out $0 order is closed
--     through the existing declutter_close_paid_order free branch with NO strike side (p_strike_side NULL: the side
--     that checked out is not at fault), so its item goes back up and both are told "Free pickup cancelled. Nothing
--     was charged." The trade is 'lapsed'. Any strike for the side at fault is its own close's (deadline sweep: none,
--     DA-12; a no-show report: as for any free pickup), never this sweep's.
--   * Both orders handed over: the trade is 'completed' (new status).
--   * One handed over and the other ended unfinished: nothing can be undone (the item changed hands), so the trade is
--     'lapsed' and nothing else moves.
--
-- MONEY: none. Only free orders (paid_with = 'free') are ever closed here; a card order is never touched.
-- AUTHZ: unchanged. The sweep stays SECURITY DEFINER, service_role only (re-stated below); no new member RPC.
-- Replay-safe: DROP CONSTRAINT IF EXISTS before ADD, CREATE OR REPLACE.
-- PROOF: src/test/pglite/declutterTradesHandover.pglite.mjs (NEW_MIGRATION=skip is red). For verdict: lh-authz-rls.

ALTER TABLE public.declutter_swap_offers DROP CONSTRAINT IF EXISTS declutter_swap_offers_status_check;
ALTER TABLE public.declutter_swap_offers ADD CONSTRAINT declutter_swap_offers_status_check CHECK (status IN (
  'open',       -- waiting for the seller
  'accepted',   -- both items reserved, each side choosing a pickup and handing over
  'declined',   -- the seller said no
  'expired',    -- 48 hours with no answer
  'withdrawn',  -- the buyer took it back
  'voided',     -- one of the two items was sold, removed or hidden meanwhile
  'lapsed',     -- accepted, but one side's pickup or handover did not happen
  'completed'   -- both items handed over (slice 4)
));

CREATE OR REPLACE FUNCTION public.declutter_swap_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_expired integer := 0;
  v_lapsed integer := 0;
  v_line record;
  v_keep uuid;
  v_keep_n integer := 0;
  v_closed integer := 0;
  v_done integer := 0;
BEGIN
  FOR r IN
    UPDATE public.declutter_swap_offers s SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE s.status = 'open' AND s.respond_by <= now()
    RETURNING s.id, s.buyer_id, s.seller_id, s.item_id,
      (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id) AS title
  LOOP
    v_expired := v_expired + 1;
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Trade offer expired',
      format('The seller did not answer your trade offer for "%s" within 48 hours, so it closed. Nothing changed hands.', coalesce(r.title, 'an item')),
      '/declutter/item/' || r.item_id::text, r.seller_id);
  END LOOP;

  -- Lapse: one line no longer waiting or picked up (missed, cancelled), the other still in the cart.
  FOR r IN
    SELECT s.id, s.buyer_id, s.seller_id, s.buyer_line_id, s.seller_line_id
      FROM public.declutter_swap_offers s
      JOIN public.declutter_cart_items b ON b.id = s.buyer_line_id
      JOIN public.declutter_cart_items l ON l.id = s.seller_line_id
     WHERE s.status = 'accepted'
       AND ((b.status NOT IN ('in_cart', 'paid') AND l.status = 'in_cart')
         OR (l.status NOT IN ('in_cart', 'paid') AND b.status = 'in_cart'))
  LOOP
    SELECT c.id INTO v_keep FROM public.declutter_cart_items c
     WHERE c.id IN (r.buyer_line_id, r.seller_line_id) AND c.status = 'in_cart';
    SELECT c.*, i.title INTO v_line FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.id = v_keep;
    PERFORM 1 FROM public.declutter_items i WHERE i.id = v_line.item_id FOR UPDATE;
    UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now() WHERE id = v_keep AND status = 'in_cart';
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = v_line.item_id AND status = 'reserved';
    PERFORM public.declutter_reopen_voided_offers(v_keep);
    UPDATE public.declutter_swap_offers SET status = 'lapsed', updated_at = now() WHERE id = r.id AND status = 'accepted';
    v_lapsed := v_lapsed + 1;
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_sales', 'Trade ended, no strike',
      'A pickup wasn''t chosen in time, so the trade ended and both items are back up. Nobody gets a strike.',
      '/declutter?tab=buying', r.seller_id);
    PERFORM public.declutter_notify(r.seller_id, 'declutter_sales', 'Trade ended, no strike',
      'A pickup wasn''t chosen in time, so the trade ended and both items are back up. Nobody gets a strike.',
      '/declutter?tab=selling', r.buyer_id);
  END LOOP;

  -- CHANGED (slice 4): one side checked out (its free order paid, not handed over) and the other side's line ended
  -- unfinished. The checked-out free order closes with NO strike side; its item goes back up (close_paid_order's free
  -- branch, which also tells both sides). Only a free order is ever closed here.
  FOR r IN
    SELECT s.id, o.id AS order_id
      FROM public.declutter_swap_offers s
      JOIN public.declutter_cart_items k ON k.id IN (s.buyer_line_id, s.seller_line_id) AND k.status = 'paid'
      JOIN public.declutter_orders o ON o.id = k.order_id AND o.status = 'paid' AND o.paid_with = 'free'
      JOIN public.declutter_cart_items x ON x.id IN (s.buyer_line_id, s.seller_line_id) AND x.id <> k.id
     WHERE s.status = 'accepted'
       AND x.status NOT IN ('in_cart', 'paid')
  LOOP
    PERFORM 1 FROM public.declutter_swap_offers s WHERE s.id = r.id AND s.status = 'accepted' FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM public.declutter_close_paid_order(r.order_id, 'trade_lapsed', NULL, NULL, NULL);
    UPDATE public.declutter_swap_offers SET status = 'lapsed', updated_at = now() WHERE id = r.id AND status = 'accepted';
    v_closed := v_closed + 1;
  END LOOP;

  -- CHANGED (slice 4): both orders handed over: the trade is done.
  UPDATE public.declutter_swap_offers s SET status = 'completed', updated_at = now()
   WHERE s.status = 'accepted'
     AND (SELECT count(*) FROM public.declutter_cart_items c JOIN public.declutter_orders o ON o.id = c.order_id
           WHERE c.id IN (s.buyer_line_id, s.seller_line_id) AND c.status = 'paid' AND o.status = 'handed_over') = 2;
  GET DIAGNOSTICS v_done = ROW_COUNT;

  -- Both sides ended unfinished, or (CHANGED, slice 4) one ended unfinished after the other was already handed over
  -- (nothing to undo): the trade is over. A side still in the cart, or checked out and not yet handed over, waits for
  -- the loops above.
  UPDATE public.declutter_swap_offers s SET status = 'lapsed', updated_at = now()
   WHERE s.status = 'accepted'
     AND EXISTS (SELECT 1 FROM public.declutter_cart_items c
                  WHERE c.id IN (s.buyer_line_id, s.seller_line_id) AND c.status NOT IN ('in_cart', 'paid'))
     AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c LEFT JOIN public.declutter_orders o ON o.id = c.order_id
                      WHERE c.id IN (s.buyer_line_id, s.seller_line_id)
                        AND (c.status = 'in_cart' OR (c.status = 'paid' AND o.status IS DISTINCT FROM 'handed_over')));
  GET DIAGNOSTICS v_keep_n = ROW_COUNT;
  RETURN jsonb_build_object('expired', v_expired, 'lapsed', v_lapsed + v_closed + v_keep_n, 'completed', v_done);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_swap_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_swap_sweep() TO service_role;
