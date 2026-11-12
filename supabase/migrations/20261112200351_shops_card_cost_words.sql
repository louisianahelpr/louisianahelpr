-- Shops: the last two server notices that said "card fee" (S010 leftover from Builder 3's Shops UI lane, F089 / no-fee-words
-- rule OWNER-DECISIONS 10-25, F255): the shop's notice now says "card processing cost" with no number, the words the
-- shop's cancel dialog already uses (ShopOrderCancel). Nothing else changes: the same refund row, the same fee debt,
-- the same strike, the same buyer notice.
--   shop_refund_sweep       restated VERBATIM from 20261108184654 (newest) except the no-ready-photo shop notice.
--   shops_shop_cancel_order restated VERBATIM from 20261103162420 (newest) except the shop's own notice.
-- MONEY: none (words only; no amount, row or ledger change). AUTHZ: none new (grants restated as before).
-- REPLAY-SAFE: CREATE OR REPLACE; REVOKE/GRANT idempotent.
-- Proof: src/test/pglite/shopsCardCostWords.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.shop_refund_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c record;
  o public.shop_orders;
  r public.shop_refunds;
  a record;
  v_done integer := 0;
BEGIN
  FOR c IN
    SELECT so.id FROM public.shop_orders so
      LEFT JOIN public.shop_handovers h ON h.order_id = so.id
     WHERE so.status = 'accepted' AND so.captured_at IS NOT NULL AND so.handover_mode = 'porch'
       -- Preorders (20261108184654) run on their own clock: 7 days after ready-by (shop_preorder_sweep).
       AND so.preorder_item_id IS NULL
       AND h.ready_photo_path IS NULL AND h.problem_at IS NULL
       AND ((so.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '3 days' <= now()
     ORDER BY so.ready_date, so.id LIMIT 100
  LOOP
    BEGIN
      o := public.shop_lock_open_charged_order(c.id, false);
      -- Re-read under the lock: a photo posted since the scan wins.
      IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_photo_path IS NOT NULL) THEN
        CONTINUE;
      END IF;
      UPDATE public.shop_orders SET status = 'refunded', close_reason = 'no_ready_photo', closed_at = now()
       WHERE id = o.id AND status = 'accepted';
      r := public.shop_write_refund(o.id, 'no_ready_photo', NULL);
      PERFORM public.shop_give_strike(o.seller_id, 'shop', 'no_ready_photo', o.id);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order refunded',
        format('The shop never marked your order for %s ready, so all $%s is on its way back to your card.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00')),
        '/shops/orders', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order refunded',
        -- CHANGED (S010 leftover, F089 plain words, no number): "card processing cost", never "card fee".
        format('You never posted the ready photo for the order for %s, so the buyer was refunded in full. The card processing cost comes out of your next payout, and it counts as a Shops strike.',
               to_char(o.ready_date, 'FMMonth FMDD')),
        '/shops/dashboard', o.buyer_id);
      -- Test stuff never reaches an admin (owner 2026-10-30): a cron has no
      -- signed-in member and the link is bare '/admin', so the skip is here.
      IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
        FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
          PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops order refunded by the clock',
            'A left-out Shops order had no ready photo 3 days after its date, so the buyer was refunded and the shop got a strike.', '/admin');
        END LOOP;
      END IF;
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_refund_sweep', c.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('no_ready_photo_refunded', v_done);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.shops_shop_cancel_order(p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  r public.shop_refunds;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_leak text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023', HINT = 'Keep the reason under 200 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_reason);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the reason. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.shop_lock_open_charged_order(o.id, false);
  UPDATE public.shop_orders SET status = 'refunded', close_reason = 'shop_cancelled', decline_reason = v_reason, closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  r := public.shop_write_refund(o.id, 'shop_cancelled', v_reason);
  PERFORM public.shop_return_stock(o.id);
  PERFORM public.shop_give_strike(o.seller_id, 'shop', 'shop_cancelled', o.id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order cancelled by the shop',
    format('The shop cancelled your order for %s. All $%s is on its way back to your card; card refunds usually show up in 5 to 10 business days.',
           to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00'))
      || CASE WHEN v_reason IS NOT NULL THEN ' Their note: ' || v_reason ELSE '' END,
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order cancelled',
    -- CHANGED (S010 leftover, F089 plain words, no number): the same words as the shop's cancel dialog.
    'You cancelled an accepted order. The buyer gets everything back, the card processing cost comes out of your next payout, and it counts as a Shops strike.',
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'cancelled', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_shop_cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_shop_cancel_order(uuid, text) TO authenticated, service_role;
