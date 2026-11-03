-- Q2390 packet 11: "not found" answers HTTP 404, not 500, for seventeen
-- member-callable functions (Declutter reviews, meetup and porch places,
-- listing and wanted photos, order and handover messages, an admin question
-- removal; Shops' shop page; Homes lease, ownership proof, property review and
-- repair answers; admin donation partners, meetup spots and category
-- suggestions; a Helpr task message). None moves money, deletes rows, creates
-- an order or sits on the checkout or seller-delivery path; no edge function
-- calls them.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-02, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   rentals_lease                          20261019110137 a0da12c1496960681ec2f5c567c80a1d
--   rentals_admin_review_property          20261017205605 091e6783b66aa420ce39d5e815afea5a
--   declutter_leave_review                 20261021023530 ec57be9ff5993c86ed73c55a7c5f5a18
--   declutter_save_my_meetup_spot          20261101194608 fb8a3e4a163eebe4d37167aa12742853
--   admin_declutter_save_donation_partner  20261027222743 07ca36a8ea6577359b8385868be7c21c
--   admin_declutter_save_meetup_spot       20261027204500 0fc78605cbf21fce0373136b4bb86a04
--   declutter_add_wanted_photo             20261030225143 a465367d10a6396d8b398bd528df45ee
--   shops_get_shop                         20261017061155 4dcc740b7d11c25000851820477b1832
--   admin_review_category_suggestion       20261015051141 fed36fd28b2da795cd573b311e8e653f
--   rentals_submit_ownership_proof         20261019044500 30df26800aaa2a15479b4b62dcb35eeb
--   declutter_admin_remove_question        20261101021934 950a1370f8bf29613da92fd9e215fbbb
--   rentals_tenant_answer_fixed            20261017205605 bc634a829e2c2320139aa891c12ae1ea
--   declutter_send_handover_message        20261028235249 16b97f4ba720b948482f9e609bd31848
--   helpr_task_send_message                20261031231948 1da28d6d0c332e90ee56645a45fd71c6
--   declutter_send_order_message           20261030004216 b021e5a799a06a730fa3d4598dbcfd6b
--   declutter_save_porch_place             20261031145652 f12b9408f1399d92855d0bb493ed7303
--   declutter_add_item_photo               20261030061927 9b8aa34ac1d603a46b3ea2e3e04bc598
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (22 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod (EXECUTE to authenticated and service_role; never anon).

CREATE OR REPLACE FUNCTION public.rentals_lease(p_tenancy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_side text;
  v_open public.rental_leases%ROWTYPE;
BEGIN
  PERFORM public.require_feature('rentals');
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  v_side := CASE WHEN v_t.landlord_id = v_uid THEN 'landlord' WHEN v_t.tenant_id = v_uid THEN 'tenant' END;
  IF v_side IS NULL OR v_t.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO v_open FROM public.rental_leases WHERE tenancy_id = p_tenancy_id AND status IN ('draft', 'sent');
  RETURN jsonb_build_object(
    'side', v_side,
    'tenancy_status', v_t.status,
    'can_edit', v_side = 'landlord' AND v_t.status = 'active',
    'open', CASE
      WHEN v_open.id IS NULL THEN NULL
      -- Lead review #8: the tenant learns only that a lease is being prepared (and their own note).
      WHEN v_side = 'tenant' AND v_open.status = 'draft' THEN jsonb_build_object('status', 'draft', 'change_request', v_open.change_request)
      ELSE jsonb_build_object(
        'id', v_open.id,
        'status', v_open.status,
        'template_version', v_open.template_version,
        'fields', v_open.fields,
        'change_request', v_open.change_request,
        'body_sha256', v_open.body_sha256,
        'landlord_signed_name', v_open.landlord_signed_name,
        'landlord_signed_at', v_open.landlord_signed_at,
        'landlord_initials', to_jsonb(v_open.landlord_initials),
        'sent_at', v_open.sent_at,
        'updated_at', v_open.updated_at) END,
    'signed', (SELECT coalesce(jsonb_agg(public.rentals_lease_signed_json(l, v_uid) ORDER BY l.tenant_signed_at DESC), '[]'::jsonb)
      FROM public.rental_leases l WHERE l.tenancy_id = p_tenancy_id AND l.status = 'signed'
       AND (l.landlord_id = v_uid OR l.tenant_id = v_uid)));
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_lease(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_lease(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_admin_review_property(p_property_id uuid, p_approve boolean, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'decision_required' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND char_length(btrim(coalesce(p_note, ''))) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT owner_id, ownership_status INTO v_owner, v_status FROM public.rental_properties
   WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'pending_review' THEN
    RAISE EXCEPTION 'not_pending_review' USING ERRCODE = 'PT404';
  END IF;
  -- An admin never approves their own property.
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rental_properties
     SET ownership_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         ownership_reviewed_by = v_uid, ownership_reviewed_at = now(),
         ownership_review_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   WHERE id = p_property_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'rentals_ownership_approved' ELSE 'rentals_ownership_rejected' END,
          'rental_property', p_property_id::text, jsonb_build_object('note', p_note));
  PERFORM public.rentals_notify(v_owner,
    CASE WHEN p_approve THEN 'Property approved' ELSE 'Ownership proof not accepted' END,
    CASE WHEN p_approve THEN 'Louisiana Helpr approved your ownership proof. You can now invite tenants.'
         ELSE 'Louisiana Helpr did not accept your ownership proof: ' || btrim(p_note) END,
    '/rentals', false, true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_admin_review_property(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_review_property(uuid, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_leave_review(p_order_id uuid, p_stars integer, p_comment text, p_tags text[] DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_id uuid;
  v_tags text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'handed_over' THEN
    RAISE EXCEPTION 'not_handed_over' USING ERRCODE = '55000', HINT = 'Reviews open after the handover.';
  END IF;
  IF p_stars IS NULL OR p_stars NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_stars' USING ERRCODE = '22023';
  END IF;
  p_comment := NULLIF(btrim(p_comment), '');
  IF p_comment IS NOT NULL AND char_length(p_comment) > 1000 THEN
    RAISE EXCEPTION 'comment_too_long' USING ERRCODE = '22023';
  END IF;
  IF p_comment IS NOT NULL AND public.contact_leak_reason(p_comment) IS NOT NULL THEN
    RAISE EXCEPTION 'review_contact_info' USING ERRCODE = '23514',
      HINT = 'Reviews cannot include phone numbers, emails or links.';
  END IF;
  -- Q2265: each tag once, only from this side's list.
  v_tags := ARRAY(SELECT DISTINCT t FROM unnest(coalesce(p_tags, '{}')) AS t WHERE t IS NOT NULL ORDER BY t);
  IF NOT (v_tags <@ public.declutter_review_tags_for(v_side)) THEN
    RAISE EXCEPTION 'invalid_tags' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_reviews (order_id, reviewer_id, reviewee_id, reviewer_side, stars, comment, tags)
  VALUES (o.id, v_uid, CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, v_side, p_stars, p_comment, v_tags)
  ON CONFLICT (order_id, reviewer_side) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'already_reviewed' USING ERRCODE = '23505';
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_leave_review(uuid, integer, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_leave_review(uuid, integer, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_save_my_meetup_spot(p_id uuid, p_name text, p_address text, p_area text,
  p_lat numeric, p_lng numeric, p_windows jsonb DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 80
     OR p_address IS NULL OR char_length(btrim(p_address)) NOT BETWEEN 5 AND 200
     OR p_area IS NULL OR char_length(btrim(p_area)) NOT BETWEEN 2 AND 60
     OR p_lat IS NULL OR p_lat NOT BETWEEN 28 AND 34 OR p_lng IS NULL OR p_lng NOT BETWEEN -95 AND -88 THEN
    RAISE EXCEPTION 'invalid_meetup_spot' USING ERRCODE = '22023',
      HINT = 'Give the spot a name and pick its address from the list (a public place in Louisiana).';
  END IF;
  IF NOT public.declutter_meetup_windows_ok(p_windows) THEN
    RAISE EXCEPTION 'invalid_meetup_times' USING ERRCODE = '22023', HINT = 'Each time needs a day and at least 30 minutes.';
  END IF;
  IF p_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('declutter_my_meetup_spots:' || v_uid::text, 0));
    IF (SELECT count(*) FROM public.declutter_meetup_spots s WHERE s.seller_id = v_uid AND s.active) >= 10 THEN
      RAISE EXCEPTION 'too_many_meetup_spots' USING ERRCODE = '22023', HINT = 'You can save up to 10 meet spots.';
    END IF;
    INSERT INTO public.declutter_meetup_spots (seller_id, kind, parish, name, address, lat, lng, windows, created_by)
    VALUES (v_uid, 'seller', btrim(p_area), btrim(p_name), btrim(p_address), p_lat, p_lng, p_windows, v_uid)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  UPDATE public.declutter_meetup_spots s
     SET name = btrim(p_name), address = btrim(p_address), parish = btrim(p_area), lat = p_lat, lng = p_lng,
         windows = p_windows, updated_at = now()
   WHERE s.id = p_id AND s.seller_id = v_uid AND s.active
  RETURNING s.id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'meetup_spot_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_save_my_meetup_spot(uuid, text, text, text, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_save_my_meetup_spot(uuid, text, text, text, numeric, numeric, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_declutter_save_donation_partner(p_id uuid, p_parish text, p_name text, p_address text,
  p_lat numeric, p_lng numeric, p_takes text, p_active boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 28 AND 34 OR p_lng NOT BETWEEN -95 AND -88 THEN
    RAISE EXCEPTION 'donation_partner_invalid' USING ERRCODE = '22023', HINT = 'The map point must be in Louisiana.';
  END IF;
  IF char_length(btrim(COALESCE(p_parish, ''))) NOT BETWEEN 2 AND 60 OR char_length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 2 AND 80
     OR char_length(btrim(COALESCE(p_address, ''))) NOT BETWEEN 5 AND 200 OR char_length(COALESCE(p_takes, '')) > 300 THEN
    RAISE EXCEPTION 'donation_partner_invalid' USING ERRCODE = '22023', HINT = 'Fill in the parish, name and address (not too long).';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.declutter_donation_partners (parish, name, address, lat, lng, takes, active, created_by)
    VALUES (btrim(p_parish), btrim(p_name), btrim(p_address), p_lat, p_lng, NULLIF(btrim(COALESCE(p_takes, '')), ''),
            COALESCE(p_active, true), v_uid)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.declutter_donation_partners
       SET parish = btrim(p_parish), name = btrim(p_name), address = btrim(p_address), lat = p_lat, lng = p_lng,
           takes = NULLIF(btrim(COALESCE(p_takes, '')), ''), active = COALESCE(p_active, active), updated_at = now()
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'donation_partner_not_found' USING ERRCODE = 'PT404';
    END IF;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_id IS NULL THEN 'declutter_donation_partner_added' ELSE 'declutter_donation_partner_saved' END,
          'declutter_donation_partner', v_id::text,
          jsonb_build_object('parish', btrim(p_parish), 'name', btrim(p_name), 'active', COALESCE(p_active, true)));
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_declutter_save_donation_partner(uuid, text, text, text, numeric, numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_declutter_save_donation_partner(uuid, text, text, text, numeric, numeric, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_declutter_save_meetup_spot(p_id uuid, p_parish text, p_name text, p_address text,
  p_lat numeric, p_lng numeric, p_kind text, p_note text, p_active boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('police', 'store', 'other') THEN
    RAISE EXCEPTION 'meetup_spot_invalid' USING ERRCODE = '22023', HINT = 'Pick police, store or other.';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 28 AND 34 OR p_lng NOT BETWEEN -95 AND -88 THEN
    RAISE EXCEPTION 'meetup_spot_invalid' USING ERRCODE = '22023', HINT = 'The map point must be in Louisiana.';
  END IF;
  IF char_length(btrim(COALESCE(p_parish, ''))) < 2 OR char_length(btrim(COALESCE(p_name, ''))) < 2
     OR char_length(btrim(COALESCE(p_address, ''))) < 5 THEN
    RAISE EXCEPTION 'meetup_spot_invalid' USING ERRCODE = '22023', HINT = 'Fill in the parish, name and address.';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.declutter_meetup_spots (parish, name, address, lat, lng, kind, note, active, created_by)
    VALUES (btrim(p_parish), btrim(p_name), btrim(p_address), p_lat, p_lng, p_kind, NULLIF(btrim(COALESCE(p_note, '')), ''),
            COALESCE(p_active, true), v_uid)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.declutter_meetup_spots
       SET parish = btrim(p_parish), name = btrim(p_name), address = btrim(p_address), lat = p_lat, lng = p_lng,
           kind = p_kind, note = NULLIF(btrim(COALESCE(p_note, '')), ''), active = COALESCE(p_active, active), updated_at = now()
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'meetup_spot_not_found' USING ERRCODE = 'PT404';
    END IF;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_id IS NULL THEN 'declutter_meetup_spot_added' ELSE 'declutter_meetup_spot_saved' END,
          'declutter_meetup_spot', v_id::text,
          jsonb_build_object('parish', btrim(p_parish), 'name', btrim(p_name), 'active', COALESCE(p_active, true)));
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_declutter_save_meetup_spot(uuid, text, text, text, numeric, numeric, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_declutter_save_meetup_spot(uuid, text, text, text, numeric, numeric, text, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_add_wanted_photo(p_wanted_id uuid, p_storage_path text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_w public.declutter_wanted%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT * INTO v_w FROM public.declutter_wanted WHERE id = p_wanted_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_w.status <> 'open' OR v_w.expires_at <= now() THEN
    RAISE EXCEPTION 'wanted_not_open' USING ERRCODE = '22023';
  END IF;
  -- The path is the caller's own folder for THIS post, and the object is really there, uploaded by the caller.
  IF p_storage_path IS NULL
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 2) IS DISTINCT FROM 'wanted'
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_wanted_id::text
     OR split_part(p_storage_path, '/', 4) = ''
     OR split_part(p_storage_path, '/', 5) <> ''
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          -- Images only: job-photos also takes video, and a video keeps its GPS atoms (the app's re-encode strips
          -- images only).
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF p_storage_path = ANY (v_w.photo_paths) THEN
    RETURN cardinality(v_w.photo_paths);
  END IF;
  IF cardinality(v_w.photo_paths) >= 3 THEN
    RAISE EXCEPTION 'wanted_too_many_photos' USING ERRCODE = '22023', HINT = 'A Wanted post has at most 3 photos.';
  END IF;

  UPDATE public.declutter_wanted SET photo_paths = photo_paths || p_storage_path, photo_added_at = now() WHERE id = p_wanted_id;
  RETURN cardinality(v_w.photo_paths) + 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_add_wanted_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_add_wanted_photo(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_get_shop(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_s public.shops%ROWTYPE;
  v_mine boolean;
  v_rating numeric;
  v_count integer;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO v_s FROM public.shops WHERE id = p_shop_id;
  v_mine := v_s.owner_id = v_uid;
  SELECT r.rating, r.review_count INTO v_rating, v_count FROM public.shop_owner_rating(v_s.owner_id) r;
  RETURN jsonb_build_object(
    'id', v_s.id,
    'owner_id', v_s.owner_id,
    'name', v_s.name,
    'about', v_s.about,
    'category', v_s.category,
    'parishes_served', to_jsonb(v_s.parishes_served),
    'area_label', v_s.area_label,
    'storefront', v_s.storefront,
    'pin_lat', v_s.pin_lat,
    'pin_lng', v_s.pin_lng,
    'offers_selling', v_s.offers_selling,
    'offers_quotes', v_s.offers_quotes,
    'paused', v_s.paused,
    'badges', public.shop_badges(v_s.id),
    'rating', v_rating,
    'review_count', COALESCE(v_count, 0),
    'follower_count', (SELECT count(*) FROM public.shop_follows f WHERE f.shop_id = v_s.id),
    'following', EXISTS (SELECT 1 FROM public.shop_follows f WHERE f.shop_id = v_s.id AND f.user_id = v_uid),
    'mine', v_mine,
    'sos_number', CASE WHEN v_mine THEN v_s.sos_number END,
    'hidden', CASE WHEN v_mine THEN v_s.hidden_at IS NOT NULL END,
    'hidden_reason', CASE WHEN v_mine THEN v_s.hidden_reason END,
    'hours', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'weekday', h.weekday, 'opens', to_char(h.opens_local, 'HH24:MI'), 'closes', to_char(h.closes_local, 'HH24:MI'))
               ORDER BY h.weekday, h.opens_local) FROM public.shop_hours h WHERE h.shop_id = v_s.id), '[]'::jsonb),
    'photos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', ph.id, 'kind', ph.photo_kind, 'storage_path', ph.storage_path, 'position', ph.position)
               ORDER BY ph.photo_kind, ph.position) FROM public.shop_photos ph WHERE ph.shop_id = v_s.id), '[]'::jsonb),
    'created_at', v_s.created_at);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_get_shop(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_get_shop(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_review_category_suggestion(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_row  public.category_suggestions%ROWTYPE;
  v_to   text;
  v_n    integer;
BEGIN
  PERFORM public.require_feature('suggest_category');
  IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 300 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;

  -- Read plain, then serialize on the WORDS before locking any row: two admins
  -- deciding two suggestions with the same words would otherwise each hold one
  -- row and wait for the other's (a deadlock). normalized is generated from a
  -- column nothing updates, so the key is stable.
  SELECT * INTO v_row FROM public.category_suggestions WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_suggestion' USING ERRCODE = 'PT404';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('review_category_suggestion'),
                                hashtext(v_row.suggested_in || '|' || v_row.normalized));
  SELECT * INTO v_row FROM public.category_suggestions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_suggestion' USING ERRCODE = 'PT404';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'already_reviewed' USING ERRCODE = '55000';
  END IF;

  v_to := CASE WHEN p_approve THEN 'approved' ELSE 'declined' END;
  UPDATE public.category_suggestions s
     SET status = v_to, reviewed_by = v_uid, reviewed_at = now(),
         admin_note = NULLIF(btrim(p_note), '')
   WHERE s.status = 'pending'
     AND s.suggested_in = v_row.suggested_in
     AND s.normalized = v_row.normalized;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'review_category_suggestion', 'category_suggestion', p_id::text,
          jsonb_build_object('decision', v_to, 'area', v_row.suggested_in,
                             'suggestion', v_row.suggestion, 'resolved', v_n));
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_review_category_suggestion(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_category_suggestion(uuid, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_submit_ownership_proof(p_property_id uuid, p_storage_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT ownership_status INTO v_status FROM public.rental_properties
   WHERE id = p_property_id AND owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'already_approved' USING ERRCODE = '22023';
  END IF;
  -- The file must sit in the caller's own folder for THIS property.
  IF p_storage_path IS NULL
     OR p_storage_path !~ format('^%s/rentals/%s/[A-Za-z0-9._-]{1,100}$', v_uid, p_property_id) THEN
    RAISE EXCEPTION 'bad_proof_path' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_properties
     SET ownership_proof_path = p_storage_path, ownership_status = 'pending_review',
         ownership_submitted_at = now(), updated_at = now()
   WHERE id = p_property_id;
  -- Slice 3: tell every admin (the admin-queue alert path; it closes itself
  -- through admin_alert_close_rule 'rentals-ownership-review' once no proof
  -- waits). Once per property per waiting spell: a re-upload while it already
  -- waits does not page again. Best effort: a failed alert never refuses the
  -- landlord's upload.
  IF v_status IS DISTINCT FROM 'pending_review' THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id,
             'Ownership proof waits for review',
             'A landlord sent ownership proof for a property. Check it in Admin -> Settings -> Homes: ownership proof.',
             'admin_alert',
             '/admin?view=settings'
        FROM public.user_roles ur
       WHERE ur.role = 'admin'
         -- The seed boundary judged with the landlord as the actor (the link
         -- names none): a test landlord never pages a real admin (Q137).
         AND NOT public.notification_crosses_seed_boundary(ur.user_id, NULL, NULL, v_uid);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rentals_submit_ownership_proof: admin alert failed: %', SQLERRM;
    END;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_submit_ownership_proof(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_submit_ownership_proof(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_remove_question(p_question_id uuid, p_part text, p_note text, p_report_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  q public.declutter_questions%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF p_part IS NULL OR p_part NOT IN ('question', 'answer') THEN
    RAISE EXCEPTION 'invalid_part' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO q FROM public.declutter_questions WHERE id = p_question_id FOR UPDATE;
  IF NOT FOUND OR q.removed_at IS NOT NULL OR (p_part = 'answer' AND q.answer IS NULL) THEN
    RAISE EXCEPTION 'question_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF q.asker_id = v_uid OR EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = q.item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'own_question' USING ERRCODE = '42501';
  END IF;
  IF p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports rp
        WHERE rp.id = p_report_id AND rp.reported_type IN ('declutter_question', 'declutter_answer') AND rp.reported_id = p_question_id) THEN
    RAISE EXCEPTION 'report_not_for_question' USING ERRCODE = '22023';
  END IF;
  IF p_part = 'question' THEN
    UPDATE public.declutter_questions SET removed_at = now() WHERE id = p_question_id;
  ELSE
    UPDATE public.declutter_questions SET answer = NULL, answered_at = NULL WHERE id = p_question_id;
  END IF;
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE p_part WHEN 'question' THEN 'declutter_question_removed' ELSE 'declutter_answer_removed' END,
          'declutter_question', p_question_id::text,
          jsonb_build_object('note', NULLIF(v_note, ''), 'report_id', p_report_id, 'item_id', q.item_id,
                             'answer', CASE WHEN p_part = 'answer' THEN q.answer END));
  RETURN 'removed';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_admin_remove_question(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_remove_question(uuid, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_tenant_answer_fixed(p_request_id uuid, p_fixed boolean, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_landlord uuid;
  v_job uuid;
  v_leak text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_fixed IS NULL THEN
    RAISE EXCEPTION 'answer_required' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 500 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_note, '')), '') IS NOT NULL THEN
    v_leak := public.contact_leak_reason(p_note);
    IF v_leak IS NOT NULL THEN
      RAISE EXCEPTION 'contact_info_not_allowed' USING ERRCODE = '22023', DETAIL = v_leak;
    END IF;
  END IF;
  SELECT r.job_id INTO v_job FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.tenant_id = v_uid AND r.status = 'approved';
  IF NOT FOUND OR v_job IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Race class (check-race-class): the job's status decides this write, so the
  -- job row is held FOR SHARE until commit (a cancel or reopen waits). Job
  -- first, then the request, the same order link_maintenance_request_job takes,
  -- so the two never deadlock; the request is re-read under its lock and must
  -- still point at the job that was checked.
  PERFORM 1 FROM public.jobs j WHERE j.id = v_job
     AND j.status IN ('in_progress', 'pending_approval', 'completed', 'revision_requested', 'disputed')
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT r.landlord_id INTO v_landlord FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.tenant_id = v_uid AND r.status = 'approved' AND r.job_id = v_job
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.maintenance_requests
     SET tenant_says_fixed = p_fixed, tenant_fixed_note = nullif(btrim(coalesce(p_note, '')), ''),
         tenant_answered_at = now(), updated_at = now()
   WHERE id = p_request_id;
  PERFORM public.rentals_notify(v_landlord,
    CASE WHEN p_fixed THEN 'Tenant says it''s fixed' ELSE 'Tenant says it''s NOT fixed' END,
    'Your tenant answered "Was it fixed?". Check before you confirm the job.',
    '/rentals/requests/' || p_request_id::text, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_tenant_answer_fixed(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_tenant_answer_fixed(uuid, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_send_handover_message(p_talk_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_talk public.declutter_handover_talks%ROWTYPE;
  v_id uuid;
  v_to uuid;
  v_body text := btrim(COALESCE(p_body, ''));
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_talk FROM public.declutter_handover_talks t
   WHERE t.id = p_talk_id AND (t.buyer_id = v_uid OR t.seller_id = v_uid)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'talk_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_talk.closed_at IS NOT NULL OR v_talk.expires_at <= now() THEN
    RAISE EXCEPTION 'talk_closed' USING ERRCODE = '22023', HINT = 'This chat has ended.';
  END IF;
  IF public.are_users_blocked(v_talk.buyer_id, v_talk.seller_id) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023', HINT = 'Write a message of up to 1,000 characters.';
  END IF;
  -- At most 30 messages an hour from one person in one talk.
  IF (SELECT count(*) FROM public.declutter_handover_talk_messages m
       WHERE m.talk_id = p_talk_id AND m.sender_id = v_uid AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'message_rate_limited' USING ERRCODE = '42501', HINT = 'Slow down a little, then send again.';
  END IF;
  INSERT INTO public.declutter_handover_talk_messages (talk_id, sender_id, body)
  VALUES (p_talk_id, v_uid, v_body)
  RETURNING id INTO v_id;
  -- Tell the other side, at most once per 15 minutes, never with the words themselves.
  v_to := CASE WHEN v_uid = v_talk.buyer_id THEN v_talk.seller_id ELSE v_talk.buyer_id END;
  IF (v_to = v_talk.buyer_id AND (v_talk.buyer_notified_at IS NULL OR v_talk.buyer_notified_at < now() - interval '15 minutes'))
     OR (v_to = v_talk.seller_id AND (v_talk.seller_notified_at IS NULL OR v_talk.seller_notified_at < now() - interval '15 minutes')) THEN
    PERFORM public.declutter_notify(v_to, 'declutter_sales', 'New message about a handover',
      format('The %s sent you a message about how to hand over your Declutter sale.',
             CASE WHEN v_uid = v_talk.buyer_id THEN 'buyer' ELSE 'seller' END),
      CASE WHEN v_to = v_talk.buyer_id THEN '/declutter?tab=buying&talk=' ELSE '/declutter?tab=selling&talk=' END || p_talk_id::text, v_uid);
    UPDATE public.declutter_handover_talks
       SET buyer_notified_at = CASE WHEN v_to = buyer_id THEN now() ELSE buyer_notified_at END,
           seller_notified_at = CASE WHEN v_to = seller_id THEN now() ELSE seller_notified_at END
     WHERE id = p_talk_id;
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_send_handover_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_send_handover_message(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_send_message(p_task_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_side text;
  v_body text := btrim(COALESCE(p_body, ''));
  v_quiet boolean;
  v_id uuid;
  v_to uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock: a stranger never locks someone else's delivery.
  IF NOT EXISTS (SELECT 1 FROM public.helpr_tasks x WHERE x.id = p_task_id AND x.source_kind = 'declutter_delivery'
                   AND v_uid IN (x.helpr_id, x.customer_id, x.pickup_contact_id)) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  v_side := CASE WHEN t.helpr_id = v_uid THEN 'helpr' WHEN t.customer_id = v_uid THEN 'buyer' WHEN t.pickup_contact_id = v_uid THEN 'seller' END;
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.helpr_id IS NULL OR t.status NOT IN ('accepted', 'picked_up', 'delivered') THEN
    RAISE EXCEPTION 'talk_closed' USING ERRCODE = '22023', HINT = 'This chat has ended.';
  END IF;
  -- A blocked pair never reaches each other here, on either side of a three-way chat.
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[t.helpr_id, t.customer_id, t.pickup_contact_id]) AS other(id)
              WHERE other.id IS NOT NULL AND other.id <> v_uid AND public.are_users_blocked(v_uid, other.id)) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023', HINT = 'Write a message of up to 1,000 characters.';
  END IF;
  IF (SELECT count(*) FROM public.helpr_task_talk_messages m
       WHERE m.task_id = t.id AND m.sender_id = v_uid AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'message_rate_limited' USING ERRCODE = '42501', HINT = 'Slow down a little, then send again.';
  END IF;
  -- Money review 10-31 (2): only this run's messages keep a sender quiet, so a new Helpr is told of the first message
  -- the buyer or seller sends them, even one sent minutes after a message to the Helpr before.
  v_quiet := EXISTS (SELECT 1 FROM public.helpr_task_talk_messages m
                      WHERE m.task_id = t.id AND m.sender_id = v_uid AND m.created_at >= t.accepted_at
                        AND m.created_at > now() - interval '15 minutes');
  INSERT INTO public.helpr_task_talk_messages (task_id, sender_id, sender_side, body)
  VALUES (t.id, v_uid, v_side, v_body)
  RETURNING id INTO v_id;
  -- Tell the other two, at most once per 15 minutes from one sender, never with the words themselves.
  IF NOT v_quiet THEN
    FOREACH v_to IN ARRAY ARRAY[t.helpr_id, t.customer_id, t.pickup_contact_id] LOOP
      IF v_to IS NOT NULL AND v_to <> v_uid THEN
        PERFORM public.declutter_notify(v_to, 'declutter_sales', 'New message about a delivery',
          format('The %s sent a message about the delivery of "%s".', CASE v_side WHEN 'helpr' THEN 'Helpr' ELSE v_side END, t.title),
          CASE WHEN v_to = t.helpr_id THEN '/declutter?tab=deliver' WHEN v_to = t.customer_id THEN '/declutter?tab=buying' ELSE '/declutter?tab=selling' END,
          v_uid);
      END IF;
    END LOOP;
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_send_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_send_message(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_send_order_message(p_order_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_talk public.declutter_order_talks%ROWTYPE;
  v_body text := btrim(COALESCE(p_body, ''));
  v_until timestamptz;
  v_to uuid;
  v_title text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock: a stranger never locks someone else's order.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_orders x WHERE x.id = p_order_id AND (x.buyer_id = v_uid OR x.seller_id = v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_until := public.declutter_order_talk_until(o.id);
  IF v_until IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_until <= now() OR o.buyer_id IS NULL OR o.seller_id IS NULL THEN
    RAISE EXCEPTION 'talk_closed' USING ERRCODE = '22023', HINT = 'This chat has ended.';
  END IF;
  IF public.are_users_blocked(o.buyer_id, o.seller_id) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023', HINT = 'Write a message of up to 1,000 characters.';
  END IF;
  INSERT INTO public.declutter_order_talks (order_id) VALUES (o.id) ON CONFLICT (order_id) DO NOTHING;
  SELECT * INTO v_talk FROM public.declutter_order_talks t WHERE t.order_id = o.id FOR UPDATE;
  -- At most 30 messages an hour from one person in one chat.
  IF (SELECT count(*) FROM public.declutter_order_talk_messages m
       WHERE m.talk_id = v_talk.id AND m.sender_id = v_uid AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'message_rate_limited' USING ERRCODE = '42501', HINT = 'Slow down a little, then send again.';
  END IF;
  INSERT INTO public.declutter_order_talk_messages (talk_id, sender_id, sender_side, body)
  VALUES (v_talk.id, v_uid, v_side, v_body)
  RETURNING id INTO v_id;
  -- Tell the other side, at most once per 15 minutes, never with the words themselves; the item is named (Q2467).
  v_to := CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END;
  IF (v_side = 'seller' AND (v_talk.buyer_notified_at IS NULL OR v_talk.buyer_notified_at < now() - interval '15 minutes'))
     OR (v_side = 'buyer' AND (v_talk.seller_notified_at IS NULL OR v_talk.seller_notified_at < now() - interval '15 minutes')) THEN
    SELECT i.title INTO v_title
      FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.order_id = o.id
     ORDER BY c.created_at, c.id LIMIT 1;
    PERFORM public.declutter_notify(v_to, 'declutter_sales', 'New message about your order',
      format('The %s sent you a message about "%s".', v_side, COALESCE(v_title, 'your Declutter order')),
      CASE WHEN v_side = 'seller' THEN '/declutter?tab=buying&order_talk=' ELSE '/declutter?tab=selling&order_talk=' END || o.id::text,
      v_uid);
    UPDATE public.declutter_order_talks
       SET buyer_notified_at = CASE WHEN v_side = 'seller' THEN now() ELSE buyer_notified_at END,
           seller_notified_at = CASE WHEN v_side = 'buyer' THEN now() ELSE seller_notified_at END
     WHERE id = v_talk.id;
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_send_order_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_send_order_message(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_save_porch_place(p_place_id uuid, p_label text, p_address text, p_area text,
  p_lat numeric, p_lng numeric, p_weekdays smallint[], p_windows jsonb DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_days smallint[];
  v_pos smallint;
  v_id uuid;
  v_windows jsonb;
  v_old jsonb;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_label IS NULL OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 40
     OR p_address IS NULL OR char_length(btrim(p_address)) NOT BETWEEN 5 AND 300
     OR p_area IS NULL OR char_length(btrim(p_area)) NOT BETWEEN 1 AND 80
     OR p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'invalid_porch_place' USING ERRCODE = '22023',
      HINT = 'Give the place a name and its full address.';
  END IF;
  IF p_windows IS NOT NULL THEN
    -- The hours decide the days: a day with no hours is not a day at this place.
    IF NOT public.declutter_place_windows_valid(p_windows) THEN
      RAISE EXCEPTION 'invalid_place_hours' USING ERRCODE = '22023',
        HINT = 'Each time must end at least 30 minutes after it starts.';
    END IF;
    SELECT array_agg(DISTINCT (e ->> 'weekday')::smallint ORDER BY (e ->> 'weekday')::smallint) INTO v_days
      FROM jsonb_array_elements(p_windows) e;
    SELECT jsonb_agg(jsonb_build_object('weekday', (e ->> 'weekday')::int, 'starts', e ->> 'starts', 'ends', e ->> 'ends')
                     ORDER BY (e ->> 'weekday')::int, e ->> 'starts')
      INTO v_windows FROM jsonb_array_elements(p_windows) e;
  ELSE
    IF p_weekdays IS NULL OR EXISTS (SELECT 1 FROM unnest(p_weekdays) d WHERE d IS NULL OR d < 0 OR d > 6) THEN
      RAISE EXCEPTION 'invalid_porch_days' USING ERRCODE = '22023', HINT = 'Pick days from Sunday to Saturday.';
    END IF;
    SELECT coalesce(array_agg(DISTINCT d ORDER BY d), '{}') INTO v_days FROM unnest(p_weekdays) d;
  END IF;
  IF cardinality(v_days) = 0 THEN
    RAISE EXCEPTION 'invalid_porch_days' USING ERRCODE = '22023', HINT = 'Pick at least one day.';
  END IF;
  -- One save per seller at a time, so two new places never race for the same free position.
  PERFORM pg_advisory_xact_lock(hashtextextended('declutter_porch_places:' || v_uid::text, 0));
  IF p_place_id IS NOT NULL THEN
    SELECT pl.windows INTO v_old FROM public.declutter_porch_places pl WHERE pl.id = p_place_id AND pl.seller_id = v_uid;
    -- Days only (an older app build): the place keeps its own hours on the days it keeps.
    v_windows := coalesce(v_windows, public.declutter_place_windows_fill(v_old, v_uid, v_days));
    UPDATE public.declutter_porch_places
       SET label = btrim(p_label), address = btrim(p_address), area = btrim(p_area), lat = p_lat, lng = p_lng,
           weekdays = v_days, windows = v_windows, updated_at = now()
     WHERE id = p_place_id AND seller_id = v_uid
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'porch_place_not_found' USING ERRCODE = 'PT404';
    END IF;
    RETURN v_id;
  END IF;
  v_windows := coalesce(v_windows, public.declutter_place_windows_fill(NULL, v_uid, v_days));
  SELECT min(g)::smallint INTO v_pos FROM generate_series(0, 4) g
   WHERE NOT EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = v_uid AND pl.position = g);
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'porch_places_full' USING ERRCODE = '22023', HINT = 'You can save up to 5 pickup places.';
  END IF;
  INSERT INTO public.declutter_porch_places (seller_id, position, label, address, area, lat, lng, weekdays, windows)
  VALUES (v_uid, v_pos, btrim(p_label), btrim(p_address), btrim(p_area), p_lat, p_lng, v_days, v_windows)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_save_porch_place(uuid, text, text, text, numeric, numeric, smallint[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_save_porch_place(uuid, text, text, text, numeric, numeric, smallint[], jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_add_item_photo(p_item_id uuid, p_storage_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_pos smallint;
  v_id uuid;
  v_listed boolean;
  r record;
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
  -- DC-8: a draft, the seller's live listing, or one an edit sent back whose check is still pending.
  v_listed := v_item.status = 'live'
    OR (v_item.status = 'pending_review' AND v_item.live_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.declutter_item_private pv
           WHERE pv.item_id = p_item_id AND pv.ai_checked_at IS NULL AND pv.ai_flag_reason IS NULL));
  IF v_item.status <> 'draft' AND NOT v_listed THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- The path is the caller's own folder for THIS item, and the object is
  -- really there, uploaded by the caller.
  IF p_storage_path IS NULL
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_item_id::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          -- Images only: job-photos also takes video, and a video keeps its
          -- GPS atoms (the app's re-encode strips images only).
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;

  SELECT g.p INTO v_pos
    FROM generate_series(0, 11) AS g(p)
   WHERE NOT EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.item_id = p_item_id AND ph.position = g.p)
   ORDER BY g.p
   LIMIT 1;
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'A listing has at most 12 photos.';
  END IF;

  INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
  VALUES (p_item_id, v_uid, p_storage_path, v_pos)
  RETURNING id INTO v_id;
  UPDATE public.declutter_items SET updated_at = now() WHERE id = p_item_id;

  -- A live listing's new photo: the same rule as a big edit (declutter_edit_listing, 20261030071816).
  IF v_item.status = 'live' THEN
    FOR r IN
      SELECT DISTINCT o.buyer_id FROM public.declutter_offers o
       WHERE o.item_id = p_item_id AND o.status = 'open'
    LOOP
      PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing updated',
        format('The seller updated "%s". Check it before your offer is answered.', v_item.title),
        '/declutter/item/' || p_item_id::text, v_uid);
    END LOOP;
    UPDATE public.declutter_items
       SET status = 'pending_review', submitted_at = now(), updated_at = now()
     WHERE id = p_item_id;
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_add_item_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_add_item_photo(uuid, text) TO authenticated, service_role;

