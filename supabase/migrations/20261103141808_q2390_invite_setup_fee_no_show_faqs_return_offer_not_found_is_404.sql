-- Q2390 packet 29 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for six functions that still raised P0002:
--   helpr_task_payout_take_setup_fee (service_role; declutter-money. Raises at
--        the FOR UPDATE payout read, before any write. declutter-money treats
--        every error but PGRST202 the same way (defect + skip this run), so
--        PT404 behaves as P0002 did.)
--   rentals_invite_tenant (landlord; raises at the locked unit read, before
--        the INSERT. src/lib/rentals/api.ts maps by message.)
--   declutter_report_not_delivered (buyer; raises after the order lock, before
--        declutter_start_no_show_answer, the only write. sellerDelivery.ts maps
--        by message.)
--   shops_set_my_faqs (shop owner; raises at the locked shop read, before the
--        DELETE/INSERT. src/lib/shops/faqs.ts maps by message.)
--   declutter_set_return_address (buyer; both raises come before the request
--        lock and the UPDATE/notify. refundReturns.ts maps by message.)
--   declutter_answer_refund_offer (buyer; both raises come before the request
--        lock, the refund and the UPDATE. refundRequests.ts maps by message.)
-- No edge map changes, no deploy.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   rentals_invite_tenant                  20261019051407 15916fed8a354390320a878ce23fc4f0
--   helpr_task_payout_take_setup_fee       20261031225132 4f909be64c0d1410689eb5576337bb6a
--   declutter_report_not_delivered         20261031004529 d514969a35b53626256303014f8f7dfe
--   shops_set_my_faqs                      20261019072541 944b79316614973bb27d792cb05965eb
--   declutter_set_return_address           20261030071818 9a6aff54bbd547cf0a2542660b4969c2
--   declutter_answer_refund_offer          20261026155251 cff02b0e73011ea7a63319c382f0aac6
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (8 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.rentals_invite_tenant(p_unit_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_prop uuid;
  v_status text;
  v_token text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT u.property_id, p.ownership_status INTO v_prop, v_status
    FROM public.rental_units u JOIN public.rental_properties p ON p.id = u.property_id
   WHERE u.id = p_unit_id AND p.owner_id = v_uid
   FOR UPDATE OF p;  -- serializes the open-invite cap below
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Q5 holds for as long as they invite, not only at creation (review #8).
  -- The one identity rule (owner 2026-10-19): Stripe Identity, Stripe Connect's
  -- identity check, or an admin-approved ID photo.
  IF NOT public.is_identity_verified(v_uid) THEN
    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'ownership_not_approved' USING ERRCODE = '42501';
  END IF;
  -- Open invites per unit are capped so a link cannot be farmed.
  IF (SELECT count(*) FROM public.rental_tenancies
       WHERE unit_id = p_unit_id AND status = 'invited' AND invite_expires_at > now()) >= 10 THEN
    RAISE EXCEPTION 'too_many_open_invites' USING ERRCODE = '22023';
  END IF;
  -- Two v4 UUIDs (gen_random_uuid draws from the CSPRNG): 244 random bits.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.rental_tenancies (unit_id, property_id, landlord_id, invite_token_sha256, invite_expires_at)
  VALUES (p_unit_id, v_prop, v_uid, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now() + interval '14 days');
  RETURN v_token;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_invite_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_invite_tenant(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_payout_take_setup_fee(p_payout_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.helpr_task_payouts;
  v_raised integer;
  v_fee integer;
  v_won boolean;
  v_amount integer;
BEGIN
  SELECT * INTO p FROM public.helpr_task_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- A row a send was ever tried for keeps its amount, even after a release put attempts back to 0: its Stripe key
  -- (helpr-task-payout-<id>) may already carry the old amount.
  IF p.status NOT IN ('pending', 'failed') OR p.setup_fee_cents > 0 OR p.attempts > 0 OR p.helpr_id IS NULL OR p.send_tried
     OR EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'helpr_task' AND m.payout_id = p.id) THEN
    RETURN p.amount_cents;
  END IF;
  v_fee := public.declutter_setup_fee_from_payout_cents(p.helpr_id);
  SELECT COALESCE(t.raised_cents, 0) INTO v_raised FROM public.helpr_tasks t WHERE t.id = p.task_id;
  IF v_fee <= 0 OR p.amount_cents - COALESCE(v_raised, 0) - v_fee < 100 THEN
    RETURN p.amount_cents;
  END IF;
  UPDATE public.profiles
     SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
   WHERE user_id = p.helpr_id AND onboarding_fee_paid IS NOT TRUE
  RETURNING onboarding_fee_paid INTO v_won;
  IF v_won IS NOT TRUE THEN
    RETURN p.amount_cents;
  END IF;
  v_amount := p.amount_cents - v_fee;
  UPDATE public.helpr_task_payouts
     SET setup_fee_cents = v_fee, amount_cents = v_amount
   WHERE id = p.id;
  PERFORM public.declutter_notify(p.helpr_id, 'payment', 'One-time setup fee taken',
    format('We took the one-time $%s account setup fee from your delivery payout, so $%s is on its way. It is never charged again.',
           to_char(v_fee / 100.0, 'FM999990.00'), to_char(v_amount / 100.0, 'FM999990.00')),
    '/declutter?tab=deliver', NULL);
  RETURN v_amount;
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_payout_take_setup_fee(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_payout_take_setup_fee(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_report_not_delivered(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.status IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  IF now() < d.slot_end + make_interval(mins => (public.declutter_seller_delivery_rules() ->> 'not_delivered_after_minutes')::integer) THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000', HINT = 'Wait 15 minutes after the delivery time ends.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'seller_delivered' USING ERRCODE = '55000',
      HINT = 'The seller marked it delivered. If you don''t have it, report a problem.';
  END IF;
  -- CHANGED (owner 10-30): no refund and no strike on one tap. The sweep closes it if the seller doesn't answer.
  RETURN public.declutter_start_no_show_answer(o.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_report_not_delivered(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_report_not_delivered(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_set_my_faqs(p_faqs jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
  v_hidden timestamptz;
  v_e jsonb;
  v_q text;
  v_a text;
  v_pos smallint := 0;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT id, hidden_at INTO v_shop, v_hidden FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_hidden IS NOT NULL THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501', HINT = 'Louisiana Helpr hid this shop. Contact support.';
  END IF;
  IF p_faqs IS NULL OR jsonb_typeof(p_faqs) <> 'array' OR jsonb_array_length(p_faqs) > 10 THEN
    RAISE EXCEPTION 'invalid_faqs' USING ERRCODE = '22023', HINT = 'A shop can have up to 10 questions.';
  END IF;
  DELETE FROM public.shop_faqs WHERE shop_id = v_shop;
  FOR v_e IN SELECT e FROM jsonb_array_elements(p_faqs) e LOOP
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'invalid_faqs' USING ERRCODE = '22023';
    END IF;
    v_q := btrim(public.shop_text_clean(COALESCE(v_e ->> 'question', '')));
    v_a := btrim(public.shop_text_clean(COALESCE(v_e ->> 'answer', '')));
    IF char_length(v_q) NOT BETWEEN 3 AND 140 OR char_length(v_a) NOT BETWEEN 1 AND 600 THEN
      RAISE EXCEPTION 'invalid_faqs' USING ERRCODE = '22023',
        HINT = 'Each question needs 3 to 140 characters and an answer of up to 600.';
    END IF;
    -- The contact checks (each field, and all of them joined) are the table's
    -- triggers: trg_shop_faq_clean_and_check and trg_shop_faqs_check_joined_ins.
    INSERT INTO public.shop_faqs (shop_id, position, question, answer) VALUES (v_shop, v_pos, v_q, v_a);
    v_pos := v_pos + 1;
  END LOOP;
  UPDATE public.shops SET updated_at = now() WHERE id = v_shop;
  RETURN v_pos;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_set_my_faqs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_my_faqs(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_return_address(p_request_id uuid, p_address text, p_lat numeric,
  p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'returning' OR r.return_way IS DISTINCT FROM 'collect' THEN
    RAISE EXCEPTION 'not_a_collect' USING ERRCODE = '55000';
  END IF;
  p_address := NULLIF(btrim(p_address), '');
  IF p_address IS NULL OR char_length(p_address) > 300 THEN
    RAISE EXCEPTION 'address_required' USING ERRCODE = '22023', HINT = 'Type the address (up to 300 characters).';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'address_not_found' USING ERRCODE = '22023', HINT = 'We couldn''t find that address on the map.';
  END IF;
  UPDATE public.declutter_refund_requests SET return_address = p_address, return_lat = p_lat, return_lng = p_lng
   WHERE id = r.id;
  PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'Where to collect the item',
    'The buyer added the address where you collect the item. It''s on the sale.', '/declutter?view=selling', v_uid);
  RETURN jsonb_build_object('result', 'address_set');
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_return_address(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_return_address(uuid, text, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_answer_refund_offer(p_request_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_out jsonb;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'invalid_answer' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'offered' THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  IF now() >= r.offer_answer_by THEN
    RAISE EXCEPTION 'refund_answer_late' USING ERRCODE = '55000',
      HINT = 'The 24 hours to answer are over, so Louisiana Helpr decides this one.';
  END IF;
  IF p_accept THEN
    v_out := public.declutter_refund_after_handover(o.id, 'refund_request_part', r.offer_cents);
    UPDATE public.declutter_refund_requests
       SET status = 'agreed', refund_id = (v_out->>'refund_id')::uuid, settled_at = now()
     WHERE id = r.id;
    RETURN v_out || jsonb_build_object('result', 'refunded');
  END IF;
  PERFORM public.declutter_refund_request_to_admin(r.id,
    format('the seller offered $%s back and the buyer asked Louisiana Helpr to decide', to_char(r.offer_cents / 100.0, 'FM999990.00')));
  RETURN jsonb_build_object('result', 'to_admin');
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_answer_refund_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_refund_offer(uuid, boolean) TO authenticated, service_role;

