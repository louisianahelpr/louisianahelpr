-- Payout try count restarts when a payout is put back in the queue (B21/B24 10-31, lead + reviewer: both
-- set a Declutter payout back to 'pending' without resetting attempts; the Shops line already does).
-- The payout run only offers rows with attempts < 12 (declutter_payouts_due, helpr_task_payouts_due). A payout that
-- used its 12 tries and is then
--   * rebooked after a refund (declutter_rebook_payout), or
--   * held for review and released by an admin (admin_payout_release, kinds 'declutter' and 'helpr_task'),
-- went back to 'pending' with attempts still 12: nothing would ever send it, and the seller's card said we
-- "stopped trying" (78fbee9ad0) on a payout an admin had just released.
-- Now both start a fresh run: attempts = 0, next_attempt_at = now(), copying the Shops release line
-- (20261019112103:158). Sending stays safe: before any transfer the run lists the order's transfer group and
-- adopts a transfer already made (declutter-money/index.ts), and each send is keyed on the row id.
-- Restated from the NEWEST CREATE of each (checked against origin/main 10-31):
--   declutter_rebook_payout  20261027153244_declutter_seller_delivery.sql:1883 (newer than 20261026155251)
--   admin_payout_release     20261019112103_shops_held_for_review_admin_tools.sql:81
-- Nothing else in either body changes. The refund kinds are left as they are (their Stripe key comes from the
-- refunds Stripe already holds, not the try count; a separate call).
-- Replay-safe (OR REPLACE); grants as before. Proof: src/test/pglite/declutterPayoutTriesRestart.pglite.mjs.

CREATE OR REPLACE FUNCTION public.declutter_rebook_payout(p_order_id uuid, p_refunded_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.declutter_payouts;
  v_ref text := 'declutter_order_' || p_order_id::text;
  v_debt integer;
BEGIN
  SELECT * INTO p FROM public.declutter_payouts WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_missing' USING ERRCODE = 'P0002';
  END IF;
  IF p_refunded_cents IS NULL OR p_refunded_cents < 0 OR p_refunded_cents > p.items_cents + p.delivery_cents THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF NOT public.declutter_payout_unsent(p_order_id) THEN
    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000';
  END IF;
  IF p.seller_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('declutter_fee_debt:' || p.seller_id::text, 0));
    UPDATE public.declutter_seller_fee_debts d
       SET remaining_cents = d.remaining_cents + x.deducted_cents
      FROM public.declutter_fee_debt_deductions x
     WHERE x.debt_id = d.id AND x.payout_ref = v_ref AND d.seller_id = p.seller_id;
    DELETE FROM public.declutter_fee_debt_deductions x
     USING public.declutter_seller_fee_debts d
     WHERE x.debt_id = d.id AND x.payout_ref = v_ref AND d.seller_id = p.seller_id;
    v_debt := public.declutter_consume_fee_debt(p.seller_id, v_ref, p.items_cents + p.delivery_cents - p_refunded_cents);
  ELSE
    -- The seller's account is gone: nothing can be put back to them.
    v_debt := least(p.debt_cents, p.items_cents + p.delivery_cents - p_refunded_cents);
  END IF;
  UPDATE public.declutter_payouts
     SET refunded_cents = p_refunded_cents, debt_cents = v_debt,
         amount_cents = items_cents + delivery_cents - p_refunded_cents - v_debt,
         status = CASE WHEN items_cents + delivery_cents - p_refunded_cents - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
         -- A rebooked payout starts a fresh run of tries (B24, 10-31): one rebooked after its last try would
         -- otherwise sit 'pending' forever (declutter_payouts_due takes attempts < 12).
         attempts = 0, next_attempt_at = now()
   WHERE id = p.id;
  RETURN p.items_cents + p.delivery_cents - p_refunded_cents - v_debt;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_rebook_payout(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_rebook_payout(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_payout_release(p_kind text, p_id uuid, p_note text, p_confirm_no_transfer boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  v_status text;
  v_order uuid;
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  IF p_confirm_no_transfer IS NOT TRUE THEN
    RAISE EXCEPTION 'confirm_no_transfer_required' USING ERRCODE = '22023',
      HINT = 'Confirm you checked Stripe and no transfer or refund was made for this row outside the app.';
  END IF;
  -- Shops: the order row lock first (one lock order for every Shops money path: the order,
  -- then its refund / payout rows, then hand-refund rows).
  IF p_kind = 'shop' THEN
    SELECT order_id INTO v_order FROM public.shop_payouts WHERE id = p_id;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT order_id INTO v_order FROM public.shop_refunds WHERE id = p_id;
  END IF;
  IF v_order IS NOT NULL THEN
    SELECT * INTO o FROM public.shop_orders WHERE id = v_order FOR UPDATE;
  END IF;
  IF p_kind = 'declutter' THEN
    SELECT status INTO v_status FROM public.declutter_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'helpr_task' THEN
    SELECT status INTO v_status FROM public.helpr_task_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop' THEN
    SELECT status INTO v_status FROM public.shop_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_refund' THEN
    SELECT status INTO v_status FROM public.declutter_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'delivery_refund' THEN
    SELECT status INTO v_status FROM public.declutter_delivery_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT status INTO v_status FROM public.shop_refunds WHERE id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF v_status IS DISTINCT FROM 'held_for_review' THEN
    RAISE EXCEPTION 'not_held_for_review' USING ERRCODE = '55000';
  END IF;
  -- Shops: a release the queue would never send is refused, so nothing sits 'pending' forever.
  -- While a refund made in Stripe that the app has not accounted for stands on the order
  -- (shop_order_unaccounted_hand_refund: every Shops queue skips it), or the order was closed by
  -- one, the row STAYS held and the admin decides it by hand.
  IF p_kind IN ('shop', 'shop_refund') THEN
    IF public.shop_order_unaccounted_hand_refund(v_order) OR (p_kind = 'shop' AND o.close_reason = 'refunded_by_hand') THEN
      RAISE EXCEPTION 'refunded_in_stripe' USING ERRCODE = '55000',
        HINT = 'A refund made in Stripe stands on this order, so this stays held. Settle it by hand once you have decided.';
    END IF;
    IF p_kind = 'shop' AND NOT (
         (o.status = 'handed_over' OR (o.status = 'cancelled' AND o.close_reason IN ('buyer_cancelled_late', 'buyer_no_show')))
         AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = v_order AND h.problem_at IS NOT NULL
                           AND h.confirmed_how IS DISTINCT FROM 'admin')) THEN
      RAISE EXCEPTION 'shop_payout_not_due' USING ERRCODE = '55000',
        HINT = 'The shop is not paid for this order automatically (open problem, or not handed over). Settle it by hand.';
    END IF;
  END IF;
  IF p_kind = 'declutter' THEN
    -- A released Declutter payout starts a fresh run of tries, as a Shops one does (B24, 10-31): one held on its
    -- last try would otherwise never be offered again (declutter_payouts_due takes attempts < 12). No double pay:
    -- the run lists the order's transfer group before any send and keys the send on the row id.
    UPDATE public.declutter_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0, review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'helpr_task' THEN
    -- The same for a Helpr's delivery pay (its run also lists the transfer group before any send).
    UPDATE public.helpr_task_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0, review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'shop' THEN
    -- A released Shops row starts a fresh run of tries (run-3 review #4): one held on its last
    -- try would otherwise never be offered again (the queues take attempts < 12).
    UPDATE public.shop_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0, review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'shop_refund' THEN
    -- Fresh tries AND a fresh run of idempotency keys (shop-refund-<id>-v<reversals>[-r<n>], as
    -- shop_refund_reversed does): resetting attempts alone would rebuild a key already used, and Stripe
    -- would replay its stored answer (run-3 review M1).
    UPDATE public.shop_refunds SET status = 'pending', next_attempt_at = now(), attempts = 0, reversals = least(reversals + 1, 100),
           review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.payout_payee_waits WHERE payout_kind = p_kind AND payout_id = p_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'admin_payout_release', p_kind, p_id::text, jsonb_build_object('note', v_note, 'confirmed_no_transfer', true));
  RETURN jsonb_build_object('result', 'released', 'kind', p_kind, 'id', p_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) TO authenticated, service_role;
