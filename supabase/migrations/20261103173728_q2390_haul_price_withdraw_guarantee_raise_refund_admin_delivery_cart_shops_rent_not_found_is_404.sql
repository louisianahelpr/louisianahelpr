-- Q2390 packet 33 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for twelve functions that still raised P0002:
--   declutter_cancel_haul_away (seller; both raises come at the locked item read
--        and the haul-away lookup, before the job cancel and every UPDATE.
--        haulAwayErrors.ts maps by message.)
--   declutter_set_listing_price (seller; the first raise is at the locked item
--        read, before any write. The second fires when the item's private row
--        is missing, after the items UPDATE; the raise rolls that UPDATE back.
--        api.ts maps by message.)
--   declutter_withdraw_item (seller; raises at the locked item read, before
--        every UPDATE and DELETE.)
--   guarantee_escalate (service_role only; raises at the locked claim read,
--        before any write. Its only caller, the guarantee sweep, reads no code.)
--   declutter_delivery_raise_start (buyer; raises before any write.
--        declutter-checkout already answers PT404 as 404.)
--   declutter_refund_request_to_admin (service_role only; raises at the locked
--        request read, before any write. Its callers: the refund-request sweeps
--        (WHEN OTHERS, any code) and declutter_answer_refund_offer, which
--        passes a request it has just locked.)
--   declutter_seller_delivery_offer (buyer, STABLE, writes nothing. Both raises
--        hide the seller: self, out or blocked. declutter-checkout already
--        answers PT404 as 404.)
--   declutter_remove_cart_item (buyer; raises at the cart line read, before
--        the DELETE.)
--   shops_report_not_received (buyer; raises at the locked order read, before
--        any write. rpcErrorCopy.ts maps by message.)
--   shops_attach_photo (shop owner; raises at the locked shop read, before any
--        write.)
--   rentals_add_rent_payment, rentals_correct_rent_payment (landlord; each
--        raises at the tenancy or locked payment read, before the INSERT/UPDATE.
--        rent.ts maps by message.)
-- No edge map changes, no deploy.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_cancel_haul_away             20261017070827 aa543aacd62b99da3f882b2feedc102f
--   declutter_set_listing_price            20261020064354 233bd48485f86d71509091873b99d504
--   declutter_withdraw_item                20261028223036 4be5e101076e2e142ad637bf60cbc234
--   guarantee_escalate                     20261027200455 b169fcdb780beb89f59fc81313662f6a
--   declutter_delivery_raise_start         20261021185418 9c92ab1b70c1affbab8f9f9e4df1588e
--   declutter_refund_request_to_admin      20261030143141 323a5a3c4554e7e3db7cf5acbd187f53
--   declutter_seller_delivery_offer        20261028200440 bde8b6aa225e2b22acae022ff1018f47
--   declutter_remove_cart_item             20261028221904 2710de64e709e187c9858ba55ccec154
--   shops_report_not_received              20261018211820 e91afc190502fd9c24855fe5b4ee8c1b
--   shops_attach_photo                     20261017061155 7c707eb856ba10fe5ac6f7542bc7b77e
--   rentals_add_rent_payment               20261019073106 878951db9ac935e4d29315a5cccf25a5
--   rentals_correct_rent_payment           20261019073106 72cdabcdcd8b680eb05de2877ea8b7c3
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (15 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod (guarantee_escalate and declutter_refund_request_to_admin
-- service_role only; the rest authenticated, service_role).

CREATE OR REPLACE FUNCTION public.declutter_cancel_haul_away(p_item_id uuid, p_job_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_status text;
  v_hold text;
  v_link public.declutter_haul_aways%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_haul_away');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT i.status INTO v_status FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Lock order: item, job, link row (see the link function).
  SELECT * INTO v_link FROM public.declutter_haul_aways h WHERE h.item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'haul_away_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Post a Job undoing its own failed booking: only a link to THAT job, or
  -- one whose job is already gone (Post a Job deletes it first).
  IF p_job_id IS NOT NULL AND v_link.job_id IS NOT NULL AND v_link.job_id <> p_job_id THEN
    RETURN v_status;
  END IF;
  -- Money held, a checkout that can still be paid, or a job that could still
  -- open one: the haul-away stands.
  v_hold := public.declutter_haul_job_hold(v_link.job_id);
  IF v_hold = 'paying' THEN
    RAISE EXCEPTION 'haul_away_checkout_open' USING ERRCODE = '22023';
  ELSIF v_hold IN ('job_open', 'job_stuck') THEN
    RAISE EXCEPTION 'haul_away_job_open' USING ERRCODE = '22023';
  ELSIF v_hold <> 'none' THEN
    RAISE EXCEPTION 'haul_away_already_booked' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.declutter_haul_aways h WHERE h.item_id = p_item_id FOR UPDATE;

  DELETE FROM public.declutter_haul_aways WHERE item_id = p_item_id;
  -- Only an item the haul-away left off sale comes back; anything an admin
  -- did since (removed) stays. Back on sale only with the 3-12 photos a live
  -- listing needs (row 31): taking it down meanwhile removed them, and it
  -- stays off sale (lh-authz-rls review 2026-10-16 #4).
  IF v_status = 'ended' AND v_link.prior_status = 'live'
     AND (SELECT count(*) FROM public.declutter_item_photos ph WHERE ph.item_id = p_item_id) BETWEEN 3 AND 12 THEN
    UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = p_item_id;
    v_status := 'live';
  END IF;
  RETURN v_status;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_cancel_haul_away(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_cancel_haul_away(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_listing_price(
  p_item_id uuid, p_price_cents integer, p_floor_price_cents integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_stopped boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF p_price_cents IS NULL OR p_price_cents < 100 OR p_price_cents > 100000 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023', HINT = 'The price must be between $1 and $1,000.';
  END IF;
  -- Never above the price it was listed at (authz review 2): raising then cutting
  -- would put a "was" price on the card the item was never really offered at.
  IF p_price_cents > v_item.price_cents THEN
    RAISE EXCEPTION 'price_above_listed'
      USING ERRCODE = '22023', HINT = 'You can lower the price, or raise it back up to the price you listed it at.';
  END IF;
  IF p_floor_price_cents IS NULL OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;

  SELECT p.drops_stopped INTO v_stopped FROM public.declutter_item_private p WHERE p.item_id = p_item_id;

  UPDATE public.declutter_items
     SET current_price_cents = p_price_cents,
         updated_at = now()
   WHERE id = p_item_id;

  -- A floor change re-picks the stop (trg_declutter_item_private_drop_stop).
  UPDATE public.declutter_item_private
     SET floor_price_cents = p_floor_price_cents, updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Prod CHECK declutter_item_private_stop_above_floor: stop > floor. A stop one
  -- cent above a price that sits at the floor still means "never drop" (the
  -- sweep drops only while current > greatest(floor, stop)). Money review 2.
  IF COALESCE(v_stopped, false) THEN
    UPDATE public.declutter_item_private
       SET drop_stop_cents = greatest(p_price_cents, p_floor_price_cents + 1), updated_at = now()
     WHERE item_id = p_item_id;
  END IF;
  RETURN p_price_cents;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_listing_price(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_listing_price(uuid, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_withdraw_item(p_item_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Not the selling gate on purpose: an under-18 or struck member may still
  -- take their own listing down.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- rejected / removed / ended: off sale already, but their photos were
  -- still attached and public by URL (lh-authz-rls review should-fix 2), so
  -- they may be detached too. Reserved / sold / completed are not the
  -- seller's to pull (later slices). 'paused' (board 158) is the seller's own.
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused', 'rejected', 'removed', 'ended') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  -- B46: the listing's open offers close now (buyers told, nothing charged)
  -- instead of later reading "the seller did not answer".
  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item taken down',
      format('The seller took "%s" down, so your offer is closed. Nothing was charged.', v_item.title),
      '/declutter?tab=buying', v_uid);
  END LOOP;

  SELECT COALESCE(array_agg(storage_path ORDER BY position), ARRAY[]::text[]) INTO v_paths
    FROM public.declutter_item_photos WHERE item_id = p_item_id;

  IF v_item.status = 'draft' THEN
    DELETE FROM public.declutter_items WHERE id = p_item_id;
  ELSE
    DELETE FROM public.declutter_item_photos WHERE item_id = p_item_id;
    DELETE FROM public.declutter_watchlist WHERE item_id = p_item_id;
    UPDATE public.declutter_items
       SET status = CASE WHEN v_item.status IN ('pending_review', 'live', 'paused') THEN 'withdrawn' ELSE v_item.status END,
           updated_at = now()
     WHERE id = p_item_id;
  END IF;
  RETURN v_paths;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_withdraw_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_item(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guarantee_escalate(p_claim_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c public.job_guarantee_claims%ROWTYPE;
  v_dispute uuid;
  v_why text;
BEGIN
  SELECT * INTO c FROM public.job_guarantee_claims WHERE id = p_claim_id FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'guarantee_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF c.status = 'disputed' THEN
    RETURN c.dispute_id;
  END IF;
  IF c.status NOT IN ('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating') THEN
    RAISE EXCEPTION 'guarantee_closed' USING ERRCODE = '55000', HINT = 'This Helpr Guarantee request is already closed.';
  END IF;
  -- An 'escalating' claim carries the reason its party's tap recorded.
  p_reason := COALESCE(p_reason, c.close_reason);
  v_why := CASE p_reason
    WHEN 'helpr_cant_fix' THEN 'the Helpr said they can''t fix it'
    WHEN 'helpr_no_answer' THEN 'the Helpr did not answer within 48 hours'
    WHEN 'fix_not_done' THEN 'the fix was not marked done by the day after the fix date'
    WHEN 'poster_rejected_fix' THEN 'the person who posted the job says the fix did not solve it'
    ELSE NULL END;
  IF v_why IS NULL THEN
    RAISE EXCEPTION 'guarantee_bad_reason' USING ERRCODE = '22023';
  END IF;
  -- open_dispute_as's platform branch tells both people "Revision deadline passed — dispute opened", which is
  -- wrong here; guarantee_filing_skips_revision_notice drops exactly that notice while this flag is on.
  PERFORM set_config('app.guarantee_filing', 'on', true);
  v_dispute := public.open_dispute_as(
    c.job_id, NULL,
    left('Helpr Guarantee: ' || v_why || '. The person who posted the job said: ' || btrim(c.note)
         || CASE WHEN c.poster_reject_note IS NOT NULL THEN ' After the fix: ' || btrim(c.poster_reject_note) ELSE '' END
         || ' (Photos are on the Helpr Guarantee request.)', 2000),
    '{}'::text[]);
  PERFORM set_config('app.guarantee_filing', '', true);
  UPDATE public.job_guarantee_claims
     SET status = 'disputed', dispute_id = v_dispute, close_reason = p_reason, closed_at = now(), updated_at = now()
   WHERE id = c.id;
  -- open_dispute_as already wrote the job's "Dispute opened" thread row (the status trigger).
  PERFORM public.guarantee_tell(c.job_id, c.poster_id, 'Your Helpr Guarantee request is now a dispute',
    'An admin will look at your photos and note and decide. A refund, if any, is of the job price.');
  PERFORM public.guarantee_tell(c.job_id, c.helper_id, 'The Helpr Guarantee request is now a dispute',
    'An admin will decide. Your pay stays held until then. You can add your side in the dispute.');
  RETURN v_dispute;
END;
$fn$;

REVOKE ALL ON FUNCTION public.guarantee_escalate(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guarantee_escalate(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_start(p_order_id uuid, p_raise_cents integer)
RETURNS TABLE (raise_id uuid, raise_cents integer, card_fee_cents integer, total_cents integer,
               superseded_session_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  t public.helpr_tasks;
  v_task uuid;
  v_old text;
  v_fee integer;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Anyone but the buyer: item_not_found (never told the order exists).
  IF p_order_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_orders x WHERE x.id = p_order_id AND x.buyer_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_raise_cents IS NULL OR p_raise_cents < 500 OR p_raise_cents % 100 <> 0 THEN
    RAISE EXCEPTION 'invalid_raise' USING ERRCODE = '22023', HINT = 'Raise the pay by whole dollars, at least $5.';
  END IF;
  SELECT od.task_id INTO v_task FROM public.declutter_order_deliveries od WHERE od.order_id = p_order_id;
  IF v_task IS NULL THEN
    RAISE EXCEPTION 'delivery_not_waiting' USING ERRCODE = '55000',
      HINT = 'A Helpr already took this delivery, or it closed.';
  END IF;
  -- Lock order: the order (its items first), then the task: helpr_task_lock's own order.
  t := public.helpr_task_lock(v_task);
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF NOT public.declutter_delivery_raise_open(o, t, 0) THEN
    RAISE EXCEPTION 'delivery_not_waiting' USING ERRCODE = '55000',
      HINT = 'A Helpr already took this delivery, or it closed.';
  END IF;
  IF NOT public.declutter_delivery_raise_open(o, t, 60) THEN
    RAISE EXCEPTION 'raise_too_late' USING ERRCODE = '55000',
      HINT = 'Less than an hour is left to find a Helpr, so the pay can''t be raised now.';
  END IF;
  IF t.raised_cents + p_raise_cents > 15000 THEN
    RAISE EXCEPTION 'raise_limit' USING ERRCODE = '22023',
      HINT = 'The pay can be raised by up to $150 in all on one delivery.';
  END IF;
  UPDATE public.declutter_delivery_raises r SET status = 'superseded', updated_at = now()
   WHERE r.task_id = t.id AND r.status = 'awaiting_payment'
  RETURNING r.stripe_checkout_session_id INTO v_old;
  v_fee := public.declutter_delivery_raise_card_fee_cents(p_raise_cents);
  INSERT INTO public.declutter_delivery_raises (order_id, task_id, raise_cents, card_fee_cents, total_cents)
  VALUES (o.id, t.id, p_raise_cents, v_fee, p_raise_cents + v_fee)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, p_raise_cents, v_fee, p_raise_cents + v_fee, v_old;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_delivery_raise_start(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_start(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_request_to_admin(p_request_id uuid, p_why text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r public.declutter_refund_requests;
  o public.declutter_orders;
  v_problem uuid;
  a record;
BEGIN
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = r.order_id;
  SELECT x.id INTO v_problem FROM public.declutter_problems x WHERE x.order_id = r.order_id AND x.status = 'open';
  IF v_problem IS NULL THEN
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
    VALUES (r.order_id, o.buyer_id, 'buyer', r.reason,
            left(btrim(r.note) || E'\n\n[Refund request: ' || p_why || ']', 1000), COALESCE(r.photo_paths, '{}'))
    RETURNING id INTO v_problem;
    -- Test stuff never reaches an admin (owner 2026-10-30): no alert when either
    -- side is a test account. This can run with no signed-in member, so the
    -- notification gate's auth.uid() rule cannot stand in for it.
    IF NOT (public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
      FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
        PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter refund to decide',
          'A buyer asked for a refund after the handover and the two sides did not agree. The seller''s payout is held until you decide.', '/admin');
      END LOOP;
    END IF;
  ELSE
    -- D2-3: joining a problem already open: the request's photos are added to it (the problem holds up to 6).
    UPDATE public.declutter_problems x
       SET photo_paths = (SELECT COALESCE(array_agg(u.p ORDER BY u.n), '{}') FROM (
             SELECT q.p, min(q.n) AS n FROM unnest(x.photo_paths || COALESCE(r.photo_paths, '{}')) WITH ORDINALITY AS q(p, n)
              GROUP BY q.p ORDER BY min(q.n) LIMIT 6) u)
     WHERE x.id = v_problem AND cardinality(COALESCE(r.photo_paths, '{}')) > 0;
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'to_admin', problem_id = v_problem WHERE id = r.id;
  PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Louisiana Helpr will decide',
    'Your refund request goes to Louisiana Helpr. We look at both sides and decide. The seller isn''t paid until then.',
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Louisiana Helpr will decide',
    'The buyer''s refund request goes to Louisiana Helpr. We look at both sides and decide. Your payout waits until then.',
    '/declutter?view=selling', o.buyer_id);
  RETURN v_problem;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_refund_request_to_admin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_to_admin(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_offer(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_lines uuid[];
  v_rules jsonb := public.declutter_seller_delivery_rules();
  c record;
  v_open uuid;
  v_held timestamptz;
  v_slots timestamptz[] := '{}';
  v_reason text;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_seller_delivery');
  v_uid := public.declutter_assert_member(false);
  IF p_seller_id IS NULL OR p_seller_id = v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_lines := ARRAY(SELECT x.id FROM public.declutter_cart_items x
                    WHERE x.buyer_id = v_uid AND x.seller_id = p_seller_id AND x.status = 'in_cart'
                      AND x.checkout_by > now() ORDER BY x.id);
  -- Nothing from this seller is waiting (audit 2 LO2-1, 20261028200440): an answer, not an error. Asked before
  -- the seller is looked at, so it says nothing about the seller (no schedule or ban oracle).
  IF cardinality(v_lines) = 0 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'cart_empty', 'rate_cents', NULL, 'base_rate_cents', NULL,
      'free_over_cents', NULL, 'items_cents', NULL, 'radius_miles', NULL, 'dropoff_area', NULL,
      'slot_minutes', (v_rules ->> 'slot_minutes')::integer, 'slots', '[]'::jsonb, 'held_slot', NULL);
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO c FROM public.declutter_seller_delivery_check(v_uid, p_seller_id, v_lines);
  SELECT o.id INTO v_open FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment';
  SELECT d.slot_start INTO v_held FROM public.declutter_seller_deliveries d
   WHERE d.order_id = v_open AND d.status = 'held' AND d.held_until > now();
  IF c.reason IS NULL THEN
    v_slots := ARRAY(SELECT s FROM public.declutter_delivery_open_slots(p_seller_id, v_open) s);
  END IF;
  v_reason := COALESCE(c.reason, CASE WHEN cardinality(v_slots) = 0 THEN 'no_times' END);
  RETURN jsonb_build_object(
    'available', v_reason IS NULL,
    'reason', v_reason,
    -- What this order pays (0 = free) and why: the seller's rate, their free-delivery amount,
    -- and this order's items total from the seller (owner 2026-10-27).
    'rate_cents', c.rate_cents,
    'base_rate_cents', c.base_rate_cents,
    'free_over_cents', c.free_over_cents,
    'items_cents', c.items_cents,
    'radius_miles', c.radius_miles,
    'dropoff_area', c.dropoff_area,
    'slot_minutes', (v_rules ->> 'slot_minutes')::integer,
    'slots', to_jsonb(v_slots),
    'held_slot', v_held);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_seller_delivery_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivery_offer(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_remove_cart_item(p_line_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item uuid;
  l record;
  o public.declutter_orders;  -- a row type, so o.id reads NULL when the line has no order
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT c.item_id INTO v_item FROM public.declutter_cart_items c WHERE c.id = p_line_id AND c.buyer_id = v_uid;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i WHERE i.id = v_item FOR UPDATE;
  SELECT c.*, i.title INTO l
    FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.id = p_line_id AND c.buyer_id = v_uid;
  IF l.order_id IS NOT NULL THEN
    SELECT x.* INTO o FROM public.declutter_orders x WHERE x.id = l.order_id FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.id = p_line_id FOR UPDATE;
  SELECT c.status INTO v_status FROM public.declutter_cart_items c WHERE c.id = p_line_id;
  IF v_status = 'removed' THEN
    RETURN 'already';
  END IF;
  IF v_status <> 'in_cart' THEN
    RAISE EXCEPTION 'not_in_cart' USING ERRCODE = '55000', HINT = 'This item is not in your cart any more.';
  END IF;
  IF o.id IS NOT NULL AND o.status = 'awaiting_payment' AND o.stripe_checkout_session_id IS NOT NULL
     AND o.created_at > now() - interval '35 minutes' THEN
    RAISE EXCEPTION 'checkout_open' USING ERRCODE = '55000',
      HINT = 'You opened checkout for this. Close the payment page, then try again in a few minutes.';
  END IF;

  UPDATE public.declutter_cart_items SET status = 'removed', closed_at = now()
   WHERE id = p_line_id AND status = 'in_cart';
  IF o.id IS NOT NULL AND o.status = 'awaiting_payment' THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = o.id AND status = 'awaiting_payment';
    UPDATE public.declutter_cart_items SET order_id = NULL
     WHERE order_id = o.id AND status = 'in_cart';
  END IF;
  IF public.declutter_seller_out(l.seller_id) THEN
    UPDATE public.declutter_items SET status = 'ended', updated_at = now() WHERE id = l.item_id AND status = 'reserved';
  ELSE
    UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = l.item_id AND status = 'reserved';
    PERFORM public.declutter_notify(l.seller_id, 'new_offers', 'Back on sale',
      format('The buyer let "%s" go before checking out. It''s back on sale.', l.title),
      '/declutter?tab=selling', v_uid);
  END IF;
  RETURN 'removed';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_remove_cart_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_cart_item(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_report_not_received(p_order_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  h public.shop_handovers;
  a record;
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say what happened, in under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO h FROM public.shop_handovers WHERE order_id = o.id FOR UPDATE;
  -- Open: a charged order not handed over yet, from its ready date (or the
  -- shop's ready tap). Once the buyer said "I got it" or the clock finished it,
  -- the order is final.
  IF (o.status = 'accepted' AND o.captured_at IS NOT NULL
      AND (public.shop_local_today() >= o.ready_date OR h.ready_at IS NOT NULL)) IS NOT TRUE THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000',
      HINT = 'Only a paid order that is due and not picked up can be reported here.';
  END IF;
  INSERT INTO public.shop_handovers (order_id, problem_at, problem_note) VALUES (o.id, now(), v_note)
  ON CONFLICT (order_id) DO UPDATE SET problem_at = COALESCE(public.shop_handovers.problem_at, now()),
                                       problem_note = COALESCE(public.shop_handovers.problem_note, EXCLUDED.problem_note);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Pickup problem reported',
    format('The buyer says they did not get the order for %s. Louisiana Helpr will look at it before anyone is paid.',
           to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/dashboard', o.buyer_id);
  -- Every admin is told (as Declutter's problem reports, 20261017055502): the money waits for them.
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops pickup problem reported',
      'A buyer says they did not get a paid Shops order. The shop''s payout is held until you decide it.', '/admin');
  END LOOP;
  RETURN jsonb_build_object('result', 'reported', 'order_id', o.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_report_not_received(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_report_not_received(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_attach_photo(p_kind text, p_storage_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
  v_pos smallint;
  v_old text;
  v_id uuid;
  v_constraint text;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT id INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('logo', 'cover', 'gallery') THEN
    RAISE EXCEPTION 'invalid_photo_kind' USING ERRCODE = '22023';
  END IF;
  -- The caller's own shops folder, and the object is really there, uploaded
  -- by the caller, an image (job-photos also takes video, which keeps GPS).
  IF p_storage_path IS NULL
     OR p_storage_path !~ '^[0-9a-f-]{36}/shops/[A-Za-z0-9._-]{1,100}$'
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'gallery' THEN
    SELECT g.p INTO v_pos
      FROM generate_series(0, 11) AS g(p)
     WHERE NOT EXISTS (SELECT 1 FROM public.shop_photos ph
                        WHERE ph.shop_id = v_shop AND ph.photo_kind = 'gallery' AND ph.position = g.p)
     ORDER BY g.p
     LIMIT 1;
    IF v_pos IS NULL THEN
      RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'A shop has at most 12 photos.';
    END IF;
  ELSE
    v_pos := 0;
    DELETE FROM public.shop_photos
     WHERE shop_id = v_shop AND photo_kind = p_kind
     RETURNING storage_path INTO v_old;
  END IF;

  -- A path already attached (to this shop) is bad input, not a raw 23505:
  -- review finding 4. Only the storage_path key maps to it; any other unique
  -- violation (a position clash would be a bug: the shop row is locked FOR
  -- UPDATE above) is re-raised as it is (re-review note 3).
  BEGIN
    INSERT INTO public.shop_photos (shop_id, owner_id, photo_kind, storage_path, position)
    VALUES (v_shop, v_uid, p_kind, p_storage_path, v_pos)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'shop_photos_storage_path_key' THEN
      RAISE EXCEPTION 'photo_already_attached' USING ERRCODE = '22023';
    END IF;
    RAISE;
  END;
  UPDATE public.shops SET updated_at = now() WHERE id = v_shop;
  RETURN jsonb_build_object('id', v_id, 'replaced_path', v_old);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_attach_photo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_attach_photo(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_add_rent_payment(p_tenancy_id uuid, p_amount_cents integer, p_paid_on date, p_method text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_side text;
  v_t public.rental_tenancies%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  v_side := public.rentals_rent_side(p_tenancy_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 1 AND 10000000
     OR p_paid_on IS NULL OR p_paid_on > public.shop_local_today() OR p_paid_on < public.shop_local_today() - 366
     OR p_method IS NULL OR p_method NOT IN ('zelle', 'venmo', 'cashapp', 'cash', 'check', 'money_order', 'other') THEN
    RAISE EXCEPTION 'bad_rent_payment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  -- A tenant's reports still waiting, this one included, total at most what is open now plus one rent
  -- (lead review rounds 2-3 #3/#2): made-up large reports cannot hold off late fees on rows not yet due.
  IF v_side = 'tenant' AND p_amount_cents >
       GREATEST(0, (SELECT COALESCE(sum(amount_cents), 0) FROM public.rental_rent_charges
                     WHERE tenancy_id = p_tenancy_id AND waived_at IS NULL AND due_on <= public.shop_local_today())
                   - (SELECT COALESCE(sum(amount_cents), 0) FROM public.rental_rent_payments
                       WHERE tenancy_id = p_tenancy_id AND status = 'confirmed'))
       + COALESCE((SELECT amount_cents FROM public.rental_rent_plans WHERE tenancy_id = p_tenancy_id), 0)
       -- the tenant's own reports still waiting count against the cap too (lead review round 3 #2)
       - (SELECT COALESCE(sum(amount_cents), 0) FROM public.rental_rent_payments
           WHERE tenancy_id = p_tenancy_id AND status = 'reported' AND reported_by = 'tenant') THEN
    RAISE EXCEPTION 'payment_over_balance' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_rent_payments (tenancy_id, amount_cents, paid_on, pay_method, reported_by, status, decided_at)
  VALUES (p_tenancy_id, p_amount_cents, p_paid_on, p_method, v_side,
          CASE WHEN v_side = 'landlord' THEN 'confirmed' ELSE 'reported' END,
          CASE WHEN v_side = 'landlord' THEN now() END)
  RETURNING id INTO v_id;
  IF v_side = 'tenant' THEN
    PERFORM public.rentals_notify(v_t.landlord_id, 'Rent payment to confirm',
      'Your tenant says they paid ' || to_char(p_amount_cents / 100.0, 'FM$999,999,990.00') || '. Tap Rent received once it reaches you.', '/rentals', false);
  ELSE
    PERFORM public.rentals_notify(v_t.tenant_id, 'Rent received',
      'Your landlord recorded a payment of ' || to_char(p_amount_cents / 100.0, 'FM$999,999,990.00') || '.', '/rentals', false);
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_add_rent_payment(uuid, integer, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_add_rent_payment(uuid, integer, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_correct_rent_payment(p_payment_id uuid, p_action text, p_amount_cents integer,
                                                               p_paid_on date, p_reason text)
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
  v_today date := public.shop_local_today();
  v_money text;
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
  IF v_p.status <> 'confirmed' OR v_p.decided_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'payment_not_correctable' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'reverse' THEN
    UPDATE public.rental_rent_payments
       SET status = 'reversed',
           corrections = corrections || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'action', 'reverse', 'reason', v_reason,
             'from', jsonb_build_object('amount_cents', v_p.amount_cents, 'paid_on', v_p.paid_on)))
     WHERE id = p_payment_id;
    v_money := to_char(v_p.amount_cents / 100.0, 'FM$999,999,990.00');
  ELSIF p_action = 'edit' THEN
    IF p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 1 AND 10000000
       OR p_paid_on IS NULL OR p_paid_on > v_today OR p_paid_on < v_today - 366
       OR (p_amount_cents = v_p.amount_cents AND p_paid_on = v_p.paid_on) THEN
      RAISE EXCEPTION 'bad_rent_payment' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_rent_payments
       SET amount_cents = p_amount_cents, paid_on = p_paid_on,
           corrections = corrections || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'action', 'edit', 'reason', v_reason,
             'from', jsonb_build_object('amount_cents', v_p.amount_cents, 'paid_on', v_p.paid_on),
             'to', jsonb_build_object('amount_cents', p_amount_cents, 'paid_on', p_paid_on)))
     WHERE id = p_payment_id;
    v_money := to_char(p_amount_cents / 100.0, 'FM$999,999,990.00');
  ELSE
    RAISE EXCEPTION 'bad_rent_payment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_p.tenancy_id;
  PERFORM public.rentals_notify(v_t.tenant_id, 'Rent payment changed',
    CASE WHEN p_action = 'reverse'
         THEN 'Your landlord took back the payment of ' || v_money || ' on your rent record: ' || v_reason
         ELSE 'Your landlord corrected a payment on your rent record to ' || v_money || ': ' || v_reason END
      || ' If that is wrong, tap Dispute under Homes -> Renting.',
    '/rentals', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_correct_rent_payment(uuid, text, integer, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_correct_rent_payment(uuid, text, integer, date, text) TO authenticated, service_role;

