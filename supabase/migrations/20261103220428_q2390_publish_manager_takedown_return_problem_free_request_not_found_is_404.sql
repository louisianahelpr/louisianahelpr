-- Q2390 packet 35 (REGULAR packet: lead review): "not found" answers HTTP 404, not 500, for six Declutter functions
-- that still raised P0002 (owner rule 11-03: Jobs and Declutter first; no testers-only features). Each raise comes at
-- the function's first locked read or existence check, BEFORE any write:
--   declutter_publish_item (seller; the item read), declutter_manager_offer (seller; the manager does not exist, is the
--   seller, or is null), declutter_admin_take_down_item (admin; the item read), declutter_return_dropped_off (buyer, 2;
--   the refund request read), declutter_problem_add_side (2; the problem read), declutter_request_free (the item read).
-- The app maps all six by message (lifecycleErrors.ts, adminRpcErrorCopy.ts); no edge function reads their code.
-- No edge map changes, no deploy. PostgREST maps P0002 to 500; RAISE ... USING ERRCODE = 'PT404' answers 404.
--
-- Each is restated VERBATIM from its newest migration copy, whose md5(prosrc) equals prod (read 2026-11-03 by
-- Builder 72; 1 overload each; grants as prod: authenticated, service_role). The ONLY change: ERRCODE 'P0002' ->
-- 'PT404'.
--   declutter_publish_item          20261031152545 9a2cecab495647b2ed8d1794a0f92374
--   declutter_manager_offer         20261101181005 60af5a23d59d9e53cfb338b5d1513e5f
--   declutter_admin_take_down_item  20261030071816 42b1ed15d2d90419eede34fe4992467b
--   declutter_return_dropped_off    20261030164712 c6b5f0eee569e879b28f76504d44ce7d
--   declutter_problem_add_side      20261029225634 c239afab8fa72b275d71e92dcaf9da6f
--   declutter_request_free          20261101040158 1e27dab96196536f2dbb7cac739e2608

-- declutter_publish_item: restated from 20261031152545_declutter_check_after_post.sql.
CREATE OR REPLACE FUNCTION public.declutter_publish_item(p_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_floor integer;
  v_ai_checked timestamptz;
  v_ai_flag text;
  v_photos integer;
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_a_draft' USING ERRCODE = '22023';
  END IF;
  IF v_item.sale_mode <> 'offers' THEN
    -- Row 55: bidding waits for the auctioneer licence.
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;

  -- Row 23 (payout setup before the first listing) is dropped (owner
  -- 2026-10-27, "list first, set up at first sale"): a paid order makes the
  -- seller eligible to set up, and the payout waits until they have.

  SELECT count(*)::integer INTO v_photos FROM public.declutter_item_photos WHERE item_id = p_item_id;
  IF v_photos < 1 OR v_photos > 12 THEN
    RAISE EXCEPTION 'photos_required'
      USING ERRCODE = '22023', HINT = 'Add at least 1 photo (up to 12).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.declutter_tax_attestations a WHERE a.item_id = p_item_id AND a.seller_id = v_uid) THEN
    RAISE EXCEPTION 'attestation_required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = v_uid) THEN
    RAISE EXCEPTION 'pickup_windows_required' USING ERRCODE = '22023';
  END IF;

  SELECT floor_price_cents, ai_checked_at, ai_flag_reason INTO v_floor, v_ai_checked, v_ai_flag
    FROM public.declutter_item_private WHERE item_id = p_item_id FOR UPDATE;
  IF v_floor IS NULL OR v_floor > v_item.current_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price' USING ERRCODE = '22023';
  END IF;

  -- Owner 2026-10-29 (item B): a listing goes live when it is posted. Only a
  -- failed automatic check holds it for an admin: flagged, or never came back
  -- (fail-safe, B19). Row 33's "first 3 listings wait for an admin" is gone.
  -- LEAD-POST-SLOW (owner 2026-10-31, "nothing slow for users, under 2 s"): the automatic check now runs right
  -- AFTER Post (declutter_record_ai_check judges a live, unchecked listing). Only a check that already flagged
  -- it holds it here; one that never comes back is held by declutter_hold_unchecked_listings (fail-safe, B19).
  v_status := CASE
    WHEN v_ai_checked IS NOT NULL AND v_ai_flag IS NOT NULL THEN 'pending_review'
    ELSE 'live'
  END;

  UPDATE public.declutter_items
     SET status = v_status,
         submitted_at = now(),
         live_at = CASE WHEN v_status = 'live' THEN now() END,
         updated_at = now()
   WHERE id = p_item_id;
  RETURN v_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_publish_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_publish_item(uuid) TO authenticated, service_role;

-- declutter_manager_offer: restated from 20261101181005_declutter_manager_mode.sql.
CREATE OR REPLACE FUNCTION public.declutter_manager_offer(
  p_manager uuid,
  p_share_type text,
  p_share_value integer,
  p_can_list boolean,
  p_can_prices boolean,
  p_can_offers boolean,
  p_can_messages boolean,
  p_can_pickups boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_id uuid;
  v_seller text;
  v_share text;
  v_parts text;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_manager IS NULL OR p_manager = v_uid OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_manager) THEN
    RAISE EXCEPTION 'manager_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF public.are_users_blocked(v_uid, p_manager) THEN
    RAISE EXCEPTION 'manager_blocked' USING ERRCODE = '42501';
  END IF;
  IF p_share_type NOT IN ('percent', 'flat') OR p_share_value IS NULL OR p_share_value < 0
     OR (p_share_type = 'percent' AND p_share_value > 100)
     OR (p_share_type = 'flat' AND p_share_value > 1000000) THEN
    RAISE EXCEPTION 'invalid_share' USING ERRCODE = '22023',
      HINT = 'Pick a percent from 0 to 100, or a dollar amount per sold item.';
  END IF;
  IF NOT (COALESCE(p_can_list, false) OR COALESCE(p_can_prices, false) OR COALESCE(p_can_offers, false)
          OR COALESCE(p_can_messages, false) OR COALESCE(p_can_pickups, false)) THEN
    RAISE EXCEPTION 'no_parts_chosen' USING ERRCODE = '22023', HINT = 'Choose at least one thing for them to handle.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_manager_grants WHERE seller_id = v_uid AND status IN ('offered', 'active')) THEN
    RAISE EXCEPTION 'already_has_manager' USING ERRCODE = '23505',
      HINT = 'End your current manager (or take back your offer) first.';
  END IF;

  INSERT INTO public.declutter_manager_grants (seller_id, manager_id, share_type, share_pct, share_cents,
    can_list, can_prices, can_offers, can_messages, can_pickups)
  VALUES (v_uid, p_manager, p_share_type,
    CASE WHEN p_share_type = 'percent' THEN p_share_value END,
    CASE WHEN p_share_type = 'flat' THEN p_share_value END,
    COALESCE(p_can_list, false), COALESCE(p_can_prices, false), COALESCE(p_can_offers, false),
    COALESCE(p_can_messages, false), COALESCE(p_can_pickups, false))
  RETURNING id INTO v_id;

  v_seller := public.declutter_manager_first_name(v_uid);
  v_share := CASE WHEN p_share_type = 'percent' THEN p_share_value::text || '% of each sale'
                  ELSE '$' || to_char(p_share_value / 100.0, 'FM999990.00') || ' per item sold' END;
  v_parts := array_to_string(ARRAY_REMOVE(ARRAY[
    CASE WHEN p_can_list THEN 'listing' END, CASE WHEN p_can_prices THEN 'prices' END,
    CASE WHEN p_can_offers THEN 'offers' END, CASE WHEN p_can_messages THEN 'messages' END,
    CASE WHEN p_can_pickups THEN 'pickups' END], NULL), ', ');
  PERFORM public.declutter_notify(p_manager, 'declutter_listings',
    v_seller || ' asked you to manage their Declutter',
    format('%s asked you to handle %s for %s. Open it to accept or decline.', v_seller, v_parts, v_share),
    '/declutter?tab=managing', v_uid);
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_manager_offer(uuid, text, integer, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manager_offer(uuid, text, integer, boolean, boolean, boolean, boolean, boolean) TO authenticated, service_role;

-- declutter_admin_take_down_item: restated from 20261030071816_declutter_live_on_post.sql.
CREATE OR REPLACE FUNCTION public.declutter_admin_take_down_item(p_item_id uuid, p_note text, p_report_id uuid DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required'
      USING ERRCODE = '22023', HINT = 'Say why the listing is taken down.';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- As declutter_admin_review_item: an admin never decides on their own listing.
  IF v_item.seller_id = v_uid THEN
    RAISE EXCEPTION 'own_listing' USING ERRCODE = '42501', HINT = 'Another admin must decide on your own listing.';
  END IF;
  -- Reserved / sold / completed have a buyer and money in play: those go through
  -- the order's problem case, never a take-down.
  IF v_item.status NOT IN ('live', 'paused', 'pending_review') THEN
    RAISE EXCEPTION 'item_not_removable' USING ERRCODE = '22023';
  END IF;
  -- The report, when the take-down comes from one, must be about this listing.
  IF p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports rp
        WHERE rp.id = p_report_id AND rp.reported_type = 'declutter_item' AND rp.reported_id = p_item_id) THEN
    RAISE EXCEPTION 'report_not_for_item' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Item taken down',
      format('"%s" was taken down, so your offer is closed. Nothing was charged.', v_item.title),
      '/declutter?tab=buying', v_uid);
  END LOOP;

  UPDATE public.declutter_items SET status = 'removed', updated_at = now() WHERE id = p_item_id;
  UPDATE public.declutter_item_private SET review_note = v_note, updated_at = now() WHERE item_id = p_item_id;
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_listing_taken_down', 'declutter_item', p_item_id::text,
          jsonb_build_object('note', v_note, 'report_id', p_report_id, 'was', v_item.status));

  PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your listing was taken down',
    format('"%s" was taken down: %s', COALESCE(v_item.title, 'Your item'), v_note),
    '/declutter/item/' || p_item_id::text, v_uid);
  RETURN 'removed';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_admin_take_down_item(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_take_down_item(uuid, text, uuid) TO authenticated, service_role;

-- declutter_return_dropped_off: restated from 20261030164712_declutter_porch_places.sql.
CREATE OR REPLACE FUNCTION public.declutter_return_dropped_off(p_request_id uuid, p_photo_path text, p_lat numeric,
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
  v_m integer;
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
  IF r.status <> 'returning' OR r.return_way IS DISTINCT FROM 'drop_off' THEN
    RAISE EXCEPTION 'not_a_drop_off' USING ERRCODE = '55000';
  END IF;
  IF r.return_dropped_off_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_dropped_off');
  END IF;
  IF (now() AT TIME ZONE 'America/Chicago')::date < r.return_day THEN
    RAISE EXCEPTION 'before_return_day' USING ERRCODE = '55000',
      HINT = 'You can drop it off from the day the seller picked.';
  END IF;
  IF NOT public.declutter_return_photo_ok(o.id, v_uid, p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
  IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
    RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
      HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
  END IF;
  -- At the address (20261028235709): within 200 m of the NEAREST pickup point of the ORDER (Q2486, D-NEW14): the porch
  -- place frozen on it at checkout, else (an order with no place) every item's own point, as before.
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  SELECT min(round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat - pt.lat) / 2)), 2)
           + cos(radians(pt.lat)) * cos(radians(p_lat)) * power(sin(radians((p_lng - pt.lng) / 2)), 2)))))::integer)
    INTO v_m
    FROM public.declutter_order_pickup_points(o.id) pt;
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the seller''s pickup address.';
  END IF;
  UPDATE public.declutter_refund_requests SET return_photo_path = p_photo_path, return_dropped_off_at = now()
   WHERE id = r.id;
  PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'The buyer brought the item back',
    'The buyer left the item at your pickup address and took a photo. Check it, then tap "I got it back" to send the refund.',
    '/declutter?view=selling', v_uid);
  RETURN jsonb_build_object('result', 'dropped_off', 'distance_m', v_m);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_return_dropped_off(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_return_dropped_off(uuid, text, numeric, numeric) TO authenticated, service_role;

-- declutter_problem_add_side: restated from 20261029225634_declutter_problem_both_sides_and_photos.sql.
CREATE OR REPLACE FUNCTION public.declutter_problem_add_side(p_problem_id uuid, p_note text, p_photo_paths text[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  p public.declutter_problems;
  v_side text;
  v_path text;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Lock order: the order first, then the problem, as the decision does.
  o := public.declutter_lock_order(v_order);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  -- Only the OTHER side of the sale (never the reporter, never a stranger, who is not told it exists).
  IF v_side IS NULL OR v_side NOT IN ('buyer', 'seller') THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p.reporter_id IS NOT DISTINCT FROM v_uid OR p.reporter_side = v_side THEN
    RAISE EXCEPTION 'problem_side_is_yours' USING ERRCODE = '55000',
      HINT = 'You reported this problem. Louisiana Helpr is looking at it.';
  END IF;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell Louisiana Helpr your side (up to 1,000 characters).';
  END IF;
  IF cardinality(COALESCE(p_photo_paths, '{}')) > 3 THEN
    RAISE EXCEPTION 'too_many_problem_photos' USING ERRCODE = '22023', HINT = 'Add up to 3 photos.';
  END IF;
  FOREACH v_path IN ARRAY COALESCE(p_photo_paths, '{}') LOOP
    IF v_path IS NULL
       OR split_part(v_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(v_path, '/', 3) IS DISTINCT FROM 'problem'
       OR split_part(v_path, '/', 4) IS DISTINCT FROM o.id::text
       OR split_part(v_path, '/', 5) = ''
       OR split_part(v_path, '/', 6) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = v_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- One side per problem; sent again before the decision, it replaces the earlier words and photos.
  UPDATE public.declutter_problems
     SET other_side_note = btrim(p_note), other_side_photo_paths = COALESCE(p_photo_paths, '{}'), other_side_at = now()
   WHERE id = p.id;
  IF p.reporter_id IS NOT NULL THEN
    PERFORM public.declutter_notify(p.reporter_id, 'declutter_refunds', 'The other side answered',
    format('The %s added their side to the problem with %s. Louisiana Helpr reads both before it decides.',
           v_side, public.declutter_order_items_named(o.id)),
    '/declutter?view=' || CASE WHEN v_side = 'seller' THEN 'cart' ELSE 'selling' END, v_uid);
  END IF;
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'info', 'Declutter problem: the other side answered',
      'The other side of a reported Declutter problem added their side. It is in the problem case.', '/admin');
  END LOOP;
  RETURN jsonb_build_object('result', 'added', 'problem_id', p.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_problem_add_side(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_problem_add_side(uuid, text, text[]) TO authenticated, service_role;

-- declutter_request_free: restated from 20261101040158_profile_lookups_by_user_id.sql.
CREATE OR REPLACE FUNCTION public.declutter_request_free(p_item_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_seller uuid;
  v_price integer;
  v_status text;
  v_mode text;
  v_seed boolean;
  v_title text;
  v_open integer;
  v_until timestamptz;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  SELECT i.seller_id, i.current_price_cents, i.status, i.sale_mode, i.is_seed, i.title
    INTO v_seller, v_price, v_status, v_mode, v_seed, v_title
    FROM public.declutter_items i WHERE i.id = p_item_id FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('live', 'reserved')
     OR public.are_users_blocked(v_seller, v_uid)
     OR public.declutter_seller_out(v_seller)
     OR (v_seed AND public.seed_hidden_for(v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  IF v_mode <> 'offers' THEN
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_price <> 0 THEN
    RAISE EXCEPTION 'not_free' USING ERRCODE = '22023', HINT = 'This item is not free any more. Check its price.';
  END IF;
  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;
  -- The 30-day pause after a missed free pickup (owner 2026-10-29).
  SELECT p.free_blocked_until INTO v_until FROM public.declutter_free_pauses p
   WHERE p.user_id = v_uid AND p.free_blocked_until > now();
  IF FOUND THEN
    RAISE EXCEPTION 'free_paused' USING ERRCODE = '42501',
      HINT = format('You can ask for free items again on %s.',
                    to_char(v_until AT TIME ZONE 'America/Chicago', 'FMMonth FMDD'));
  END IF;
  -- Serialised per member: the same advisory lock the old claim used.
  PERFORM pg_advisory_xact_lock(hashtextextended('declutter_free_claims:' || v_uid::text, 0));
  SELECT r.id INTO v_id FROM public.declutter_free_requests r
   WHERE r.item_id = p_item_id AND r.requester_id = v_uid AND r.status = 'open';
  IF FOUND THEN
    RETURN v_id;
  END IF;
  -- At most 3 at a time: open asks + free lines still waiting for a pickup choice + free pickups not done yet.
  SELECT (SELECT count(*) FROM public.declutter_free_requests r WHERE r.requester_id = v_uid AND r.status = 'open')
       + (SELECT count(*) FROM public.declutter_cart_items c
           WHERE c.buyer_id = v_uid AND c.price_cents = 0 AND c.status = 'in_cart' AND c.checkout_by > now())
       + (SELECT count(*) FROM public.declutter_cart_items c JOIN public.declutter_orders o ON o.id = c.order_id
           WHERE c.buyer_id = v_uid AND c.status = 'paid' AND o.status = 'paid' AND o.paid_with = 'free')
    INTO v_open;
  IF v_open >= (public.declutter_free_rules() ->> 'max_open_claims')::integer THEN
    RAISE EXCEPTION 'free_claim_limit' USING ERRCODE = '54000',
      HINT = 'You have 3 free items asked for or waiting. Pick those up or take back an ask first.';
  END IF;
  INSERT INTO public.declutter_free_requests (item_id, requester_id, seller_id)
  VALUES (p_item_id, v_uid, v_seller)
  RETURNING id INTO v_id;
  -- Named, never "Someone" (owner 2026-10-21): the giver sees who asked on the item page anyway.
  PERFORM public.declutter_notify(v_seller, 'declutter_offers', 'New request for your free item',
    format('%s asked for "%s". Open it to see who asked and pick who gets it.',
           COALESCE((SELECT public.member_display_name(p.full_name, 'A neighbor') FROM public.profiles p WHERE p.user_id = v_uid), 'A neighbor'), v_title),
    '/declutter/item/' || p_item_id::text, v_uid);
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_request_free(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_request_free(uuid) TO authenticated, service_role;
