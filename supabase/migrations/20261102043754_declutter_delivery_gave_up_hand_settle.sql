-- Q1931 parts 2 and 3: Declutter delivery money that gave up after 12 tries can be settled by hand.
--
-- What was broken: a Helpr's delivery pay (helpr_task_payouts) or a delivery-fee refund (declutter_delivery_refunds)
-- that used its 12 tries stays 'failed' for good. declutter_delivery_gave_up_check (20261102033730) raises it daily
-- and tells ops to send it by hand in Stripe, but nothing could RECORD that: admin_payout_settle_by_hand took only
-- 'held_for_review' rows, and Payouts held for review listed only those. So
--   (2) a delivery-fee refund sent by hand was never recorded, declutter_order_refunds_recorded_cents never counted
--       it, and a seller or Helpr payout on the same charge gave up as "not whole"; and
--   (3) a gave-up Helpr payout stayed 'failed' forever, which blocks the Helpr's account deletion forever
--       (accountPurge counts a 'failed' payout as money still owed, by design: Q2273).
--
-- The fix (both functions restated verbatim from 20261019112103, changes marked Q1931):
--   * admin_payouts_held_for_review also lists a gave-up row ('failed', attempts >= 12) of those two kinds, with
--     reason 'gave_up: <last error>' and gave_up = true (the card then offers only "Mark settled by hand").
--   * admin_payout_settle_by_hand also settles such a row (same checks, same ledger, same audit log). A settled
--     delivery-fee refund with its re_ id is 'succeeded', so the recorded-refunds sum counts it; a settled Helpr
--     payout leaves 'failed', so it no longer blocks the account deletion (the money was paid).
--   * "Release to automatic" still takes only held rows (a gave-up row is not re-queued here).
-- Not in this migration: a gave-up delivery pay-raise refund (declutter_delivery_raises 'refunding') has no hand
-- settle kind yet. Whether a Helpr may delete the account while gave-up pay is still unpaid is a money question for
-- the lead (left as it is: blocked until settled).
--
-- Replay-safe: CREATE OR REPLACE, REVOKE/GRANT as before. No money moves.
-- Proof: src/test/pglite/declutterDeliveryGaveUpHandSettle.pglite.mjs.

CREATE OR REPLACE FUNCTION public.admin_payouts_held_for_review()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(held.h || jsonb_build_object(
      'payee_account', (SELECT pr.stripe_account_id FROM public.profiles pr WHERE pr.user_id = (held.h ->> 'payee_id')::uuid),
      'sibling_refs', (SELECT COALESCE(jsonb_agg(to_jsonb(sb) ORDER BY sb.ref), '[]'::jsonb) FROM (
          SELECT 'declutter' AS kind, x.id, x.stripe_transfer_id AS ref, x.amount_cents FROM public.declutter_payouts x
           WHERE x.seller_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'helpr_task', x.id, x.stripe_transfer_id, x.amount_cents FROM public.helpr_task_payouts x
           WHERE x.helpr_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'shop', x.id, x.stripe_transfer_id, x.amount_cents FROM public.shop_payouts x JOIN public.shop_orders so ON so.id = x.order_id
           WHERE so.seller_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          LIMIT 20) sb))
    ORDER BY held.h ->> 'held_at'), '[]'::jsonb) FROM (
    SELECT to_jsonb(x) AS h FROM (
      SELECT 'declutter' AS kind, p.id, p.seller_id AS payee_id, p.amount_cents, p.review_reason AS reason, p.review_held_at AS held_at,
             'declutter_order_' || p.order_id::text AS stripe_group, false AS gave_up
        FROM public.declutter_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      -- The REAL transfer group a Helpr's delivery payout is sent in: its Declutter order's.
      SELECT 'helpr_task', p.id, p.helpr_id, p.amount_cents, p.review_reason, p.review_held_at,
             CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || t.source_id::text END, false
        FROM public.helpr_task_payouts p LEFT JOIN public.helpr_tasks t ON t.id = p.task_id WHERE p.status = 'held_for_review'
      UNION ALL
      -- Q1931: a Helpr's delivery pay that used its 12 tries (helpr_task_payouts_due takes attempts < 12): it is
      -- sent by hand in Stripe and recorded here, or it stays 'failed' (and blocks the Helpr's deletion) for good.
      SELECT 'helpr_task', p.id, p.helpr_id, p.amount_cents, 'gave_up: ' || COALESCE(p.last_error, 'no error recorded'), p.created_at,
             CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || t.source_id::text END, true
        FROM public.helpr_task_payouts p LEFT JOIN public.helpr_tasks t ON t.id = p.task_id
       WHERE p.status = 'failed' AND p.attempts >= 12
      UNION ALL
      SELECT 'shop', p.id, o.seller_id, p.amount_cents, p.review_reason, p.review_held_at, 'shop_order_' || p.order_id::text, false
        FROM public.shop_payouts p JOIN public.shop_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'declutter_refund', r.id, o.buyer_id, r.refund_cents, r.review_reason, r.review_held_at, r.stripe_payment_intent_id, false
        FROM public.declutter_refunds r LEFT JOIN public.declutter_orders o ON o.id = r.order_id WHERE r.status = 'held_for_review'
      UNION ALL
      SELECT 'delivery_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.review_held_at, d.stripe_payment_intent_id, false
        FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
      UNION ALL
      -- Q1931: a delivery-fee refund that used its 12 tries (declutter_delivery_refunds_due takes attempts < 12).
      SELECT 'delivery_refund', d.id, o.buyer_id, d.refund_cents, 'gave_up: ' || COALESCE(d.last_error, 'no error recorded'), d.created_at,
             d.stripe_payment_intent_id, true
        FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id
       WHERE d.status = 'failed' AND d.attempts >= 12
      UNION ALL
      -- Shops: an app refund held because a refund made in Stripe stands on its order.
      SELECT 'shop_refund', r.id, o.buyer_id, r.refund_cents, r.review_reason, r.review_held_at, r.stripe_payment_intent_id, false
        FROM public.shop_refunds r JOIN public.shop_orders o ON o.id = r.order_id WHERE r.status = 'held_for_review'
    ) x) held);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payouts_held_for_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payouts_held_for_review() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_payout_settle_by_hand(p_kind text, p_id uuid, p_ref text, p_amount_cents integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_stripe text;
  v_other text;
  v_status text;
  v_pi text;
  v_adopted boolean := false;
  v_payout boolean := p_kind IN ('declutter', 'helpr_task', 'shop');
  v_succeeded boolean;
  v_refund_cents integer;
  v_order uuid;
  v_attempts integer;
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say how it was settled, in under 500 characters.';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023', HINT = 'Enter the amount it was settled for.';
  END IF;
  IF v_ref ~* '^other:' THEN
    v_other := left(btrim(regexp_replace(v_ref, '^other:', '', 'i')), 300);
    IF char_length(v_other) < 3 THEN
      RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023', HINT = 'Say how it was paid outside Stripe, after "other:".';
    END IF;
  ELSIF (v_payout AND v_ref ~ '^(tr|po)_[A-Za-z0-9]+$') OR (NOT v_payout AND v_ref ~ '^(re|pyr)_[A-Za-z0-9]+$') THEN
    v_stripe := v_ref;
  ELSE
    RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023',
      HINT = 'A Stripe transfer / payout id (tr_..., po_...) for a payout, a refund id (re_...) for a refund, or "other: how it was paid".';
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
    SELECT status, attempts INTO v_status, v_attempts FROM public.helpr_task_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop' THEN
    SELECT status INTO v_status FROM public.shop_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_refund' THEN
    SELECT status, refund_cents INTO v_status, v_refund_cents FROM public.declutter_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'delivery_refund' THEN
    SELECT status, refund_cents, attempts INTO v_status, v_refund_cents, v_attempts FROM public.declutter_delivery_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT status, refund_cents INTO v_status, v_refund_cents FROM public.shop_refunds WHERE id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  -- Q1931: a Declutter delivery row that used its 12 tries ('failed', attempts >= 12: no queue offers it again)
  -- is settled here too; a row still being retried is not.
  IF v_status IS DISTINCT FROM 'held_for_review'
     AND NOT (p_kind IN ('helpr_task', 'delivery_refund') AND v_status = 'failed' AND v_attempts >= 12) THEN
    RAISE EXCEPTION 'not_held_for_review' USING ERRCODE = '55000';
  END IF;
  -- Shops refund (run-3 review #2/#3): a Stripe refund id is checked WITH Stripe first, so it goes
  -- only through shop-checkout's admin_settle_held_refund (service-only shops_admin_settle_held_refund);
  -- here only "other: ...", and only for the WHOLE refund the row owes (CHECK shop_refunds_settled_in_full).
  IF p_kind = 'shop_refund' AND v_stripe IS NOT NULL THEN
    RAISE EXCEPTION 'stripe_check_required' USING ERRCODE = '22023',
      HINT = 'Settle a Shops refund with a Stripe refund id from Payouts held for review: it is checked with Stripe first.';
  END IF;
  IF p_kind = 'shop_refund' AND p_amount_cents <> v_refund_cents THEN
    RAISE EXCEPTION 'settle_amount_differs' USING ERRCODE = '22023',
      HINT = format('A Shops refund is settled only for its whole amount, $%s.', to_char(v_refund_cents / 100.0, 'FM999999990.00'));
  END IF;
  -- A transfer on a payout / a refund (re_ or pyr_) on a refund: 'succeeded' with that id (the
  -- ledgers and the webhooks know it). A Stripe payout id or money paid outside Stripe:
  -- 'settled_by_hand'.
  v_succeeded := v_stripe IS NOT NULL AND (NOT v_payout OR v_stripe ~ '^tr_');
  -- A refund reaches 'succeeded' only for the WHOLE amount owed: a short Stripe refund would
  -- close the row (and count as refunded) while the buyer is still owed the rest.
  IF NOT v_payout AND v_succeeded AND p_amount_cents < COALESCE(v_refund_cents, 0) THEN
    RAISE EXCEPTION 'settle_amount_short' USING ERRCODE = '22023',
      HINT = 'Refund the rest in Stripe first, then record the full amount.';
  END IF;
  IF v_stripe IS NOT NULL THEN
    -- A Dashboard refund the hand-refund ledger recorded with no row, on THIS row's payment, is
    -- the refund that settled it: adopted (linked), not refused.
    IF p_kind = 'declutter_refund' THEN
      SELECT r.stripe_payment_intent_id INTO v_pi FROM public.declutter_refunds r WHERE r.id = p_id;
      UPDATE public.declutter_hand_refunds SET refund_row_id = p_id, hand_outcome = 'settled'
       WHERE stripe_refund_id = v_stripe AND stripe_payment_intent_id = v_pi AND refund_row_id IS NULL AND failed_at IS NULL;
      v_adopted := FOUND;
    END IF;
    IF NOT v_adopted AND public.money_ref_in_use(v_stripe) THEN
      RAISE EXCEPTION 'ref_already_used' USING ERRCODE = '23505',
        HINT = 'That Stripe id is already recorded on another payout or refund. Check you have the right one.';
    END IF;
  END IF;
  INSERT INTO public.payout_settlements (stripe_ref, off_stripe_note, row_kind, row_id, amount_cents)
  VALUES (v_stripe, v_other, p_kind, p_id, p_amount_cents);
  IF p_kind = 'declutter_refund' AND v_stripe IS NOT NULL AND NOT v_adopted THEN
    INSERT INTO public.declutter_hand_refunds (stripe_refund_id, stripe_payment_intent_id, order_id, refund_row_id, amount_cents,
                                               livemode, hand_outcome)
    SELECT v_stripe, r.stripe_payment_intent_id, r.order_id, r.id, p_amount_cents, COALESCE(r.payment_livemode, true), 'settled'
      FROM public.declutter_refunds r WHERE r.id = p_id;
  END IF;
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_ref = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_ref END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_ref = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_ref END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'shop_refund' THEN
    -- Only "other: ..." reaches here (above): settled by hand, never 'succeeded'.
    UPDATE public.shop_refunds SET status = 'settled_by_hand',
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.payout_payee_waits WHERE payout_kind = p_kind AND payout_id = p_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'admin_payout_settle_by_hand', p_kind, p_id::text,
          jsonb_build_object('note', v_note, 'ref', v_ref, 'amount_cents', p_amount_cents, 'adopted_hand_refund', v_adopted));
  RETURN jsonb_build_object('result', 'settled', 'kind', p_kind, 'id', p_id, 'adopted_hand_refund', v_adopted,
    'status', CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payout_settle_by_hand(text, uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_settle_by_hand(text, uuid, text, integer, text) TO authenticated, service_role;
