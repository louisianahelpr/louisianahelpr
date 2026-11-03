-- Q2390 packet 28 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for six functions that still raised P0002:
--   declutter_save_card (service_role; stripe-webhook declutterCheckout. Raises
--        on an unknown user before the INSERT. The webhook throws on ANY error
--        and Stripe redelivers: identical for PT404.)
--   declutter_payout_take_setup_fee (service_role; declutter-money. Raises at
--        the FOR UPDATE payout read, before any write. declutter-money treats
--        every error but PGRST202 the same way (defect + skip this run), so
--        PT404 behaves as P0002 did.)
--   rentals_decide_rent_payment (landlord; raises at the locked payment read,
--        before the UPDATE/notify. src/lib/rentals/rent.ts maps by message.)
--   declutter_seller_delivery_booking (reader; src/lib/declutter/sellerDelivery.ts
--        maps by message.)
--   declutter_cancel_after_no_helpr (buyer; raises after the order lock and
--        before declutter_close_paid_order, the only write. noHelpr.ts maps by
--        message.)
--   declutter_set_delivery_handoff (buyer; raises after the order lock, before
--        the UPDATE/notify. sellerDelivery.ts maps by message.)
-- No edge map changes, no deploy.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_save_card                    20261018160108 493b7746b7ed1f9154ad4ec5a673a34f
--   rentals_decide_rent_payment            20261019073106 d32de667f9614184c92a21584a0e4ed2
--   declutter_seller_delivery_booking      20261027153244 ae368bc78dae545a97e0c222f5e06724
--   declutter_cancel_after_no_helpr        20261031133938 6cebbdce3723b88817c12bbc0053b8b8
--   declutter_set_delivery_handoff         20261027153244 4803ff5c3b0f71e8e07d0aefcab5d8f1
--   declutter_payout_take_setup_fee        20261031225132 2cc4ec72d8297c36441a954a050da37e
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (6 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.declutter_save_card(p_user uuid, p_customer text, p_payment_method text, p_brand text, p_last4 text, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO public.declutter_buyer_cards (user_id, stripe_customer_id, payment_method_id, brand, last4, card_mode, saved_at)
  VALUES (p_user, p_customer, p_payment_method, left(p_brand, 20),
          CASE WHEN p_last4 ~ '^[0-9]{4}$' THEN p_last4 END, p_mode, now())
  ON CONFLICT (user_id) DO UPDATE
    SET stripe_customer_id = EXCLUDED.stripe_customer_id, payment_method_id = EXCLUDED.payment_method_id,
        brand = EXCLUDED.brand, last4 = EXCLUDED.last4, card_mode = EXCLUDED.card_mode, saved_at = now();
  -- One wallet: the member's first stored customer in this mode wins.
  -- A cus_ already stored for ANOTHER member (never expected: the id comes
  -- from Stripe's signed event) is logged, not raised, so the webhook does not
  -- retry forever; the card is still saved (reviews: lh-authz-rls #1, lh-money-escrow #2).
  IF p_mode IN ('live', 'test') AND p_customer ~ '^cus_[A-Za-z0-9]+$' THEN
    BEGIN
      INSERT INTO public.stripe_customers (user_id, wallet_mode, stripe_customer_id)
      VALUES (p_user, p_mode, p_customer)
      ON CONFLICT (user_id, wallet_mode) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'one wallet: % is stored for another member; card saved, wallet unchanged', p_customer;
    END;
  END IF;
  PERFORM public.declutter_notify(p_user, 'payment', 'Card saved',
    'Your card is saved. It is charged only when you buy, or automatically where you turned on automatic charges.', '/declutter');
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_save_card(p_user uuid, p_customer text, p_payment_method text, p_brand text, p_last4 text, p_mode text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_save_card(p_user uuid, p_customer text, p_payment_method text, p_brand text, p_last4 text, p_mode text) TO service_role;

CREATE OR REPLACE FUNCTION public.rentals_decide_rent_payment(p_payment_id uuid, p_received boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_p public.rental_rent_payments%ROWTYPE;
  v_t public.rental_tenancies%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_p FROM public.rental_rent_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR public.rentals_rent_side(v_p.tenancy_id, v_uid) IS DISTINCT FROM 'landlord' THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_p.status <> 'reported' THEN
    RAISE EXCEPTION 'payment_already_decided' USING ERRCODE = '22023';
  END IF;
  IF p_received IS NULL OR (NOT p_received AND char_length(v_reason) NOT BETWEEN 3 AND 300) THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_rent_payments
     SET status = CASE WHEN p_received THEN 'confirmed' ELSE 'declined' END,
         decided_at = now(),
         decline_reason = CASE WHEN p_received THEN NULL ELSE v_reason END
   WHERE id = p_payment_id;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_p.tenancy_id;
  PERFORM public.rentals_notify(v_t.tenant_id,
    CASE WHEN p_received THEN 'Rent received' ELSE 'Rent payment not confirmed' END,
    CASE WHEN p_received THEN 'Your landlord confirmed your payment of ' || to_char(v_p.amount_cents / 100.0, 'FM$999,999,990.00') || '.'
         ELSE 'Your landlord has not received your payment of ' || to_char(v_p.amount_cents / 100.0, 'FM$999,999,990.00') || ': ' || v_reason END,
    '/rentals', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_decide_rent_payment(p_payment_id uuid, p_received boolean, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_decide_rent_payment(p_payment_id uuid, p_received boolean, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_booking(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rules jsonb := public.declutter_seller_delivery_rules();
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
  h public.declutter_handovers;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id;
  IF v_side IS NULL OR o.handover IS DISTINCT FROM 'seller_delivery' OR d.order_id IS NULL
     OR NOT (o.status IN ('paid', 'handed_over') OR (v_side = 'buyer' AND o.status = 'awaiting_payment')) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  RETURN jsonb_build_object(
    'order_id', o.id, 'side', v_side, 'order_status', o.status, 'status', d.status,
    'slot_start', d.slot_start, 'slot_end', d.slot_end, 'delivery_cents', o.delivery_cents,
    'dropoff_area', d.dropoff_area, 'handoff', d.handoff,
    'dropoff_address', CASE WHEN v_side = 'buyer' OR o.status = 'paid' THEN d.dropoff_address END,
    'proposed_start', d.proposed_start, 'proposed_by', d.proposed_by,
    'proposals_left', (v_rules ->> 'proposals_per_side')::integer
                      - CASE WHEN v_side = 'buyer' THEN d.buyer_proposals ELSE d.seller_proposals END,
    'delivered_at', d.delivered_at, 'delivered_photo_path', h.set_out_photo_path,
    'confirmed_at', h.confirmed_at,
    'not_delivered_from', d.slot_end + make_interval(mins => (v_rules ->> 'not_delivered_after_minutes')::integer));
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_seller_delivery_booking(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivery_booking(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_cancel_after_no_helpr(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_why text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_side <> 'buyer' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- A second tap after the cancel went through answers the same.
  IF o.status = 'refunded' AND EXISTS (SELECT 1 FROM public.declutter_refunds r WHERE r.order_id = o.id AND r.reason = 'buyer_cancelled')
     AND EXISTS (SELECT 1 FROM public.declutter_delivery_refunds d WHERE d.order_id = o.id AND d.reason = 'no_helpr') THEN
    RETURN jsonb_build_object('result', 'already');
  END IF;
  v_why := public.declutter_no_helpr_refusal(o.id);
  IF v_why = 'pickup_booked' THEN
    RAISE EXCEPTION 'pickup_booked' USING ERRCODE = '55000',
      HINT = 'You booked a pickup time, so this sale goes ahead. If something is wrong, report a problem.';
  ELSIF v_why = 'problem_open' THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  ELSIF v_why IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_no_helpr_order' USING ERRCODE = '55000',
      HINT = 'This sale can''t be cancelled here.';
  END IF;
  -- Owner 10-31: the buyer chose to cancel, so the buyer bears the card fee (keep_card_fee). No strike: no one's fault.
  RETURN public.declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL, NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_cancel_after_no_helpr(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_cancel_after_no_helpr(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_delivery_handoff(p_order_id uuid, p_handoff text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'buyer' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  IF p_handoff IS NULL OR p_handoff NOT IN ('leave', 'hand') THEN
    RAISE EXCEPTION 'invalid_handoff' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.status NOT IN ('booked', 'needs_time')
     OR EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_reschedulable' USING ERRCODE = '55000';
  END IF;
  IF d.handoff IS DISTINCT FROM p_handoff THEN
    UPDATE public.declutter_seller_deliveries SET handoff = p_handoff, updated_at = now() WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Delivery changed',
      CASE WHEN p_handoff = 'hand' THEN 'The buyer now wants it handed to them.' ELSE 'The buyer now wants it left at the door, with a photo.' END,
      '/declutter?view=sales', o.buyer_id);
  END IF;
  RETURN p_handoff;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_delivery_handoff(p_order_id uuid, p_handoff text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_delivery_handoff(p_order_id uuid, p_handoff text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_payout_take_setup_fee(p_payout_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.declutter_payouts;
  v_fee integer;
  v_won boolean;
  v_amount integer;
BEGIN
  SELECT * INTO p FROM public.declutter_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- A row a send was ever tried for keeps its amount, even after a rebook or a release put attempts back to 0: its
  -- Stripe key (declutter-payout-<id>) may already carry the old amount.
  IF p.status NOT IN ('pending', 'failed') OR p.setup_fee_cents > 0 OR p.attempts > 0 OR p.send_tried
     OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'declutter' AND m.payout_id = p.id) THEN
    RETURN p.amount_cents;
  END IF;
  v_fee := public.declutter_setup_fee_from_payout_cents(p.seller_id);
  IF v_fee <= 0 OR p.amount_cents - v_fee < 100 THEN
    RETURN p.amount_cents;
  END IF;
  UPDATE public.profiles
     SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
   WHERE user_id = p.seller_id AND onboarding_fee_paid IS NOT TRUE
  RETURNING onboarding_fee_paid INTO v_won;
  IF v_won IS NOT TRUE THEN
    RETURN p.amount_cents;
  END IF;
  v_amount := p.amount_cents - v_fee;
  UPDATE public.declutter_payouts
     SET setup_fee_cents = v_fee, debt_cents = debt_cents + v_fee, amount_cents = v_amount
   WHERE id = p.id;
  PERFORM public.declutter_notify(p.seller_id, 'declutter_sales', 'One-time setup fee taken',
    format('We took the one-time $%s account setup fee from your payout for %s, so $%s is on its way. It is never charged again.',
           to_char(v_fee / 100.0, 'FM999990.00'), public.declutter_order_items_named(p.order_id), to_char(v_amount / 100.0, 'FM999990.00')),
    '/declutter?tab=selling', NULL);
  RETURN v_amount;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_payout_take_setup_fee(p_payout_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payout_take_setup_fee(p_payout_id uuid) TO service_role;

