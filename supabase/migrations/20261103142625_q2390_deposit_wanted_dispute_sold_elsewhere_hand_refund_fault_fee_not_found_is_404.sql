-- Q2390 packet 30 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for six functions that still raised P0002:
--   bill_helpr_fault_card_fee (service_role; create-payment billHelprFaultCardFee.
--        Raises at the FOR UPDATE ruling read, before the UPDATE/notification.
--        The caller treats ANY error alike (Slack money_at_risk alert, failed:
--        true), so PT404 behaves as P0002 did.)
--   shops_admin_record_hand_refund (service_role; shop-checkout
--        adminRecordHandRefund. Raises at the order read, before
--        shop_record_hand_refund and the audit row. rpcRefusal already answers
--        404 for PT404 as for P0002.)
--   rentals_set_deposit (landlord; raises at the locked tenancy read, before
--        the INSERT/notify. src/lib/rentals/rent.ts maps by message.)
--   rentals_dispute_rent_payment (tenant; raises at the locked payment read,
--        before the UPDATE/notify. rent.ts maps by message.)
--   declutter_update_wanted (raises at the locked wanted read, before the
--        UPDATE and the match notices. src/lib/declutter/wanted.ts maps by
--        message.)
--   declutter_mark_sold_elsewhere (seller; raises at the locked item read,
--        before the offer voids, the photo/watchlist DELETEs and the UPDATE.
--        src/lib/declutter/api.ts maps by message.)
-- No edge map changes, no deploy.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   rentals_set_deposit                    20261019082216 7ea424559b31e2ec8f8b496bf4dce180
--   declutter_update_wanted                20261030221255 61c0e6c3c0425b91113b6d7ca0b7028d
--   rentals_dispute_rent_payment           20261019073106 b08e91c2bdd0491121d1c5130ca40e3c
--   declutter_mark_sold_elsewhere          20261028192719 409a51b6caf2f4be643abfc87e4d0f7d
--   shops_admin_record_hand_refund         20261019071055 e1de0603b14508f1756a119af8d46eab
--   bill_helpr_fault_card_fee              20261019015301 413d5cf9d93bb90ccaac16c07d724f91
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (6 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.rentals_set_deposit(p_tenancy_id uuid, p_amount_cents integer, p_received_on date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id FOR UPDATE;
  IF NOT FOUND OR v_t.landlord_id IS DISTINCT FROM v_uid
     OR NOT (v_t.status = 'active' OR (v_t.status = 'ended' AND v_t.ended_at > now() - interval '30 days')) THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 100 AND 10000000
     OR p_received_on IS NULL OR p_received_on > public.shop_local_today() OR p_received_on < public.shop_local_today() - 3660 THEN
    RAISE EXCEPTION 'bad_deposit' USING ERRCODE = '22023';
  END IF;
  -- A settled deposit is final.
  IF EXISTS (SELECT 1 FROM public.rental_deposits d WHERE d.tenancy_id = p_tenancy_id AND d.settled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'deposit_settled' USING ERRCODE = '22023';
  END IF;
  -- After the end the landlord may only fill in a deposit never recorded; a recorded amount and date stay
  -- as they were (lead review round 2 #2).
  IF v_t.status = 'ended' AND EXISTS (SELECT 1 FROM public.rental_deposits d WHERE d.tenancy_id = p_tenancy_id AND d.amount_cents IS NOT NULL) THEN
    RAISE EXCEPTION 'deposit_already_recorded' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_deposits (tenancy_id, amount_cents, received_on)
  VALUES (p_tenancy_id, p_amount_cents, p_received_on)
  ON CONFLICT (tenancy_id) DO UPDATE SET amount_cents = EXCLUDED.amount_cents, received_on = EXCLUDED.received_on, updated_at = now();
  PERFORM public.rentals_notify(v_t.tenant_id, 'Deposit recorded',
    'Your landlord recorded your security deposit of ' || to_char(p_amount_cents / 100.0, 'FM$999,999,990.00') || '. See it under Homes.', '/rentals', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_set_deposit(uuid, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_deposit(uuid, integer, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_update_wanted(p_wanted_id uuid, p_what text, p_category text, p_max_price_cents integer, p_radius_miles integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_w public.declutter_wanted%ROWTYPE;
  v_what text := btrim(regexp_replace(COALESCE(p_what, ''), '\s+', ' ', 'g'));
  v_told integer := 0;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_w FROM public.declutter_wanted WHERE id = p_wanted_id AND user_id = v_uid AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_w.status <> 'open' OR v_w.expires_at <= now() THEN
    RAISE EXCEPTION 'wanted_not_open' USING ERRCODE = '22023';
  END IF;
  IF public.declutter_wanted_text_problem(v_what) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_wanted_text'
      USING ERRCODE = '22023', HINT = 'Say what you want in 3 to 60 letters, like "crib" or "oak dresser".';
  END IF;
  IF p_category IS NULL OR p_category !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  IF p_max_price_cents IS NULL OR p_max_price_cents NOT BETWEEN 100 AND 100000 OR p_max_price_cents % 100 <> 0 THEN
    RAISE EXCEPTION 'invalid_max_price'
      USING ERRCODE = '22023', HINT = 'Your highest price must be whole dollars between $1 and $1,000.';
  END IF;
  IF p_radius_miles IS NULL OR p_radius_miles NOT IN (5, 10, 25, 50) THEN
    RAISE EXCEPTION 'invalid_radius' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_wanted
     SET what = v_what, category = p_category, max_price_cents = p_max_price_cents, radius_miles = p_radius_miles::smallint
   WHERE id = p_wanted_id;
  FOR r IN SELECT * FROM public.declutter_wanted_pairs(NULL, p_wanted_id, false) LOOP
    v_told := v_told + public.declutter_wanted_record_match(r.wanted_id, r.item_id, v_told < 20, false);
  END LOOP;
  RETURN p_wanted_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_update_wanted(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_update_wanted(uuid, text, text, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_dispute_rent_payment(p_payment_id uuid, p_reason text)
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
  v_last timestamptz;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_p FROM public.rental_rent_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR public.rentals_rent_side(v_p.tenancy_id, v_uid) IS DISTINCT FROM 'tenant' THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- The last landlord decision or change; each one may be disputed once, within 30 days (lead review
  -- round 2 #1): a dispute dated at or after it means that one was already disputed.
  v_last := GREATEST(v_p.decided_at, (SELECT max((c ->> 'at')::timestamptz) FROM jsonb_array_elements(v_p.corrections) c));
  IF NOT (v_p.status IN ('declined', 'reversed') OR jsonb_array_length(v_p.corrections) > 0)
     OR v_last IS NULL OR v_last < now() - interval '30 days'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_p.tenant_disputes) x WHERE (x ->> 'at')::timestamptz >= v_last) THEN
    RAISE EXCEPTION 'payment_not_disputable' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_rent_payments
     SET tenant_disputes = tenant_disputes || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'reason', v_reason))
   WHERE id = p_payment_id;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_p.tenancy_id;
  PERFORM public.rentals_notify(v_t.landlord_id, 'Rent payment disputed',
    'Your tenant disputes the payment of ' || to_char(v_p.amount_cents / 100.0, 'FM$999,999,990.00') || ': ' || v_reason
      || ' Talk it through in Messages; you can record or correct it under Homes -> Owning.',
    '/rentals', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_dispute_rent_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_dispute_rent_payment(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_mark_sold_elsewhere(p_item_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
  v_paths text[];
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Not the selling gate on purpose (as declutter_withdraw_item): an under-18 or struck member may still
  -- close their own listing.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status = 'sold_elsewhere' THEN
    RETURN ARRAY[]::text[];
  END IF;
  -- Up, paused, waiting for review or off sale. Reserved / sold / completed are an in-app sale; a draft was
  -- never listed; rejected / removed are Louisiana Helpr's.
  IF v_item.status NOT IN ('pending_review', 'live', 'paused', 'ended') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Item no longer available',
      format('"%s" sold elsewhere, so your offer is closed. Nothing was charged.', v_item.title),
      '/declutter?tab=buying', v_uid);
  END LOOP;

  SELECT COALESCE(array_agg(storage_path ORDER BY position), ARRAY[]::text[]) INTO v_paths
    FROM public.declutter_item_photos WHERE item_id = p_item_id;
  DELETE FROM public.declutter_item_photos WHERE item_id = p_item_id;
  DELETE FROM public.declutter_watchlist WHERE item_id = p_item_id;
  UPDATE public.declutter_items SET status = 'sold_elsewhere', updated_at = now() WHERE id = p_item_id;
  RETURN v_paths;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_mark_sold_elsewhere(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_mark_sold_elsewhere(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_admin_record_hand_refund(p_admin uuid, p_order_id uuid, p_stripe_refund_id text,
  p_amount_cents integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := p_admin;
  v_note text := btrim(COALESCE(p_note, ''));
  v_ref text := btrim(COALESCE(p_stripe_refund_id, ''));
  o public.shop_orders;
  v_out text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  IF v_ref !~ '^(re|pyr)_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023', HINT = 'Paste the Stripe refund id (re_...).';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > o.total_cents THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023', HINT = 'Enter the amount refunded, at most what the buyer paid.';
  END IF;
  -- A re_ id another money row already holds is not this order's hand refund.
  IF NOT EXISTS (SELECT 1 FROM public.shop_hand_refunds h WHERE h.stripe_refund_id = v_ref AND h.order_id = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.shop_refunds r WHERE r.stripe_refund_id = v_ref AND r.order_id = o.id)
     AND public.money_ref_in_use(v_ref) THEN
    RAISE EXCEPTION 'ref_already_used' USING ERRCODE = '23505',
      HINT = 'That Stripe id is already recorded on another payout or refund. Check you have the right one.';
  END IF;
  v_out := public.shop_record_hand_refund(o.stripe_payment_intent_id, v_ref, p_amount_cents, o.payment_livemode, 'admin', v_uid, v_note);
  IF v_out <> 'already' THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (v_uid, 'shops_admin_record_hand_refund', 'shop_order', o.id::text,
            jsonb_build_object('stripe_refund_id', v_ref, 'amount_cents', p_amount_cents, 'note', v_note, 'outcome', v_out));
  END IF;
  RETURN jsonb_build_object('result', v_out, 'order_id', o.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_admin_record_hand_refund(uuid, uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_admin_record_hand_refund(uuid, uuid, text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.bill_helpr_fault_card_fee(
  p_job_id uuid,
  p_card_fee_cents integer,
  p_refund_ref text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_cap integer;
  v_fee integer;
BEGIN
  IF p_card_fee_cents IS NULL OR p_card_fee_cents < 0 THEN
    RAISE EXCEPTION 'invalid_fee' USING ERRCODE = '22023';
  END IF;
  SELECT x.id, x.helper_id, x.card_fee_cents INTO r
    FROM public.job_helpr_fault_rulings x WHERE x.job_id = p_job_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'not_helpr_fault' USING ERRCODE = 'PT404';
  END IF;
  -- Billed once: a replay or a second refund never charges the Helpr again.
  IF r.card_fee_cents IS NOT NULL THEN
    RETURN 0;
  END IF;
  SELECT ceil((COALESCE(jb.budget, 0) + COALESCE(jb.customer_fee_amount, 0) + COALESCE(jb.sales_tax_amount, 0)
               + COALESCE(jb.urgent_fee, 0) + COALESCE(jb.onboarding_fee_amount, 0)) * 100)::integer
    INTO v_cap FROM public.jobs jb WHERE jb.id = p_job_id FOR SHARE;
  v_fee := least(p_card_fee_cents, COALESCE(v_cap, 0));
  IF r.helper_id IS NULL AND v_fee > 0 THEN
    -- The Helpr's account is gone. create-payment reads that BEFORE the
    -- refund and then keeps the card fee (owner 2026-10-18: never absorbed)
    -- and bills 0; a Helpr deleted between that read and this bill is a
    -- defect the money owner must see, never silent.
    PERFORM public.log_cron_defect('bill_helpr_fault_card_fee', p_job_id::text,
      format('job %s: the Helpr ruled at fault was deleted while its full refund ran, so the %s-cent card fee the refund returned could not be billed: recover it by hand',
             p_job_id, v_fee));
    v_fee := 0;
  END IF;
  UPDATE public.job_helpr_fault_rulings
     SET card_fee_cents = v_fee, card_fee_remaining_cents = v_fee, refund_ref = left(p_refund_ref, 200)
   WHERE id = r.id;
  IF v_fee > 0 THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (r.helper_id, 'Amount owed added',
            format('A job you were ruled at fault on (a no-show or a backout) was refunded to the person who posted it. $%s is added to what you owe; it comes out of your next payout.',
                   to_char(v_fee / 100.0, 'FM999999990.00')),
            'system_alert', '/profile?tab=earnings');
  END IF;
  RETURN v_fee;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bill_helpr_fault_card_fee(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bill_helpr_fault_card_fee(uuid, integer, text) TO service_role;

