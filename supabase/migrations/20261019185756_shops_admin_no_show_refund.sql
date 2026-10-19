-- Shops: an admin refunds a DISPUTED no-show, taken from the shop's payout
-- (owner answers 2026-10-19 ~19Z: "Shops admin no-show refund (from shop payout)").
--
-- A no-show (shops_report_no_show, 20261019071055 section 7) closes the order
-- 'cancelled' / 'buyer_no_show', pays the shop its items (shop_owe_shop: one
-- shop_payouts row, the shop's card-fee debt taken out first) and gives the
-- buyer a strike. When the buyer disputes it and support agrees, an admin now
-- refunds the buyer through the existing Shops refund machinery:
--   - the refund row is shop_write_refund's (one per order, ever; reason ->
--     fee_policy -> amounts are the table CHECKs). Only two reasons:
--       problem_shop_fault  full refund, the shop pays the card fee, shop strike;
--       problem_no_fault    price back, the card fee and its tax kept (J3).
--     Never problem_our_mistake: the platform never absorbs a fee here.
--     declutter-money sends it (shop_refunds_due, key shop-refund-<id>) within 10 minutes.
--   - the shop gives back what it was paid for the order, exact cents, from its
--     payouts (the one fee-debt ledger, owner "fee debt only from payouts"):
--       payout NOT sent yet (pending / failed / held_for_review, no send started):
--         it is cancelled; the shop owes back only debt_cents (the earlier debts that
--         payout had paid off come back);
--       payout sent (succeeded / settled_by_hand) or nothing_due: the shop owes back
--         items_cents (the cash it got + the debts it paid off with it);
--       a send has started (payout_send_marks): refused, try again later (the
--         transfer may exist and is reconciled first).
--     The clawback is added to the refund's own debt row (UNIQUE shop_refund_id), so
--     with problem_shop_fault ONE row holds card fee + clawback.
--   - a transfer that still goes out for a payout cancelled here (the money job read
--     the row before the cancel) is recorded, not lost: shop_payout_executed records
--     it as succeeded and adds the amount sent to that same debt row.
--   - the buyer's no-show strike is removed (support agreed it was not a no-show).
--   - the order closes 'refunded' / 'admin_refunded' (as every admin refund), so it
--     leaves the marketplace-facilitator count (facilitated_la_sales_cents counts a
--     no-show only while it stands).
-- Lock order as everywhere in Shops: the order row, then payout / refund rows.
-- Admin only (has_role); audited; needs no switch (an admin can unwind money with
-- Shops off, L91). Replay-safe (constraint swap in a DO block, OR REPLACE).
-- Applied 3x by src/test/pglite/shopsRefunds.pglite.mjs.

DO $do$
BEGIN
  ALTER TABLE public.shop_payouts DROP CONSTRAINT IF EXISTS shop_payouts_status_check;
  ALTER TABLE public.shop_payouts ADD CONSTRAINT shop_payouts_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand', 'cancelled'));
END
$do$;

-- The no-shows of the last 60 days an admin can still refund (Admin > Shops Orders).
CREATE OR REPLACE FUNCTION public.shops_admin_no_shows()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.has_role((SELECT auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(x ORDER BY x.closed_at DESC), '[]'::jsonb) FROM (
    SELECT o.id AS order_id, o.buyer_id, o.seller_id, s.name AS shop_name, o.ready_date, o.closed_at,
           o.items_cents, o.total_cents, p.status AS payout_status, p.amount_cents AS payout_cents, o.is_seed
      FROM public.shop_orders o
      LEFT JOIN public.shops s ON s.id = o.shop_id
      LEFT JOIN public.shop_payouts p ON p.order_id = o.id
     WHERE o.status = 'cancelled' AND o.close_reason = 'buyer_no_show'
       AND o.closed_at > now() - interval '60 days'
       AND NOT EXISTS (SELECT 1 FROM public.shop_refunds r WHERE r.order_id = o.id)
     ORDER BY o.closed_at DESC LIMIT 200) x);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_no_shows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_no_shows() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_admin_refund_no_show(p_order_id uuid, p_reason text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  o public.shop_orders;
  p public.shop_payouts;
  r public.shop_refunds;
  v_clawback integer := 0;
  v_payout text;
  v_strikes integer;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('problem_shop_fault', 'problem_no_fault') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status IS DISTINCT FROM 'cancelled' OR o.close_reason IS DISTINCT FROM 'buyer_no_show' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'not_a_no_show' USING ERRCODE = '55000', HINT = 'Only an order closed as a no-show can be refunded here.';
  END IF;
  -- A refund made by hand in Stripe stands: decide it in Payouts held for review first.
  IF public.shop_order_unaccounted_hand_refund(o.id) THEN
    RAISE EXCEPTION 'refunded_in_stripe' USING ERRCODE = '55000',
      HINT = 'This order was refunded in Stripe. Decide it in Payouts held for review.';
  END IF;
  SELECT * INTO p FROM public.shop_payouts WHERE order_id = o.id FOR UPDATE;
  IF p.id IS NOT NULL THEN
    IF p.status IN ('pending', 'failed', 'held_for_review') THEN
      IF EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'shop' AND m.payout_id = p.id) THEN
        RAISE EXCEPTION 'payout_sending' USING ERRCODE = '55000',
          HINT = 'The shop''s payout for this order may be going out right now. Try again in 15 minutes.';
      END IF;
      UPDATE public.shop_payouts
         SET status = 'cancelled', review_reason = 'no_show_refunded: the buyer was refunded; this payout is not sent',
             review_held_at = NULL, last_error = NULL
       WHERE id = p.id;
      DELETE FROM public.payout_payee_waits WHERE payout_kind = 'shop' AND payout_id = p.id;
      v_clawback := p.debt_cents;
      v_payout := 'cancelled';
    ELSE
      -- succeeded / settled_by_hand: the shop has the cash and its debts were paid off with it;
      -- nothing_due: the whole price paid off its debts.
      v_clawback := p.items_cents;
      v_payout := p.status;
    END IF;
  END IF;
  UPDATE public.shop_orders SET status = 'refunded', close_reason = 'admin_refunded', closed_at = now()
   WHERE id = o.id AND status = 'cancelled';
  r := public.shop_write_refund(o.id, p_reason, v_note);
  IF v_clawback > 0 AND o.seller_id IS NOT NULL THEN
    INSERT INTO public.declutter_seller_fee_debts AS d (seller_id, shop_refund_id, amount_cents, remaining_cents, is_seed)
    VALUES (o.seller_id, r.id, v_clawback, v_clawback, o.is_seed)
    ON CONFLICT (shop_refund_id) DO UPDATE
      SET amount_cents = d.amount_cents + EXCLUDED.amount_cents, remaining_cents = d.remaining_cents + EXCLUDED.remaining_cents;
  END IF;
  UPDATE public.shop_strikes SET removed_at = now(), removed_by = v_uid,
         removed_note = left('No-show refunded by Louisiana Helpr: ' || v_note, 500)
   WHERE order_id = o.id AND user_id = o.buyer_id AND offender_side = 'buyer' AND reason = 'buyer_no_show' AND removed_at IS NULL;
  GET DIAGNOSTICS v_strikes = ROW_COUNT;
  IF p_reason = 'problem_shop_fault' THEN
    PERFORM public.shop_give_strike(o.seller_id, 'shop', 'problem_shop_fault', o.id);
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shops_admin_refund_no_show', 'shop_order', o.id::text,
          jsonb_build_object('reason', p_reason, 'note', v_note, 'refund_cents', r.refund_cents, 'refund_id', r.id,
                             'payout', v_payout, 'clawback_cents', v_clawback, 'buyer_strikes_removed', v_strikes));
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order refunded',
    format('Louisiana Helpr reviewed the missed pickup for %s and refunded you: $%s is on its way back to your card%s. The missed-pickup strike is removed. Card refunds usually show up in 5 to 10 business days.',
           to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00'),
           CASE WHEN r.kept_cents > 0 THEN ', less the card-processing cost' || CASE WHEN r.tax_kept_cents > 0 THEN ' and the sales tax on it' ELSE '' END ELSE '' END),
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'No-show refunded',
    format('Louisiana Helpr reviewed the no-show for %s and refunded the buyer.', to_char(o.ready_date, 'FMMonth FMDD'))
      || CASE WHEN v_payout = 'cancelled' THEN ' The payout for this order is not sent.' ELSE '' END
      || CASE WHEN v_clawback > 0 OR r.fee_policy = 'full_shop_pays_fee'
              THEN format(' $%s comes out of your next payouts.',
                          to_char((v_clawback + CASE WHEN r.fee_policy = 'full_shop_pays_fee' THEN r.card_fee_cents ELSE 0 END) / 100.0, 'FM999999990.00'))
              ELSE '' END
      || CASE WHEN p_reason = 'problem_shop_fault' THEN ' It counts as a Shops strike.' ELSE '' END,
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'refunded', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents,
                            'payout', v_payout, 'clawback_cents', v_clawback);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_refund_no_show(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_refund_no_show(uuid, text, text) TO authenticated, service_role;

-- Restated from 20261018211820 with ONE change: a transfer that went out for a payout
-- cancelled by a no-show refund (the money job read the row before the cancel) is
-- recorded as sent, and what it sent is added to that refund's debt row: never lost,
-- never paid twice (the shop then owes back items_cents in all, as for a payout sent
-- before the refund).
CREATE OR REPLACE FUNCTION public.shop_payout_executed(p_payout_id uuid, p_transfer_id text, p_succeeded boolean, p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
  p public.shop_payouts;
  o public.shop_orders;
  v_refund uuid;
BEGIN
  IF p_succeeded AND (p_transfer_id IS NULL OR p_transfer_id !~ '^tr_') THEN
    RAISE EXCEPTION 'invalid_transfer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_payouts
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_transfer_id = CASE WHEN p_succeeded THEN p_transfer_id ELSE stripe_transfer_id END,
         executed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_payout_id AND status IN ('pending', 'failed')
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT * INTO p FROM public.shop_payouts WHERE id = p_payout_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF p_succeeded AND p.status = 'cancelled' THEN
      -- Order row first, then the payout (the Shops lock order).
      SELECT * INTO o FROM public.shop_orders WHERE id = p.order_id FOR UPDATE;
      SELECT * INTO p FROM public.shop_payouts WHERE id = p_payout_id FOR UPDATE;
      IF p.status = 'cancelled' THEN
        UPDATE public.shop_payouts SET status = 'succeeded', stripe_transfer_id = p_transfer_id, executed_at = now(),
               review_reason = left('sent after the no-show refund cancelled it; the amount is owed back: ' || COALESCE(p.review_reason, ''), 300)
         WHERE id = p.id;
        SELECT r.id INTO v_refund FROM public.shop_refunds r WHERE r.order_id = p.order_id;
        IF v_refund IS NOT NULL AND p.amount_cents > 0 AND o.seller_id IS NOT NULL THEN
          INSERT INTO public.declutter_seller_fee_debts AS d (seller_id, shop_refund_id, amount_cents, remaining_cents, is_seed)
          VALUES (o.seller_id, v_refund, p.amount_cents, p.amount_cents, o.is_seed)
          ON CONFLICT (shop_refund_id) DO UPDATE
            SET amount_cents = d.amount_cents + EXCLUDED.amount_cents, remaining_cents = d.remaining_cents + EXCLUDED.remaining_cents;
        END IF;
        RETURN 'succeeded';
      END IF;
    END IF;
    v_status := p.status;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_payout_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_payout_executed(uuid, text, boolean, text) TO service_role;

-- Q807: no new table (shop_payouts gains a status only).
