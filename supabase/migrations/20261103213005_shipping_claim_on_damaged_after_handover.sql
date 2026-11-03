-- Shipping claim payouts on a damaged parcel (Q2259; spec 5.3; lead 11-03, Builder 69's finding on 20261103210119).
--
-- Before (PGlite-measured, src/test/pglite/shippingClaimDamagedAfterHandover.pglite.mjs with NEW_MIGRATION=skip):
--   * declutter_admin_record_ship_claim refused order_not_refunded for a parcel found damaged AFTER the 24 h handover:
--     declutter_refund_after_handover('not_as_described') refunds the buyer but leaves the order 'handed_over';
--   * its debt lookup found the order's refund card-cost debt and its shipment's ship_* debts, but not the return
--     label's debt (20261103212046: source_kind ship_label, source_ref = the shipping_return_labels row).
-- Now: a 'handed_over' ship order with a not_as_described refund row may have a claim recorded, and the claim also
-- pays that order's return label debt (still THIS order's debts only, oldest first). Everything else is verbatim
-- (diffed against 20261103210119; neither the function nor its tables are on prod yet: to_regprocedure and
-- to_regclass NULL, read-only SELECT 11-03 ~3:30 PM CT).
-- LAND ORDER: AFTER 20261103210119 and 20261103212046 (same branch). REPLAY-SAFETY: CREATE OR REPLACE, REVOKE/GRANT.

CREATE OR REPLACE FUNCTION public.declutter_admin_record_ship_claim(p_order_id uuid, p_claim_ref text,
  p_amount_cents integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ref text := btrim(COALESCE(p_claim_ref, ''));
  v_note text := btrim(COALESCE(p_note, ''));
  o public.declutter_orders;
  v_ship uuid;
  v_prior public.shipping_claim_payouts;
  v_claimed integer;
  v_left integer;
  v_paid integer := 0;
  v_take integer;
  v_id uuid;
  d record;
BEGIN
  PERFORM public.require_feature('declutter_shipping');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_ref) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_claim_ref' USING ERRCODE = '22023', HINT = 'Enter the claim number from EasyPost or the carrier.';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say what the claim was for, in under 500 characters.';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023', HINT = 'Enter the amount the claim paid, above $0.';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  -- The same claim again: the same answer, nothing written twice. A ref reused for something else is refused.
  SELECT * INTO v_prior FROM public.shipping_claim_payouts c WHERE c.claim_ref = v_ref;
  IF FOUND THEN
    IF v_prior.order_id <> o.id OR v_prior.amount_cents <> p_amount_cents THEN
      RAISE EXCEPTION 'claim_ref_used' USING ERRCODE = '23505', HINT = 'This claim number is already recorded on another order or amount.';
    END IF;
    RETURN jsonb_build_object('result', 'already_recorded', 'claim_id', v_prior.id, 'debt_paid_cents', v_prior.debt_paid_cents,
                              'seller_due_cents', v_prior.seller_due_cents);
  END IF;
  IF o.handover IS DISTINCT FROM 'ship' THEN
    RAISE EXCEPTION 'not_a_shipped_order' USING ERRCODE = '22023', HINT = 'A shipping claim is only for an order that was shipped.';
  END IF;
  -- CHANGED (20261103213005): a damaged parcel refunded AFTER the handover (declutter_refund_after_handover,
  -- not_as_described) leaves the order 'handed_over' with its refund row; its claim is allowed too.
  IF o.status <> 'refunded' AND NOT (o.status = 'handed_over' AND EXISTS (
       SELECT 1 FROM public.declutter_refunds r WHERE r.order_id = o.id AND r.reason = 'not_as_described')) THEN
    RAISE EXCEPTION 'order_not_refunded' USING ERRCODE = '55000',
      HINT = 'Record a claim after the order is refunded as lost or broken in the mail.';
  END IF;
  SELECT s.id INTO v_ship FROM public.shipments s WHERE s.declutter_order_id = o.id ORDER BY s.created_at DESC, s.id LIMIT 1;
  IF v_ship IS NULL THEN
    RAISE EXCEPTION 'not_a_shipped_order' USING ERRCODE = '22023', HINT = 'This order has no shipment.';
  END IF;
  SELECT COALESCE(sum(c.amount_cents), 0) INTO v_claimed FROM public.shipping_claim_payouts c WHERE c.order_id = o.id;
  IF v_claimed + p_amount_cents > o.total_cents THEN
    RAISE EXCEPTION 'claim_too_large' USING ERRCODE = '22023',
      HINT = format('Claims on this order can add up to $%s at most.', to_char(o.total_cents / 100.0, 'FM999990.00'));
  END IF;

  v_left := p_amount_cents;
  IF o.seller_id IS NOT NULL THEN
    -- The payout path's lock (declutter_consume_fee_debt), then the rows: THIS order's debts only, oldest first.
    PERFORM pg_advisory_xact_lock(hashtextextended('declutter_fee_debt:' || o.seller_id::text, 0));
    FOR d IN
      SELECT x.id, x.remaining_cents FROM public.declutter_seller_fee_debts x
       WHERE x.seller_id = o.seller_id AND x.remaining_cents > 0
         AND (x.refund_id IN (SELECT r.id FROM public.declutter_refunds r WHERE r.order_id = o.id)
              OR (x.source_kind IN ('ship_label', 'ship_adjustment', 'ship_hazmat_fee', 'ship_void_rejected')
                  AND x.source_ref IN (SELECT s.id FROM public.shipments s WHERE s.declutter_order_id = o.id))
              -- CHANGED (20261103213005): the order's return label debt (20261103212046) is that order's debt too.
              OR (x.source_kind = 'ship_label'
                  AND x.source_ref IN (SELECT rl.id FROM public.shipping_return_labels rl WHERE rl.order_id = o.id)))
       ORDER BY x.created_at, x.id
       FOR UPDATE
    LOOP
      EXIT WHEN v_left = 0;
      v_take := LEAST(v_left, d.remaining_cents);
      INSERT INTO public.declutter_fee_debt_deductions (debt_id, payout_ref, deducted_cents)
      VALUES (d.id, 'ship_claim:' || v_ref, v_take);
      UPDATE public.declutter_seller_fee_debts SET remaining_cents = remaining_cents - v_take WHERE id = d.id;
      v_left := v_left - v_take;
      v_paid := v_paid + v_take;
    END LOOP;
  END IF;

  INSERT INTO public.shipping_claim_payouts (order_id, shipment_id, seller_id, claim_ref, amount_cents, debt_paid_cents,
    seller_due_cents, status, recorded_by, note, is_seed)
  VALUES (o.id, v_ship, o.seller_id, v_ref, p_amount_cents, v_paid, v_left,
          CASE WHEN v_left = 0 THEN 'settled' ELSE 'seller_due' END, v_uid, v_note, COALESCE(o.is_seed, false))
  RETURNING id INTO v_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_admin_record_ship_claim', 'declutter_order', o.id::text,
          jsonb_build_object('claim_id', v_id, 'claim_ref', v_ref, 'amount_cents', p_amount_cents,
                             'debt_paid_cents', v_paid, 'seller_due_cents', v_left, 'note', v_note));
  IF v_paid > 0 THEN
    -- In words, never a fee name (owner: members see no fee words).
    PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'Carrier claim paid',
      format('The carrier paid a claim on the package you shipped. $%s of it paid what you owed from that sale, so it won''t come out of your payouts.',
             to_char(v_paid / 100.0, 'FM999990.00')),
      '/declutter?tab=selling', NULL);
  END IF;
  RETURN jsonb_build_object('result', 'recorded', 'claim_id', v_id, 'debt_paid_cents', v_paid, 'seller_due_cents', v_left);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_record_ship_claim(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_record_ship_claim(uuid, text, integer, text) TO authenticated, service_role;
