-- Q2390 packet 9: "not found" answers HTTP 404, not 500, for twenty small
-- member-callable functions (Declutter order views, delivery and porch steps,
-- listing settings, Helpr task talk, two Shops admin checks, a feature switch).
-- None moves money or deletes rows; no edge function calls them.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-02, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_set_drop_pct             20261028160637 2b1467d273b5877957dca3308855f55f
--   declutter_block_wanted_poster      20261030225143 cb08d7edb57582f9d586467002d41ff5
--   declutter_buyer_cancel_delivery    20261030002630 9b525af33f8ba1ad4502ec0b6d209058
--   declutter_seller_cancel_delivery   20261030002630 9aad5f8d5b6c95ebd92135dfa15c5e45
--   declutter_order_place              20261101054401 86526a82b9acadd6ea417049406a5680
--   declutter_my_handover              20261031004529 0be8d7d1b5aa07eb8af08de614686d29
--   shops_admin_check_registration     20261017061155 0d1a935bfa097dc5a1799f402ab6b9b0
--   helpr_task_talk_view               20261031231948 26b18f025dc7b161abce45f7ea637795
--   declutter_set_porch_place          20261030164712 57965f2e0d69b7685b5645e3ee5b65fe
--   declutter_attest_item              20261014193955 b9ce5a26044071a58a6487bc72ad293b
--   shops_admin_remove_strike          20261019071055 6afb85d86e8b8cdbd550c1dacaec72a4
--   helpr_task_handed_over             20261030012018 c13d8221ef3fe50fb965ba1ea54261a4
--   admin_set_feature_switch           20261012031120 0c92addb4f847d090691889f6c0cb45d
--   declutter_set_offer_rules          20261031201036 33b744d0b02a179c286c2e06c46d034d
--   declutter_my_ship_label            20261102023246 6e11739bed0d8eb662c032a1b4412ad8
--   declutter_my_ship_tracking         20261102025148 26d1e5f56ab71f5de7f488734a6e4b73
--   declutter_order_talk_view          20261030004216 1bf5e87cf7c676d8653b693f6a92a5b1
--   declutter_mark_packed              20261102023246 9d0e04c27f5f2a5eca0496e78605aa4d
--   declutter_mark_talk_read           20261101200929 e507460610b2249d0ed1960e73f06f3b
--   declutter_set_porch_time           20261015042253 5fc5a457182dd6da0de5754461d759fe
--
-- Grants restated as on prod: EXECUTE to authenticated and service_role only.

CREATE OR REPLACE FUNCTION public.declutter_set_drop_pct(p_item_id uuid, p_pct integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_pct IS NULL OR p_pct NOT IN (0, 5, 10, 15, 20) THEN
    RAISE EXCEPTION 'invalid_drop_pct' USING ERRCODE = '22023', HINT = 'Price drops are off, 5, 10, 15 or 20 percent.';
  END IF;

  SELECT i.status INTO v_status FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_status NOT IN ('draft', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  UPDATE public.declutter_items SET drop_pct = p_pct, updated_at = now()
   WHERE id = p_item_id AND seller_id = v_uid;
  RETURN p_pct;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_drop_pct(p_item_id uuid, p_pct integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_drop_pct(p_item_id uuid, p_pct integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_block_wanted_poster(p_wanted_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  w public.declutter_wanted%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id;
  IF NOT FOUND OR NOT w.public OR w.removed_at IS NOT NULL OR w.user_id = v_uid
     OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())) THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_result := public.block_user_and_settle(w.user_id, 'Blocked from a Wanted post');
  IF jsonb_array_length(COALESCE(v_result -> 'settled', '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'wanted_block_shared_job' USING ERRCODE = 'P0001';
  END IF;
  RETURN 'blocked';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_block_wanted_poster(p_wanted_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_block_wanted_poster(p_wanted_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_buyer_cancel_delivery(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
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
  -- Owner 2026-10-29: the buyer never cancels a paid order; it can be moved once.
  RAISE EXCEPTION 'paid_order_not_cancellable' USING ERRCODE = '55000',
    HINT = 'A paid order can''t be cancelled. You can ask for a new delivery time once, or report a problem.';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_buyer_cancel_delivery(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_buyer_cancel_delivery(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_cancel_delivery(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
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
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- Owner 2026-10-29: the seller never cancels a paid order; it can be moved once.
  RAISE EXCEPTION 'paid_order_not_cancellable' USING ERRCODE = '55000',
    HINT = 'A paid order can''t be cancelled. You can ask for a new delivery time once, or report a problem.';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_seller_cancel_delivery(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_cancel_delivery(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_order_place(p_order_id uuid)
 RETURNS TABLE(label text, area text, address text, lat numeric, lng numeric, weekdays smallint[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_open boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF o.id IS NULL OR v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- CHANGED (lead 10-30): closed on a held sale, for the buyer.
  v_open := v_side = 'seller' OR o.status IN ('paid', 'handed_over');
  v_open := v_open AND (v_side = 'seller' OR NOT public.declutter_held_address_closed(o.id));
  RETURN QUERY
    SELECT CASE WHEN v_side = 'seller' THEN pp.label END, pp.area,
           CASE WHEN v_open THEN pp.address END,
           CASE WHEN v_open THEN pp.lat::numeric END,
           CASE WHEN v_open THEN pp.lng::numeric END,
           pp.weekdays
      FROM public.declutter_order_porch_places pp
     WHERE pp.order_id = o.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_order_place(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_place(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_my_handover(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  h public.declutter_handovers;
  v_side text;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL OR o.status NOT IN ('paid', 'handed_over') THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  -- No code and no QR reach either side (owner 2026-10-18: porch pickup only).
  RETURN jsonb_build_object(
    'order_id', o.id, 'status', o.status, 'side', v_side,
    'confirmed_by', h.confirmed_by, 'confirmed_at', h.confirmed_at,
    'set_out_at', h.set_out_at, 'set_out_photo_path', h.set_out_photo_path,
    'set_out_note', h.set_out_note,
    'picked_up_at', h.picked_up_at, 'picked_up_photo_path', h.picked_up_photo_path,
    'seller_confirmed_at', h.seller_confirmed_at,
    'no_show_reported_at', h.no_show_reported_at, 'no_show_answer_by', h.no_show_answer_by);
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_my_handover(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_handover(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_admin_check_registration(p_shop_id uuid, p_verified boolean)
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
  SELECT owner_id INTO v_owner FROM public.shops WHERE id = p_shop_id AND sos_number IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops
     SET sos_verified_at = CASE WHEN p_verified THEN now() END,
         sos_verified_by = CASE WHEN p_verified THEN v_uid END,
         updated_at = now()
   WHERE id = p_shop_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shop_registration_check', 'shop', p_shop_id::text, jsonb_build_object('verified', COALESCE(p_verified, false)));
  RETURN COALESCE(p_verified, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_admin_check_registration(p_shop_id uuid, p_verified boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_check_registration(p_shop_id uuid, p_verified boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_talk_view(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id AND source_kind = 'declutter_delivery';
  v_side := CASE WHEN NOT FOUND THEN NULL
                 WHEN t.helpr_id = v_uid THEN 'helpr' WHEN t.customer_id = v_uid THEN 'buyer' WHEN t.pickup_contact_id = v_uid THEN 'seller' END;
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN jsonb_build_object(
    'task_id', t.id,
    'side', v_side,
    'open', t.helpr_id IS NOT NULL AND t.status IN ('accepted', 'picked_up', 'delivered'),
    'messages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'side', m.sender_side, 'mine', m.sender_id = v_uid, 'body', m.body, 'created_at', m.created_at)
                                           ORDER BY m.created_at, m.id), '[]'::jsonb)
                   FROM public.helpr_task_talk_messages m WHERE m.task_id = t.id AND m.created_at >= t.accepted_at));
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_talk_view(p_task_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_talk_view(p_task_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_porch_place(p_seller_id uuid, p_place_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_seller_id IS NULL OR cardinality(public.declutter_my_cart_lines(v_uid, p_seller_id)) = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_place_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_porch_places pl
                                        WHERE pl.id = p_place_id AND pl.seller_id = p_seller_id) THEN
    RAISE EXCEPTION 'porch_place_unavailable' USING ERRCODE = '22023',
      HINT = 'That pickup place isn''t available. Pick another.';
  END IF;
  INSERT INTO public.declutter_porch_place_choices (buyer_id, seller_id, place_id)
  VALUES (v_uid, p_seller_id, p_place_id)
  ON CONFLICT (buyer_id, seller_id) DO UPDATE SET place_id = EXCLUDED.place_id, chosen_at = now();
  RETURN p_place_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_porch_place(p_seller_id uuid, p_place_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_porch_place(p_seller_id uuid, p_place_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_attest_item(
  p_item_id uuid,
  p_bought_for_personal_use boolean,
  p_not_in_the_business boolean,
  p_not_a_frequent_seller boolean,
  p_keeps_item_until_handover boolean
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_at timestamptz;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  IF NOT EXISTS (SELECT 1 FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid AND status = 'draft') THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_bought_for_personal_use IS NOT TRUE OR p_not_in_the_business IS NOT TRUE
     OR p_not_a_frequent_seller IS NOT TRUE OR p_keeps_item_until_handover IS NOT TRUE THEN
    RAISE EXCEPTION 'attestation_incomplete'
      USING ERRCODE = '22023', HINT = 'Confirm all four statements to list this item.';
  END IF;

  INSERT INTO public.declutter_tax_attestations (
    item_id, seller_id, bought_for_personal_use, not_in_the_business, not_a_frequent_seller, keeps_item_until_handover)
  VALUES (p_item_id, v_uid, true, true, true, true)
  ON CONFLICT (item_id) DO UPDATE SET attested_at = now(), wording_version = EXCLUDED.wording_version
  RETURNING attested_at INTO v_at;
  RETURN v_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_attest_item(p_item_id uuid, p_bought_for_personal_use boolean, p_not_in_the_business boolean, p_not_a_frequent_seller boolean, p_keeps_item_until_handover boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_attest_item(p_item_id uuid, p_bought_for_personal_use boolean, p_not_in_the_business boolean, p_not_a_frequent_seller boolean, p_keeps_item_until_handover boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_admin_remove_strike(p_strike_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  s public.shop_strikes;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  UPDATE public.shop_strikes SET removed_at = now(), removed_by = v_uid, removed_note = v_note
   WHERE id = p_strike_id AND removed_at IS NULL
  RETURNING * INTO s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'strike_not_found' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shops_admin_remove_strike', 'shop_strike', s.id::text, jsonb_build_object('user_id', s.user_id, 'note', v_note));
  PERFORM public.declutter_notify(s.user_id, 'info', 'Shops strike removed',
    'Louisiana Helpr removed one of your Shops strikes.', '/shops/orders');
  RETURN jsonb_build_object('result', 'removed', 'strike_id', s.id, 'active', public.shop_active_strike_count(s.user_id));
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_admin_remove_strike(p_strike_id uuid, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_remove_strike(p_strike_id uuid, p_note text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_handed_over(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.pickup_contact_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.status = 'picked_up' OR (t.status = 'accepted' AND t.helpr_id IS NOT NULL AND t.handed_over_to = t.helpr_id) THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF t.status <> 'accepted' OR t.helpr_id IS NULL THEN
    RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  UPDATE public.helpr_tasks SET handed_over_at = now(), handed_over_to = t.helpr_id, updated_at = now()
   WHERE id = t.id AND status = 'accepted';
  PERFORM public.helpr_task_log(t.id, 'handed_over', v_uid, NULL);
  RETURN jsonb_build_object('result', 'handed_over');
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_handed_over(p_task_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_handed_over(p_task_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_feature_switch(p_key text, p_audience text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_from text;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_audience IS NULL OR p_audience NOT IN ('off', 'testers', 'everyone') THEN
    RAISE EXCEPTION 'invalid_audience' USING ERRCODE = '22023';
  END IF;

  SELECT s.audience INTO v_from
    FROM public.feature_switches s
   WHERE s.key = p_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_switch' USING ERRCODE = 'PT404';
  END IF;

  IF v_from = p_audience THEN
    RETURN v_from;
  END IF;

  -- Tell the audit trigger this change is audited here (transaction-local),
  -- so it writes no second row.
  PERFORM set_config('lh.feature_switch_audited', p_key, true);
  UPDATE public.feature_switches
     SET audience = p_audience, updated_at = now()
   WHERE key = p_key;
  PERFORM set_config('lh.feature_switch_audited', '', true);

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'set_feature_switch', 'feature_switch', p_key,
          jsonb_build_object('from', v_from, 'to', p_audience));

  RETURN p_audience;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_feature_switch(p_key text, p_audience text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_feature_switch(p_key text, p_audience text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_offer_rules(p_item_id uuid, p_accepts_offers boolean, p_auto_offers boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_accepts_offers IS NULL OR p_auto_offers IS NULL THEN
    RAISE EXCEPTION 'invalid_offer_rules' USING ERRCODE = '22023';
  END IF;
  SELECT i.status INTO v_status FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- LEAD-OFFERS-CHOICE: a draft too, so the sell form and Sell a bunch set it before the item goes up.
  IF v_status NOT IN ('draft', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_items SET accepts_offers = p_accepts_offers, updated_at = now() WHERE id = p_item_id;
  -- Auto answers only while offers are taken.
  UPDATE public.declutter_item_private SET auto_offers = (p_accepts_offers AND p_auto_offers), updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_offer_rules(p_item_id uuid, p_accepts_offers boolean, p_auto_offers boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_offer_rules(p_item_id uuid, p_accepts_offers boolean, p_auto_offers boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_my_ship_label(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  o record;
  s record;
  v_ready boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter_shipping');
  SELECT d.id, d.seller_id, d.handover, d.status, d.paid_at, d.ship_capture INTO o
    FROM public.declutter_orders d WHERE d.id = p_order_id;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid OR o.handover IS DISTINCT FROM 'ship' THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT sh.label_state, sh.label_path, sh.tracking_code, sh.tracking_status, sh.service, sh.accepted_at,
         sh.delivered_at, sh.packed_at INTO s
    FROM public.shipments sh WHERE sh.declutter_order_id = o.id;
  v_ready := FOUND AND s.label_state = 'bought' AND o.ship_capture = 'captured';
  RETURN jsonb_build_object(
    'order_status', o.status,
    'label_state', s.label_state,
    'label_url', CASE WHEN v_ready THEN s.label_path END,
    'tracking_code', CASE WHEN v_ready THEN s.tracking_code END,
    'tracking_status', s.tracking_status,
    'service', s.service,
    'ship_by', CASE WHEN v_ready THEN public.declutter_ship_by(o.paid_at) END,
    'packed_at', s.packed_at,
    'accepted_at', s.accepted_at,
    'delivered_at', s.delivered_at);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_my_ship_label(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_ship_label(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_my_ship_tracking(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  o record;
  s record;
  v_ready boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter_shipping');
  SELECT d.id, d.buyer_id, d.handover, d.status, d.paid_at, d.ship_capture INTO o
    FROM public.declutter_orders d WHERE d.id = p_order_id;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid OR o.handover IS DISTINCT FROM 'ship' THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT sh.label_state, sh.tracking_code, sh.tracking_status, sh.service, sh.packed_at, sh.accepted_at,
         sh.delivered_at INTO s
    FROM public.shipments sh WHERE sh.declutter_order_id = o.id;
  v_ready := FOUND AND s.label_state = 'bought' AND o.ship_capture = 'captured';
  RETURN jsonb_build_object(
    'order_status', o.status,
    'ready', v_ready,
    'tracking_code', CASE WHEN v_ready THEN s.tracking_code END,
    'tracking_status', CASE WHEN v_ready THEN s.tracking_status END,
    'service', s.service,
    'ship_by', CASE WHEN v_ready THEN public.declutter_ship_by(o.paid_at) END,
    'packed_at', CASE WHEN v_ready THEN s.packed_at END,
    'accepted_at', CASE WHEN v_ready THEN s.accepted_at END,
    'delivered_at', CASE WHEN v_ready THEN s.delivered_at END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_my_ship_tracking(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_ship_tracking(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_order_talk_view(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_until timestamptz;
  v_messages jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF NOT FOUND OR v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_until := public.declutter_order_talk_until(o.id);
  IF v_until IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_side = v_side, 'body', m.body, 'created_at', m.created_at)
                            ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO v_messages
    FROM public.declutter_order_talk_messages m
    JOIN public.declutter_order_talks t ON t.id = m.talk_id
   WHERE t.order_id = o.id;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'side', v_side,
    'open', v_until > now() AND o.buyer_id IS NOT NULL AND o.seller_id IS NOT NULL
            AND NOT public.are_users_blocked(o.buyer_id, o.seller_id),
    'open_until', CASE WHEN v_until = 'infinity'::timestamptz THEN NULL ELSE v_until END,
    'messages', v_messages);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_order_talk_view(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_talk_view(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_mark_packed(p_order_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  o record;
  v_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Q281 ban gate (train 1 fix, lead 11-02): a write; a banned caller is refused, as the porch photo and the other
  -- handover writes are (declutter_porch_photo, declutter_set_porch_time).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter_shipping');
  SELECT d.id, d.seller_id, d.handover, d.status, d.ship_capture INTO o
    FROM public.declutter_orders d WHERE d.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid OR o.handover IS DISTINCT FROM 'ship' THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status IS DISTINCT FROM 'paid' OR o.ship_capture IS DISTINCT FROM 'captured' THEN
    RAISE EXCEPTION 'label_not_ready' USING ERRCODE = '55000', HINT = 'The label is not ready yet.';
  END IF;
  UPDATE public.shipments SET packed_at = COALESCE(packed_at, now())
   WHERE declutter_order_id = o.id AND label_state = 'bought'
   RETURNING packed_at INTO v_at;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'label_not_ready' USING ERRCODE = '55000', HINT = 'The label is not ready yet.';
  END IF;
  RETURN v_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_mark_packed(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_mark_packed(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_mark_talk_read(p_kind text, p_ref uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_buyer uuid;
  v_seller uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'order' THEN
    SELECT o.buyer_id, o.seller_id INTO v_buyer, v_seller FROM public.declutter_orders o WHERE o.id = p_ref;
    IF v_uid IS DISTINCT FROM v_buyer AND v_uid IS DISTINCT FROM v_seller THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
    END IF;
    UPDATE public.declutter_order_talks t
       SET buyer_read_at = CASE WHEN v_uid = v_buyer THEN now() ELSE t.buyer_read_at END,
           seller_read_at = CASE WHEN v_uid = v_seller THEN now() ELSE t.seller_read_at END
     WHERE t.order_id = p_ref;
  ELSIF p_kind = 'handover' THEN
    SELECT h.buyer_id, h.seller_id INTO v_buyer, v_seller FROM public.declutter_handover_talks h WHERE h.id = p_ref;
    IF v_uid IS DISTINCT FROM v_buyer AND v_uid IS DISTINCT FROM v_seller THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
    END IF;
    UPDATE public.declutter_handover_talks h
       SET buyer_read_at = CASE WHEN v_uid = v_buyer THEN now() ELSE h.buyer_read_at END,
           seller_read_at = CASE WHEN v_uid = v_seller THEN now() ELSE h.seller_read_at END
     WHERE h.id = p_ref;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_mark_talk_read(p_kind text, p_ref uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_mark_talk_read(p_kind text, p_ref uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_porch_time(p_order_id uuid, p_mode text, p_until timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  IF b.order_id IS NULL OR b.slot_start IS NULL THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  IF p_mode = 'all_day' THEN
    p_until := NULL;
  ELSIF p_mode = 'until' THEN
    IF p_until IS NULL OR p_until < b.slot_end
       OR (p_until AT TIME ZONE 'America/Chicago')::date <> (b.slot_start AT TIME ZONE 'America/Chicago')::date THEN
      RAISE EXCEPTION 'invalid_porch_time' USING ERRCODE = '22023',
        HINT = 'Pick a time after the booked pickup, on the same day.';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_porch_time' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_bookings SET porch_mode = p_mode, porch_until = p_until, updated_at = now() WHERE order_id = o.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_porch_time(p_order_id uuid, p_mode text, p_until timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_porch_time(p_order_id uuid, p_mode text, p_until timestamp with time zone) TO authenticated, service_role;

