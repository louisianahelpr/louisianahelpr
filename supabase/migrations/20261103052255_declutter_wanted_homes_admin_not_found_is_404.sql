-- Q2390 packet 10: "not found" answers HTTP 404, not 500, for nineteen
-- member-callable functions (Declutter listing, wanted and porch steps,
-- manager approvals, admin review and wanted tools, Shops admin and pickup
-- address, Homes invites and repair requests, a Helpr task release).
-- None moves money, deletes rows, creates an order or sits on the checkout
-- path; no edge function calls them.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-02, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_admin_problem_case           20261101020052 13318d50883b29d43a0f506885b4cbea
--   declutter_item_address                 20261031004529 4420f638bea9e0b6ca253debac2a5492
--   declutter_ask_question                 20261020033623 db8565ae15692506d4c04a65a5a5f6df
--   shops_admin_set_hidden                 20261017061155 bada7a4f92bcbdc4a19e58cfbc72aed8
--   shops_save_my_pickup_address           20261018210400 b941957969808478c8971c8236ee0950
--   declutter_pause_listing                20261028223036 356db78ee008cca77263ee98f2bff618
--   declutter_reopen_wanted                20261030221255 0f33efa078d6f1022b9b303dceb89ca8
--   rentals_accept_invite                  20261017205605 c5cd8ac6e96f9c062a779a7086d23c88
--   shops_admin_give_strike                20261019071055 a4c03a0de8f1183ecbcad0d2fc370ff9
--   declutter_porch_note                   20261021023158 9c1d3f859dbfefa84ad234bbb99f9d31
--   declutter_order_pickup_windows         20261031171727 f589562be0b8bde5d66a24124d866d21
--   rentals_decline_request                20261017205605 c786f90fb33c582caabbc97a5ec586a3
--   declutter_manager_send_back            20261101181005 f5914abc0d564ce5e691a78a8253c960
--   declutter_admin_remove_review          20261102040000 96f2ba1f316a51d06baeb329854da4ea
--   helpr_task_release                     20261031102758 4870c3c91903d1ac7585bed5e8692fb9
--   declutter_manager_approve              20261101181005 27e4e5d5f02a22b02eaea3f193289e7a
--   declutter_set_keep_up                  20261029154323 f21776a8f1467fc9031b41164d1a405c
--   declutter_admin_release_wanted_photos  20261102015348 ed4fb8dc9d295daa0469baa2d84e8a92
--   declutter_admin_take_down_wanted       20261030225143 2042bea93d8765df72fc171fca4ce8a2
--
-- Grants restated as on prod: EXECUTE to authenticated and service_role only.

CREATE OR REPLACE FUNCTION public.declutter_admin_problem_case(p_problem_id uuid)
RETURNS TABLE(handover text, order_status text, slot_start timestamptz, pickup_day date,
  seller_delivery_status text, seller_delivery_slot_start timestamptz, seller_delivered_at timestamptz,
  helpr_accepted_at timestamptz, helpr_picked_up_at timestamptz, helpr_pickup_photo_path text,
  helpr_delivered_at timestamptz, helpr_dropoff_photo_path text, helpr_dropoff_distance_m integer,
  helpr_has_delivery_strike boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.id = p_problem_id) THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
    SELECT o.handover, o.status, b.slot_start, b.pickup_day,
           sd.status, sd.slot_start, sd.delivered_at,
           t.accepted_at, t.picked_up_at, t.pickup_photo_path,
           t.delivered_at, t.dropoff_photo_path, t.dropoff_distance_m,
           -- CHANGED (B48): the same test helpr_task_give_job_strike uses to refuse a second one.
           (t.id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.user_violations v
               WHERE v.user_id = COALESCE(t.helpr_id, t.released_helpr_id)
                 AND v.violation_type = 'delivery_no_show'
                 AND v.description LIKE '%(task ' || t.id::text || ')'))
      FROM public.declutter_problems p
      JOIN public.declutter_orders o ON o.id = p.order_id
      LEFT JOIN public.declutter_bookings b ON b.order_id = o.id
      LEFT JOIN public.declutter_seller_deliveries sd ON sd.order_id = o.id
      LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id
      LEFT JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE p.id = p_problem_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_admin_problem_case(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_problem_case(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_item_address(p_item_id uuid)
 RETURNS TABLE(pickup_address text, pickup_lat numeric, pickup_lng numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_access text := public.declutter_address_access(p_item_id, (SELECT auth.uid()));
  v_pp public.declutter_order_porch_places%ROWTYPE;
BEGIN
  -- CHANGED (lead 10-30): closed on a held sale: no rows.
  IF v_access = 'held_closed' THEN
    RETURN;
  END IF;
  IF v_access IS DISTINCT FROM 'paid_buyer' AND NOT public.declutter_in_agreed_sale(p_item_id, (SELECT auth.uid())) THEN
    PERFORM public.require_feature('declutter');
  END IF;
  IF v_access IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- D-NEW14 (20261030164712): the paid buyer of an order with a frozen porch place gets THAT place only, never the
  -- item's own address or the seller's other places.
  IF v_access = 'paid_buyer' THEN
    SELECT pp.* INTO v_pp
      FROM public.declutter_cart_items c
      JOIN public.declutter_orders o ON o.id = c.order_id
      JOIN public.declutter_order_porch_places pp ON pp.order_id = o.id
     WHERE c.item_id = p_item_id AND c.status = 'paid' AND o.status = 'paid' AND o.buyer_id = (SELECT auth.uid())
     ORDER BY o.paid_at DESC NULLS LAST LIMIT 1;
    IF v_pp.order_id IS NOT NULL THEN
      RETURN QUERY SELECT v_pp.address, v_pp.lat, v_pp.lng;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY
    SELECT p.pickup_address, p.pickup_lat, p.pickup_lng
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_item_address(p_item_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_item_address(p_item_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_ask_question(p_item_id uuid, p_question text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_seller uuid;
  v_seed boolean;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(false);
  v_uid := (SELECT auth.uid());

  SELECT seller_id, is_seed INTO v_seller, v_seed FROM public.declutter_items
   WHERE id = p_item_id AND status IN ('live', 'reserved');
  -- A member the seller blocked (or who blocked the seller) does not see
  -- the item to act on it; nor does a real member a test listing.
  IF NOT FOUND OR public.are_users_blocked(v_seller, v_uid)
     OR (v_seed AND public.seed_hidden_for(v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  -- One asker at a time, so parallel calls cannot all pass the cap.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_ask:' || v_uid::text));
  IF (SELECT count(*) FROM public.declutter_questions q
       WHERE q.asker_id = v_uid AND q.created_at > now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION 'question_rate_limited' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.declutter_questions (item_id, asker_id, question)
  VALUES (p_item_id, v_uid, btrim(p_question))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_ask_question(p_item_id uuid, p_question text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_ask_question(p_item_id uuid, p_question text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_admin_set_hidden(p_shop_id uuid, p_hidden boolean, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_hidden IS NULL THEN
    RAISE EXCEPTION 'invalid_hidden' USING ERRCODE = '22023';
  END IF;
  IF p_hidden AND (p_reason IS NULL OR char_length(btrim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'hide_reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT owner_id INTO v_owner FROM public.shops WHERE id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops
     SET hidden_at = CASE WHEN p_hidden THEN now() END,
         hidden_by = CASE WHEN p_hidden THEN v_uid END,
         hidden_reason = CASE WHEN p_hidden THEN left(btrim(p_reason), 500) END,
         updated_at = now()
   WHERE id = p_shop_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_hidden THEN 'shop_hidden' ELSE 'shop_unhidden' END, 'shop', p_shop_id::text,
          jsonb_build_object('reason', p_reason));
  RETURN p_hidden;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_admin_set_hidden(p_shop_id uuid, p_hidden boolean, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_set_hidden(p_shop_id uuid, p_hidden boolean, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_save_my_pickup_address(
  p_line1 text, p_line2 text, p_city text, p_postal_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
BEGIN
  -- The same gates as M1's shops_set_cancel_policy: the switch, not banned,
  -- an eligible shop owner (shops_assert_owner_eligible raises its own codes).
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT s.id INTO v_shop FROM public.shops s WHERE s.owner_id = v_uid;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 3 AND 120
     OR (p_line2 IS NOT NULL AND btrim(p_line2) <> '' AND char_length(btrim(p_line2)) > 120)
     OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'invalid_pickup_address' USING ERRCODE = '22023';
  END IF;
  IF p_postal_code IS NULL OR btrim(p_postal_code) !~ '^7[01][0-9]{3}$' THEN
    RAISE EXCEPTION 'pickup_address_not_in_louisiana' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shop_pickup_addresses (shop_id, owner_id, line1, line2, city, postal_code)
  VALUES (v_shop, v_uid, btrim(p_line1), NULLIF(btrim(coalesce(p_line2, '')), ''), btrim(p_city), btrim(p_postal_code))
  ON CONFLICT (shop_id) DO UPDATE
    SET line1 = EXCLUDED.line1, line2 = EXCLUDED.line2, city = EXCLUDED.city, postal_code = EXCLUDED.postal_code;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_save_my_pickup_address(p_line1 text, p_line2 text, p_city text, p_postal_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_save_my_pickup_address(p_line1 text, p_line2 text, p_city text, p_postal_code text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_pause_listing(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Not the selling gate on purpose (as withdraw): anyone may hide their own listing.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  -- Open offers close now (as withdraw, B46): the buyer is told, nothing charged.
  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item paused',
      format('The seller paused "%s", so your offer is closed. Nothing was charged.', v_item.title),
      '/declutter?tab=buying', v_uid);
  END LOOP;

  UPDATE public.declutter_items SET status = 'paused', updated_at = now() WHERE id = p_item_id;
  RETURN 'paused';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_pause_listing(p_item_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_pause_listing(p_item_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_reopen_wanted(p_wanted_id uuid)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_w public.declutter_wanted%ROWTYPE;
  v_until timestamptz := now() + interval '30 days';
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
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_post:' || v_uid::text));
  SELECT * INTO v_w FROM public.declutter_wanted WHERE id = p_wanted_id AND user_id = v_uid AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_w.status = 'open' AND v_w.expires_at > now() THEN
    RETURN v_w.expires_at;
  END IF;
  IF (SELECT count(*) FROM public.declutter_wanted w
       WHERE w.user_id = v_uid AND w.status = 'open' AND w.expires_at > now()) >= 10 THEN
    RAISE EXCEPTION 'wanted_open_limit'
      USING ERRCODE = '42501', HINT = 'You have 10 open wanted posts. Close one to post another.';
  END IF;
  UPDATE public.declutter_wanted
     SET status = 'open', closed_at = NULL, expires_at = v_until, expiry_told_at = NULL
   WHERE id = p_wanted_id;
  FOR r IN SELECT * FROM public.declutter_wanted_pairs(NULL, p_wanted_id, false) LOOP
    v_told := v_told + public.declutter_wanted_record_match(r.wanted_id, r.item_id, v_told < 20, false);
  END LOOP;
  RETURN v_until;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_reopen_wanted(p_wanted_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_reopen_wanted(p_wanted_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_accept_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_existing uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies
   WHERE invite_token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   FOR UPDATE;
  IF NOT FOUND OR v_t.status <> 'invited' OR v_t.invite_expires_at <= now() THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_t.landlord_id = v_uid THEN
    RAISE EXCEPTION 'own_invite' USING ERRCODE = '22023';
  END IF;
  SELECT o.id INTO v_existing FROM public.rental_tenancies o
   WHERE o.unit_id = v_t.unit_id AND o.tenant_id = v_uid AND o.status = 'active';
  IF v_existing IS NOT NULL THEN
    -- Already living there: the link is spent either way.
    UPDATE public.rental_tenancies SET status = 'revoked', ended_at = now() WHERE id = v_t.id;
    RETURN v_existing;
  END IF;
  UPDATE public.rental_tenancies SET tenant_id = v_uid, status = 'active', accepted_at = now()
   WHERE id = v_t.id;
  PERFORM public.rentals_notify(v_t.landlord_id, 'Tenant joined',
    'A tenant accepted your invite and can now send maintenance requests.', '/rentals', false);
  RETURN v_t.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_accept_invite(p_token text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_accept_invite(p_token text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_admin_give_strike(p_order_id uuid, p_side text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  o public.shop_orders;
  v_user uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_side IS NULL OR p_side NOT IN ('buyer', 'shop') THEN
    RAISE EXCEPTION 'invalid_side' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_user := CASE WHEN p_side = 'buyer' THEN o.buyer_id ELSE o.seller_id END;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'member_gone' USING ERRCODE = '55000';
  END IF;
  v_id := public.shop_give_strike(v_user, p_side, 'admin_strike', o.id);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'strike_exists' USING ERRCODE = '23505', HINT = 'That side already has an admin strike for this order.';
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shops_admin_give_strike', 'shop_strike', v_id::text,
          jsonb_build_object('order_id', o.id, 'side', p_side, 'user_id', v_user, 'note', v_note));
  RETURN jsonb_build_object('result', 'given', 'strike_id', v_id, 'active', public.shop_active_strike_count(v_user));
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_admin_give_strike(p_order_id uuid, p_side text, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_give_strike(p_order_id uuid, p_side text, p_note text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_porch_note(p_order_id uuid, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_note text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Refuse a huge input before normalising it (lh-authz-rls review #5).
  IF char_length(coalesce(p_note, '')) > 1000 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023', HINT = 'Keep it to 200 letters.';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  -- Never say whether someone else's order exists.
  IF o.id IS NULL OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'photo_first' USING ERRCODE = '55000', HINT = 'Take the porch photo first.';
  END IF;
  v_note := NULLIF(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023', HINT = 'Keep it to 200 letters.';
  END IF;
  UPDATE public.declutter_handovers SET set_out_note = v_note WHERE order_id = o.id;
  RETURN v_note;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_porch_note(p_order_id uuid, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_note(p_order_id uuid, p_note text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_order_pickup_windows(p_order_id uuid)
RETURNS TABLE(weekday smallint, starts time, ends time, latest_pickup_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_hours jsonb;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL
     OR NOT (
          (o.buyer_id = v_uid AND o.status = 'paid')
       OR o.seller_id = v_uid
       OR EXISTS (SELECT 1 FROM public.helpr_tasks t
                   WHERE t.source_kind = 'declutter_delivery' AND t.source_id = o.id AND t.helpr_id = v_uid
                     AND t.status IN ('accepted', 'picked_up', 'delivered', 'confirmed'))) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT op.windows INTO v_hours FROM public.declutter_order_porch_places op WHERE op.order_id = o.id;
  IF v_hours IS NOT NULL THEN
    RETURN QUERY
      SELECT (e ->> 'weekday')::smallint, (e ->> 'starts')::time, (e ->> 'ends')::time, o.paid_at + interval '7 days'
        FROM jsonb_array_elements(v_hours) e
       ORDER BY 1, 2;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT w.weekday, w.starts_local, w.ends_local, o.paid_at + interval '7 days'
      FROM public.declutter_pickup_windows w
     WHERE w.seller_id = o.seller_id
       -- Review 2026-10-31 #2: a porch order with no frozen place keeps to the seller's porch days.
       AND (o.handover IS DISTINCT FROM 'porch' OR public.declutter_order_is_porch_day(o.id, w.weekday))
     ORDER BY w.weekday, w.starts_local;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_order_pickup_windows(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_pickup_windows(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_decline_request(p_request_id uuid, p_reason_code text, p_reason_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_tenant uuid;
  v_text text := nullif(btrim(coalesce(p_reason_text, '')), '');
  v_leak text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('handle_myself', 'not_my_responsibility', 'already_scheduled', 'other') THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason_code = 'other' AND char_length(coalesce(v_text, '')) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(v_text, '')) > 500 THEN
    RAISE EXCEPTION 'too_long' USING ERRCODE = '22023';
  END IF;
  IF v_text IS NOT NULL THEN
    v_leak := public.contact_leak_reason(v_text);
    IF v_leak IS NOT NULL THEN
      RAISE EXCEPTION 'contact_info_not_allowed' USING ERRCODE = '22023', DETAIL = v_leak;
    END IF;
  END IF;
  UPDATE public.maintenance_requests
     SET status = 'declined', decline_reason_code = p_reason_code, decline_reason_text = v_text,
         decided_at = now(), updated_at = now()
   WHERE id = p_request_id AND landlord_id = v_uid AND status = 'submitted'
  RETURNING tenant_id INTO v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM public.rentals_notify(v_tenant, 'Request answered',
    'Your landlord answered your maintenance request. Tap to see their reason.',
    '/rentals/requests/' || p_request_id::text, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_decline_request(p_request_id uuid, p_reason_code text, p_reason_text text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_decline_request(p_request_id uuid, p_reason_code text, p_reason_text text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_manager_send_back(p_item_id uuid, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_sub public.declutter_manager_submissions%ROWTYPE;
  v_note text := left(NULLIF(btrim(COALESCE(p_note, '')), ''), 500);
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- A banned or restricted seller can't send a draft back (lead 11-01 ban gate).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sub FROM public.declutter_manager_submissions WHERE item_id = p_item_id FOR UPDATE;
  IF v_sub.item_id IS NULL OR v_sub.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_sub.status <> 'waiting' THEN
    RAISE EXCEPTION 'not_waiting' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_manager_submissions SET status = 'sent_back', note = v_note, decided_at = now()
   WHERE item_id = p_item_id;
  INSERT INTO public.declutter_manager_actions (grant_id, seller_id, manager_id, action, target_id)
  VALUES (v_sub.grant_id, v_uid, v_sub.manager_id, 'seller_sent_back', p_item_id);
  PERFORM public.declutter_notify(v_sub.manager_id, 'declutter_listings', 'Sent back to you',
    format('%s sent %s back%s. Change it, then send it for approval again.', public.declutter_manager_first_name(v_uid),
           COALESCE((SELECT i.title FROM public.declutter_items i WHERE i.id = p_item_id), 'the draft'),
           CASE WHEN v_note IS NULL THEN '' ELSE ': "' || v_note || '"' END),
    '/declutter?tab=selling', v_uid);
  RETURN 'sent_back';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_manager_send_back(p_item_id uuid, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manager_send_back(p_item_id uuid, p_note text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_remove_review(p_review_id uuid, p_note text, p_report_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  r public.declutter_reviews%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.declutter_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND OR r.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'review_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF r.reviewer_id = v_uid OR r.reviewee_id = v_uid THEN
    RAISE EXCEPTION 'own_review' USING ERRCODE = '42501';
  END IF;
  IF p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports rp
        WHERE rp.id = p_report_id AND rp.reported_type = 'declutter_review' AND rp.reported_id = p_review_id) THEN
    RAISE EXCEPTION 'report_not_for_review' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_reviews SET removed_at = now() WHERE id = p_review_id;
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_review_removed', 'declutter_review', p_review_id::text,
          jsonb_build_object('note', NULLIF(v_note, ''), 'report_id', p_report_id, 'order_id', r.order_id,
                             'stars', r.stars, 'comment', r.comment));
  RETURN 'removed';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_admin_remove_review(p_review_id uuid, p_note text, p_report_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_remove_review(p_review_id uuid, p_note text, p_report_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_release(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_late boolean;
  v_moved boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.status = 'accepted' AND public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    -- A problem is open on this sale: the task stays as it is until an admin decides.
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF t.status <> 'accepted' THEN
    RAISE EXCEPTION 'already_picked_up' USING ERRCODE = '55000',
      HINT = 'You already have the item. Deliver it, or report a problem.';
  END IF;
  -- The seller moved this booking's pickup (helpr_task_seller_move_pickup): backing out costs nothing (lead 10-31).
  v_moved := EXISTS (SELECT 1 FROM public.helpr_task_events e
                      WHERE e.task_id = t.id AND e.task_event = 'pickup_moved' AND e.actor_id = t.pickup_contact_id
                        AND e.created_at >= t.accepted_at);
  v_late := NOT v_moved AND now() > t.pickup_slot_start - interval '2 hours';
  PERFORM public.helpr_task_reopen(t.id, 'released', v_uid,
    CASE WHEN v_moved THEN 'seller_moved' WHEN v_late THEN 'late' END);
  IF v_late THEN
    PERFORM public.helpr_task_give_job_strike(v_uid, 'delivery_backed_out', t.id,
      'Backed out of a Helpr delivery less than 2 hours before the pickup time');
  END IF;
  RETURN jsonb_build_object('result', 'released', 'strike', v_late);
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_release(p_task_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_release(p_task_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_manager_approve(p_item_id uuid, p_bought_for_personal_use boolean,
  p_not_in_the_business boolean, p_not_a_frequent_seller boolean, p_keeps_item_until_handover boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_sub public.declutter_manager_submissions%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- A banned or restricted seller can't approve a draft (lead 11-01 ban gate).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sub FROM public.declutter_manager_submissions WHERE item_id = p_item_id FOR UPDATE;
  IF v_sub.item_id IS NULL OR v_sub.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_sub.status <> 'waiting' THEN
    RAISE EXCEPTION 'not_waiting' USING ERRCODE = '22023';
  END IF;
  PERFORM public.declutter_attest_item(p_item_id, p_bought_for_personal_use, p_not_in_the_business,
    p_not_a_frequent_seller, p_keeps_item_until_handover);
  v_result := to_jsonb(public.declutter_publish_item(p_item_id));
  UPDATE public.declutter_manager_submissions SET status = 'approved', decided_at = now() WHERE item_id = p_item_id;
  INSERT INTO public.declutter_manager_actions (grant_id, seller_id, manager_id, action, target_id)
  VALUES (v_sub.grant_id, v_uid, v_sub.manager_id, 'seller_approved', p_item_id);
  PERFORM public.declutter_notify(v_sub.manager_id, 'declutter_listings', 'Posted',
    format('%s posted %s. It is live now.', public.declutter_manager_first_name(v_uid),
           COALESCE((SELECT i.title FROM public.declutter_items i WHERE i.id = p_item_id), 'the item')),
    '/declutter?tab=selling', v_uid);
  RETURN jsonb_build_object('result', v_result);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_manager_approve(p_item_id uuid, p_bought_for_personal_use boolean, p_not_in_the_business boolean, p_not_a_frequent_seller boolean, p_keeps_item_until_handover boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manager_approve(p_item_id uuid, p_bought_for_personal_use boolean, p_not_in_the_business boolean, p_not_a_frequent_seller boolean, p_keeps_item_until_handover boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_keep_up(p_item_id uuid, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_was boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  IF p_on THEN
    v_uid := public.declutter_assert_member(true);
  ELSE
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- The item's row lock: the sweep reads the switch under the same lock.
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  SELECT p.keep_up_until_sold INTO v_was FROM public.declutter_item_private p WHERE p.item_id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.declutter_item_private SET keep_up_until_sold = p_on, updated_at = now() WHERE item_id = p_item_id;
  -- Switched off: the normal rounds pick up from its relist_count, and it never comes down sooner than 3 days
  -- from now, with this round's "ends soon" notice due again.
  IF v_was AND NOT p_on AND v_item.status = 'live' THEN
    UPDATE public.declutter_items
       SET listed_until = CASE WHEN listed_until IS NULL OR listed_until < now() + interval '3 days'
                               THEN now() + interval '3 days' ELSE listed_until END,
           round_nudged = NULL,
           updated_at = now()
     WHERE id = p_item_id;
  END IF;
  RETURN p_on;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_keep_up(p_item_id uuid, p_on boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_keep_up(p_item_id uuid, p_on boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_release_wanted_photos(p_wanted_id uuid, p_report_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  w public.declutter_wanted%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  IF NOT FOUND OR w.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF w.user_id = v_uid THEN
    RAISE EXCEPTION 'own_post' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reports rp
                  WHERE rp.id = p_report_id AND rp.reported_type = 'declutter_wanted' AND rp.reported_id = p_wanted_id) THEN
    RAISE EXCEPTION 'report_not_for_post' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_wanted
     SET photos_cleared = photos_cleared || photos_held, photos_held = '{}'
   WHERE id = p_wanted_id;
  -- CHANGED (A3-113): releasing the photos means they were fine. A member's report on them is closed as 'dismissed', so
  -- trg_reports_zz_reporter_outcome tells that member "didn't find a rule broken", never "took action". The automatic
  -- photo-check row (no reporter) stays 'resolved', as before.
  UPDATE public.reports
     SET status = CASE WHEN reporter_id IS NULL THEN 'resolved' ELSE 'dismissed' END
   WHERE id = p_report_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_wanted_photos_released', 'declutter_wanted', p_wanted_id::text,
          jsonb_build_object('report_id', p_report_id, 'paths', to_jsonb(w.photos_held)));
  RETURN 'released';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_admin_release_wanted_photos(p_wanted_id uuid, p_report_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_release_wanted_photos(p_wanted_id uuid, p_report_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_take_down_wanted(p_wanted_id uuid, p_note text, p_report_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  w public.declutter_wanted%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  IF NOT FOUND OR w.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF w.user_id = v_uid THEN
    RAISE EXCEPTION 'own_post' USING ERRCODE = '42501';
  END IF;
  IF p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports rp
        WHERE rp.id = p_report_id AND rp.reported_type = 'declutter_wanted' AND rp.reported_id = p_wanted_id) THEN
    RAISE EXCEPTION 'report_not_for_post' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_wanted
     SET status = 'closed', closed_at = COALESCE(closed_at, now()), removed_at = now(), photos_cleared = '{}'
   WHERE id = p_wanted_id;
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_wanted_taken_down', 'declutter_wanted', p_wanted_id::text,
          jsonb_build_object('note', v_note, 'report_id', p_report_id));
  PERFORM public.declutter_wanted_notify(w.user_id, 'Your Wanted post was taken down',
    format('Your Wanted for "%s" was taken down: %s', w.what, v_note), '/declutter?tab=wanted');
  RETURN 'removed';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_admin_take_down_wanted(p_wanted_id uuid, p_note text, p_report_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_take_down_wanted(p_wanted_id uuid, p_note text, p_report_id uuid) TO authenticated, service_role;

