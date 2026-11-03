-- Shipping claim payouts pay that order's debt first (Q2259; docs/specs/shipping-draft.md 5.3 row "ship_lost": "USPS/
-- EasyPost claim payout pays that order's debt first, the rest to the seller", review fix 16).
--
-- Before: a lost or broken parcel refunds the buyer in full and books the spent label and the card cost as the
-- seller's debt (ship_lost sweep 20261103203204, admin no-fault 20261102055653, rejected void 20261102045553). When the
-- carrier's insurance claim on that parcel paid out (into the EasyPost wallet, outside Stripe), nothing recorded it: the
-- seller kept owing the label and the card cost from a loss the carrier had already paid for.
--
-- Now: an admin records the claim payout once with declutter_admin_record_ship_claim(order, claim ref, amount, note):
--   * admin only, behind the declutter_shipping switch; a shipped order ('ship') that was refunded, with a shipment;
--     the claims on one order never add up to more than the order's total;
--   * the amount pays THAT ORDER's open debts first, oldest first: the card-cost debt of its refunds and the ship_*
--     debts of its shipments, never another order's. Each payment is a declutter_fee_debt_deductions row
--     (payout_ref 'ship_claim:<claim ref>') and lowers remaining_cents, under the payout path's own advisory lock
--     (declutter_consume_fee_debt, 20261014224914), so a payout running at the same moment takes before or after;
--   * what is left is recorded as seller_due_cents (status 'seller_due'); a claim the debts use up is 'settled'.
--     SENDING the rest to the seller is NOT built here: it needs a payout path for money that is not an order's sale
--     (declutter_payouts is one row per order). Until then an admin sees it on the row; the seller is told only what
--     was paid off, never promised a transfer that does not exist yet.
--   * the same claim ref again answers the same result and writes nothing; a ref reused for another order or amount
--     is refused. An admin_audit_log row; the seller is told in words (members see no fee words).
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE; REVOKE ... FROM PUBLIC, anon.
-- Proof: src/test/pglite/shippingClaimPayout.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

CREATE TABLE IF NOT EXISTS public.shipping_claim_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.declutter_orders(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The carrier's or EasyPost's claim id: one record per claim, ever.
  claim_ref text NOT NULL UNIQUE CHECK (char_length(claim_ref) BETWEEN 1 AND 200),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  debt_paid_cents integer NOT NULL CHECK (debt_paid_cents >= 0),
  seller_due_cents integer NOT NULL CHECK (seller_due_cents >= 0),
  status text NOT NULL CHECK (status IN ('settled', 'seller_due', 'seller_paid')),
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_claim_split CHECK (debt_paid_cents + seller_due_cents = amount_cents),
  CONSTRAINT shipping_claim_settled CHECK ((status = 'settled') = (seller_due_cents = 0))
);
CREATE INDEX IF NOT EXISTS shipping_claim_payouts_order_idx ON public.shipping_claim_payouts (order_id);
CREATE INDEX IF NOT EXISTS shipping_claim_payouts_shipment_idx ON public.shipping_claim_payouts (shipment_id);
CREATE INDEX IF NOT EXISTS shipping_claim_payouts_seller_idx ON public.shipping_claim_payouts (seller_id);
CREATE INDEX IF NOT EXISTS shipping_claim_payouts_recorded_by_idx ON public.shipping_claim_payouts (recorded_by);
ALTER TABLE public.shipping_claim_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipping_claim_payouts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shipping_claim_payouts TO service_role;

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
  IF o.status <> 'refunded' THEN
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
                  AND x.source_ref IN (SELECT s.id FROM public.shipments s WHERE s.declutter_order_id = o.id)))
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
