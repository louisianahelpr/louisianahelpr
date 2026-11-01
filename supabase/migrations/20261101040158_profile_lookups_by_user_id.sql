-- Three lookups read a member's profile by profiles.id = <the member's auth id>. A member's id is profiles.user_id
-- (handle_new_user inserts user_id = auth.users.id; profiles.id is the row's own generated uuid), so each never
-- matched (lead 10-31):
--   1. sms_phone_prompt_due('has_phone'): members who already gave a phone never got the text-alerts prompt.
--   2. declutter_request_free: the giver's bell always said "A neighbor asked" instead of naming the asker
--      (owner rule: a notice names the person).
--   3. declutter_free_requests_for_item: the giver's list of who asked showed no names (same file, same cause).
-- Each is restated from its NEWEST definition (20261030132841_sms_prompt_for_members_with_a_phone.sql,
-- 20261030064021_declutter_free_requests.sql) verbatim except p.id -> p.user_id. Grants restated as they were.
-- Class guard: src/test/profileLookupsUseUserId.test.ts. PGlite proof: src/test/pglite/profileLookupsByUserId.pglite.mjs.
-- REPLAY-SAFE: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.sms_phone_prompt_due(p_moment text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_moment IS NULL OR p_moment NOT IN ('first_job', 'first_hire', 'has_phone') THEN
    RAISE EXCEPTION 'invalid_moment' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_preferences np
              WHERE np.user_id = v_uid AND np.sms_phone_prompt_dismissed_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  -- A confirmed phone, or a confirmation text waiting for its YES: nothing to ask.
  IF EXISTS (SELECT 1 FROM public.sms_consent c
              WHERE c.user_id = v_uid
                AND (c.sms_opt_in IS TRUE
                     OR (c.pending_phone IS NOT NULL AND c.pending_since > now() - interval '24 hours'))) THEN
    RETURN false;
  END IF;
  IF p_moment = 'has_phone' THEN
    -- The member's own profile phone, as typed (blank or whitespace is no phone).
    RETURN EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.user_id = v_uid AND nullif(btrim(p.phone), '') IS NOT NULL);
  END IF;
  IF p_moment = 'first_job' THEN
    SELECT count(*)::integer INTO v_n FROM public.jobs j WHERE j.customer_id = v_uid;
  ELSE
    SELECT (SELECT count(*) FROM public.jobs j WHERE j.helper_id = v_uid)
         + (SELECT count(*) FROM public.group_job_helpers g WHERE g.helper_id = v_uid)
      INTO v_n;
  END IF;
  RETURN v_n = 1;
END;
$fn$;

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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
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

CREATE OR REPLACE FUNCTION public.declutter_free_requests_for_item(p_item_id uuid)
 RETURNS TABLE(request_id uuid, requester_id uuid, display_name text, avg_rating numeric, review_count integer, created_at timestamptz)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT r.id, r.requester_id, public.member_display_name(p.full_name, 'A neighbor'),
           s.avg_rating, s.review_count, r.created_at
      FROM public.declutter_free_requests r
      LEFT JOIN public.profiles p ON p.user_id = r.requester_id
      LEFT JOIN LATERAL (SELECT g.avg_rating, g.review_count FROM public.get_public_profile_stats(ARRAY[r.requester_id]) g LIMIT 1) s ON true
     WHERE r.item_id = p_item_id AND r.status = 'open'
       AND NOT public.are_users_blocked(v_uid, r.requester_id)
     ORDER BY r.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.sms_phone_prompt_due(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sms_phone_prompt_due(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_request_free(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_request_free(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_free_requests_for_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_free_requests_for_item(uuid) TO authenticated, service_role;
