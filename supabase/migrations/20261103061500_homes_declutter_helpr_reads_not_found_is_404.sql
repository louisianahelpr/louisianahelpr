-- Q2390 packet 13 (REGULAR packet, lead PASS 11-02): "not found" answers HTTP
-- 404, not 500, for fifteen read-only member-callable functions whose bodies
-- name money words (cents, refund, deposit, rent, delivery pay) but only READ
-- them: every one is STABLE with no INSERT, UPDATE or DELETE; none calls pg_net,
-- creates an order or sits on the checkout path; no edge function calls them.
-- (Homes listing, public listing, deposit and rent ledger; Declutter reply
-- listings, order problem, add-a-Helpr setup, admin problem talk, haul-away
-- state, refund request view; Shops shop items; Helpr task view, pickup
-- windows, same pickup slot and route suggestions.) Grants as on prod: EXECUTE
-- to authenticated and service_role, and also anon for rentals_public_listing.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   rentals_listing                        20261019071203 0b6423d381cb49efdc01b02e7148866e
--   declutter_my_reply_listings            20261031011531 47bba85e588d20c41bd8db882b0c8624
--   declutter_order_problem                20261030080104 d6264aaa9476bf2c7753e284f9b846a4
--   shops_shop_items                       20261017061157 efbc1a5761bcb8341c243a7326098e01
--   rentals_public_listing                 20261019071203 30887dae17a3549c93f7fc735beed822
--   rentals_deposit                        20261019082216 f84f2572b92bd6589782d8a99e62869f
--   helpr_task_pickup_windows              20261031145652 f404812b4ceb021d81f5e426e4c76c19
--   helpr_task_same_pickup_slot            20261031085000 9fe8ebc1099c0e1463c8b97345f4d53c
--   declutter_setup_helpr                  20261028201659 f6e9ec627234845cbbeeebec823fbdf8
--   declutter_admin_problem_talk           20261030042545 db1404c1c13d3d08381e06229585eb2a
--   declutter_haul_away_state              20261017070827 6c626a3191380038a8a2a1b3e887c7e2
--   rentals_rent_ledger                    20261019073106 d44ddc344fd74161484c67d1e7ce7499
--   declutter_refund_request_view          20261102041000 9de9ab4cd806ff05e71ad29bf4ef59e7
--   helpr_task_view                        20261031231150 4b446b64578bbd22de07a839c2c3ce94
--   helpr_route_suggestions                20261031102758 7524422544e03a2705627859ef9a46cf
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (19 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod. rentals_listing and rentals_public_listing were created with
-- CREATE FUNCTION in 20261019071203; restated here as CREATE OR REPLACE (they exist).

CREATE OR REPLACE FUNCTION public.rentals_listing(p_listing_id uuid)
RETURNS TABLE (
  id uuid,
  kind text,
  status text,
  headline text,
  description text,
  rent_cents integer,
  rent_frequency text,
  deposit_cents integer,
  sale_price_cents bigint,
  beds numeric,
  baths numeric,
  sq_ft integer,
  lot_sq_ft integer,
  year_built smallint,
  available_on date,
  lease_months_min smallint,
  lease_months_max smallint,
  pets text,
  pet_rules text,
  parking text,
  utilities_included text[],
  accepts_vouchers text,
  accessibility text[],
  city text,
  zip_code text,
  photo_refs text[],
  is_mine boolean,
  published_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rental_listings l
                  WHERE l.id = p_listing_id
                    AND ((l.owner_id = v_uid AND l.status <> 'removed') OR public.rentals_listing_visible(l.id))) THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
  SELECT l.id, l.kind, l.status, l.headline, l.description, l.rent_cents, l.rent_frequency, l.deposit_cents,
         l.sale_price_cents, l.beds, l.baths, l.sq_ft, l.lot_sq_ft, l.year_built, l.available_on, l.lease_months_min,
         l.lease_months_max, l.pets, l.pet_rules, l.parking, l.utilities_included, l.accepts_vouchers, l.accessibility,
         rp.city, rp.zip_code,
         -- The owner's own page shows a draft or paused listing too: owner refs; anyone else's are member refs.
         ARRAY(SELECT public.rentals_photo_ref(ph.id, CASE WHEN l.owner_id = v_uid THEN 'o' ELSE 'm' END)
                 FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position),
         l.owner_id = v_uid, l.published_at, l.expires_at
    FROM public.rental_listings l
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE l.id = p_listing_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_listing(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_my_reply_listings(p_wanted_id uuid)
 RETURNS TABLE(id uuid, title text, current_price_cents integer, refuses text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  w public.declutter_wanted%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO w FROM public.declutter_wanted d WHERE d.id = p_wanted_id;
  IF w.id IS NULL OR NOT w.public OR w.status <> 'open' OR w.expires_at <= now() OR w.user_id = v_uid
     OR public.are_users_blocked(v_uid, w.user_id)
     OR public.declutter_member_out(w.user_id)
     OR public.member_under_18(w.user_id)
     OR public.declutter_seller_hidden(w.user_id)
     OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())) THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
    SELECT i.id, i.title, i.current_price_cents,
           CASE
             WHEN (public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles) IS NOT TRUE THEN 'too_far'
             WHEN EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.item_id = i.id AND o.status = 'open') THEN 'open_offer'
           END
      FROM public.declutter_items i
     WHERE i.seller_id = v_uid
       AND i.status = 'live'
       AND NOT (i.is_seed IS TRUE AND public.seed_hidden_for(w.user_id))
     ORDER BY i.created_at DESC, i.id
     LIMIT 100;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_my_reply_listings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_reply_listings(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_order_problem(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o record;
  p record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT x.id, x.buyer_id, x.seller_id INTO o FROM public.declutter_orders x WHERE x.id = p_order_id;
  -- The two sides of the sale and admins; a stranger is not told the order exists.
  IF o.id IS NULL
     OR NOT (o.buyer_id IS NOT DISTINCT FROM v_uid AND o.buyer_id IS NOT NULL
             OR o.seller_id IS NOT DISTINCT FROM v_uid AND o.seller_id IS NOT NULL
             OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT x.id, x.reporter_side, x.reason, x.note, x.photo_paths, x.status, x.created_at,
         x.other_side_note, x.other_side_photo_paths, x.decision, x.decided_at
    INTO p
    FROM public.declutter_problems x
   WHERE x.order_id = o.id
   ORDER BY x.created_at DESC, x.id DESC
   LIMIT 1;
  IF p.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', p.id,
    'reporter_side', p.reporter_side,
    'reason', p.reason,
    'note', p.note,
    'photo_paths', COALESCE(to_jsonb(p.photo_paths), '[]'::jsonb),
    'status', p.status,
    'created_at', p.created_at,
    'other_side_note', p.other_side_note,
    'other_side_photo_paths', COALESCE(to_jsonb(p.other_side_photo_paths), '[]'::jsonb),
    -- DB-12: what Louisiana Helpr decided (refund_buyer, refund_part, pay_seller or delivery_damage) and when; NULL while open.
    'decision', p.decision,
    'decided_at', p.decided_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_order_problem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_problem(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_shop_items(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_mine boolean;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_mine := EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.owner_id = v_uid);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', i.id,
             'kind', i.kind,
             'subtype', i.subtype,
             'status', CASE WHEN v_mine THEN i.status ELSE 'live' END,
             'title', i.title,
             'description', i.description,
             'price_cents', i.price_cents,
             'lead_time_days', i.lead_time_days,
             'stock_count', i.stock_count,
             'home_kitchen', i.kind = 'home_food',
             'photos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ph.id, 'storage_path', ph.storage_path, 'position', ph.position)
                                          ORDER BY ph.position)
                                   FROM public.shop_item_photos ph WHERE ph.item_id = i.id), '[]'::jsonb))
           ORDER BY i.live_at DESC NULLS FIRST, i.created_at DESC, i.id)
      FROM public.shop_items i
     WHERE i.shop_id = p_shop_id
       AND (CASE WHEN v_mine THEN i.status <> 'withdrawn'
                 -- D12: a shop that turned selling off shows visitors no items.
                 ELSE i.status = 'live' AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.offers_selling) END)), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_shop_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_shop_items(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_public_listing(p_slug text)
RETURNS TABLE (
  kind text,
  headline text,
  description text,
  rent_cents integer,
  rent_frequency text,
  deposit_cents integer,
  sale_price_cents bigint,
  beds numeric,
  baths numeric,
  sq_ft integer,
  lot_sq_ft integer,
  year_built smallint,
  available_on date,
  lease_months_min smallint,
  lease_months_max smallint,
  pets text,
  pet_rules text,
  parking text,
  utilities_included text[],
  accepts_vouchers text,
  accessibility text[],
  city text,
  zip_code text,
  photo_refs text[],
  published_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT l.id INTO v_id FROM public.rental_listings l WHERE l.slug = p_slug;
  IF v_id IS NULL OR NOT public.rentals_public_listing_visible(v_id) THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
  -- A stranger never gets home size + lot size + year built next to the ZIP of a home FOR SALE: together
  -- they name the parcel in the assessor's records (review fix #5). Signed-in members see them on the page.
  -- Nor a headline or description that could name the street, the year or the lot (must-fix 4): for a home
  -- for sale a stranger gets a plain headline and no description; signed-in members read the owner's words.
  SELECT l.kind,
         CASE WHEN l.kind = 'sale' THEN trim_scale(l.beds)::text || ' bed, ' || trim_scale(l.baths)::text || ' bath home for sale'
              ELSE l.headline END,
         CASE WHEN l.kind = 'sale' THEN NULL ELSE l.description END,
         l.rent_cents, l.rent_frequency, l.deposit_cents, l.sale_price_cents,
         l.beds, l.baths,
         CASE WHEN l.kind = 'sale' THEN NULL ELSE l.sq_ft END,
         CASE WHEN l.kind = 'sale' THEN NULL ELSE l.lot_sq_ft END,
         CASE WHEN l.kind = 'sale' THEN NULL::smallint ELSE l.year_built END,
         l.available_on, l.lease_months_min, l.lease_months_max,
         l.pets, l.pet_rules, l.parking, l.utilities_included, l.accepts_vouchers, l.accessibility,
         rp.city, rp.zip_code,
         ARRAY(SELECT public.rentals_photo_ref(ph.id, 'p') FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position),
         l.published_at
    FROM public.rental_listings l
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE l.id = v_id;
END;
$fn$;

-- Prod grants this one to anon too (a public listing page): restated as on prod.
REVOKE ALL ON FUNCTION public.rentals_public_listing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rentals_public_listing(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_deposit(p_tenancy_id uuid)
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
  v_d public.rental_deposits%ROWTYPE;
  v_due date;
  v_visible boolean;
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
  SELECT * INTO v_d FROM public.rental_deposits WHERE tenancy_id = p_tenancy_id;
  v_visible := v_t.status = 'ended'
               AND (v_t.ended_by = 'tenant' OR (v_t.lease_ends_on IS NOT NULL AND v_t.lease_ends_on <= public.shop_local_today()));
  v_due := CASE WHEN v_t.status = 'ended' AND v_t.ended_at IS NOT NULL
                THEN ((v_t.ended_at AT TIME ZONE 'America/Chicago')::date + interval '1 month')::date END;
  RETURN jsonb_build_object(
    'side', v_side,
    'tenancy_status', v_t.status,
    'ended_by', v_t.ended_by,
    'lease_ends_on', v_t.lease_ends_on,
    -- The landlord may still record it: live, or ended in the last 30 days, and not settled.
    'can_record', v_side = 'landlord' AND v_d.settled_at IS NULL
                  AND (v_t.status = 'active' OR v_t.ended_at > now() - interval '30 days'),
    'forwarding_address', CASE WHEN v_side = 'tenant' OR v_visible THEN v_d.forwarding_address END,
    'has_forwarding_address', v_d.forwarding_address IS NOT NULL,
    'address_visible_to_landlord', v_visible AND v_d.forwarding_address IS NOT NULL,
    'deposit', CASE WHEN v_d.amount_cents IS NULL THEN NULL ELSE jsonb_build_object(
      'amount_cents', v_d.amount_cents,
      'received_on', v_d.received_on,
      'return_by', v_due,
      'returned_cents', v_d.returned_cents,
      'deductions', v_d.deductions,
      'returned_on', v_d.returned_on,
      'settled_at', v_d.settled_at) END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_deposit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_deposit(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_pickup_windows(p_task_id uuid)
RETURNS TABLE(weekday smallint, starts time, ends time, latest_pickup_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  t public.helpr_tasks;
  o public.declutter_orders;
  v_hours jsonb;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  -- helpr_tasks_open_near's own filter, for this one task.
  SELECT * INTO t FROM public.helpr_tasks x
   WHERE x.id = p_task_id AND x.source_kind = 'declutter_delivery'
     AND x.status = 'open' AND x.open_until > now()
     AND v_uid IS DISTINCT FROM x.customer_id AND v_uid IS DISTINCT FROM x.pickup_contact_id
     AND public.helpr_task_vehicle_fits(v_uid, x.size)
     AND NOT public.are_users_blocked(v_uid, x.customer_id)
     AND NOT public.are_users_blocked(v_uid, x.pickup_contact_id)
     AND public.helpr_task_same_stripe_mode(v_uid, x.customer_id)
     -- BUY-41 (new): as helpr_tasks_open_near.
     AND NOT EXISTS (SELECT 1 FROM public.helpr_task_events e
                      WHERE e.task_id = x.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show'))
     AND NOT public.helpr_task_source_held(x.source_kind, x.source_id);
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- LEAD-PLACE-TIMES: the hours frozen on the order at the place the buyer picked, else the usual times.
  SELECT hp.windows INTO v_hours FROM public.declutter_order_porch_places hp WHERE hp.order_id = o.id;
  IF v_hours IS NOT NULL THEN
    RETURN QUERY
      SELECT (e ->> 'weekday')::smallint, (e ->> 'starts')::time, (e ->> 'ends')::time,
             LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')
        FROM jsonb_array_elements(v_hours) e
       ORDER BY 1, 2;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT w.weekday, w.starts_local, w.ends_local, LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')
      FROM public.declutter_pickup_windows w
     WHERE w.seller_id = o.seller_id
     ORDER BY w.weekday, w.starts_local;
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_pickup_windows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_pickup_windows(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_same_pickup_slot(p_task_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  t public.helpr_tasks;
  o public.declutter_orders;
  v_slot timestamptz;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  -- helpr_task_pickup_windows' own filter, for this one task.
  SELECT * INTO t FROM public.helpr_tasks x
   WHERE x.id = p_task_id AND x.source_kind = 'declutter_delivery'
     AND x.status = 'open' AND x.open_until > now()
     AND v_uid IS DISTINCT FROM x.customer_id AND v_uid IS DISTINCT FROM x.pickup_contact_id
     AND public.helpr_task_vehicle_fits(v_uid, x.size)
     AND NOT public.are_users_blocked(v_uid, x.customer_id)
     AND NOT public.are_users_blocked(v_uid, x.pickup_contact_id)
     AND public.helpr_task_same_stripe_mode(v_uid, x.customer_id)
     -- BUY-41 (new): as helpr_tasks_open_near.
     AND NOT EXISTS (SELECT 1 FROM public.helpr_task_events e
                      WHERE e.task_id = x.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show'))
     AND NOT public.helpr_task_source_held(x.source_kind, x.source_id);
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- The caller's own coming pickup from this seller at this place (within 50 m), if helpr_task_accept would take it.
  SELECT min(x.pickup_slot_start) INTO v_slot
    FROM public.helpr_tasks x
   WHERE x.helpr_id = v_uid AND x.status = 'accepted' AND x.id <> t.id
     AND x.pickup_contact_id = t.pickup_contact_id
     AND public.helpr_task_distance_m(x.pickup_lat, x.pickup_lng, t.pickup_lat, t.pickup_lng) <= 50
     AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)
     AND x.pickup_slot_start > now()
     AND x.pickup_slot_start + interval '30 minutes' <= LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')
     AND public.helpr_task_source_slot_ok(t.source_kind, t.source_id, x.pickup_slot_start);
  RETURN v_slot;
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_same_pickup_slot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_same_pickup_slot(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_setup_helpr(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_add_helpr');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders
   WHERE id = p_order_id AND buyer_id = v_uid;
  -- A seller who can no longer sell (banned, suspended, 3 strikes, ...:
  -- declutter_seller_out) leaves an order that is about to be refunded:
  -- nothing is offered on it (lh-money-escrow review of 4f45a073f #2).
  IF NOT FOUND OR o.status NOT IN ('paid', 'handed_over')
     OR (o.status = 'handed_over' AND COALESCE(o.handed_over_at, o.paid_at, '-infinity'::timestamptz) < now() - interval '30 days')
     OR public.declutter_seller_out(o.seller_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'status', o.status,
    'handover', o.handover,
    'items', COALESCE((
      SELECT jsonb_agg(i.title ORDER BY c.created_at, i.id)
        FROM public.declutter_cart_items c
        JOIN public.declutter_items i ON i.id = c.item_id
       WHERE c.order_id = o.id AND c.buyer_id = v_uid), '[]'::jsonb),
    -- 20261028201659: what each item is, same order as 'items' (#27: no "Hang it on the wall" for a mug).
    'item_details', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('title', i.title, 'category', i.category, 'delivery_size', i.delivery_size)
                       ORDER BY c.created_at, i.id)
        FROM public.declutter_cart_items c
        JOIN public.declutter_items i ON i.id = c.item_id
       WHERE c.order_id = o.id AND c.buyer_id = v_uid), '[]'::jsonb),
    'pickup_at', (SELECT b.slot_start FROM public.declutter_bookings b WHERE b.order_id = o.id),
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'job_id', j.id, 'title', j.title, 'category', j.category::text,
               'status', j.status, 'payment_status', j.payment_status)
             ORDER BY l.created_at, j.id)
        FROM public.declutter_order_jobs l
        JOIN public.jobs j ON j.id = l.job_id
       WHERE l.order_id = o.id AND j.customer_id = v_uid), '[]'::jsonb));
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_setup_helpr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_setup_helpr(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_problem_talk(p_problem_id uuid)
 RETURNS TABLE(kind text, side text, body text, said_at timestamp with time zone, answer text, answered_at timestamp with time zone, removed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_order public.declutter_orders%ROWTYPE;
  v_from timestamptz;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  SELECT o.* INTO v_order
    FROM public.declutter_problems p JOIN public.declutter_orders o ON o.id = p.order_id
   WHERE p.id = p_problem_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- The order's own window: from its first line entering the cart to the payment (a talk opens only while a line is
  -- in the cart, so a chat about an earlier or later sale between the same two is not this order's).
  SELECT min(c.created_at) INTO v_from FROM public.declutter_cart_items c WHERE c.order_id = v_order.id;
  RETURN QUERY
    SELECT x.kind, x.side, x.body, x.said_at, x.answer, x.answered_at, x.removed
      FROM (
        SELECT 'chat'::text AS kind,
               CASE WHEN m.sender_id = t.buyer_id THEN 'buyer' ELSE 'seller' END AS side,
               m.body, m.created_at AS said_at, NULL::text AS answer, NULL::timestamptz AS answered_at, false AS removed,
               m.id AS sort_id
          FROM public.declutter_handover_talks t
          JOIN public.declutter_handover_talk_messages m ON m.talk_id = t.id
         WHERE t.buyer_id = v_order.buyer_id AND t.seller_id = v_order.seller_id
           AND t.opened_at >= COALESCE(v_from, v_order.created_at)
           AND t.opened_at <= COALESCE(v_order.paid_at, now())
        UNION ALL
        SELECT 'question'::text,
               CASE WHEN q.asker_id = v_order.buyer_id THEN 'buyer' ELSE 'another_member' END,
               q.question, q.created_at, q.answer, q.answered_at, q.removed_at IS NOT NULL,
               q.id
          FROM public.declutter_questions q
         WHERE q.item_id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = v_order.id)
        UNION ALL
        -- D2-1: the chat after payment, this order's only (one chat per order). The side is the message's own.
        SELECT 'order_chat'::text,
               om.sender_side,
               om.body, om.created_at, NULL::text, NULL::timestamptz, false,
               om.id
          FROM public.declutter_order_talks ot
          JOIN public.declutter_order_talk_messages om ON om.talk_id = ot.id
         WHERE ot.order_id = v_order.id
      ) x
     ORDER BY x.said_at, x.sort_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_admin_problem_talk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_problem_talk(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_haul_away_state(p_item_ids uuid[] DEFAULT NULL)
RETURNS TABLE(item_id uuid, title text, description text, delivery_size text, item_status text,
              state text, eligible_at timestamptz, job_id uuid, pickup_group text, photo_paths text[],
              job_hold text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_haul_away');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_item_ids IS NOT NULL AND cardinality(p_item_ids) > 10 THEN
    RAISE EXCEPTION 'haul_away_too_many' USING ERRCODE = '22023';
  END IF;
  -- Asked for by id: every id must be the caller's (never "exists but not yours").
  IF p_item_ids IS NOT NULL AND EXISTS (
       SELECT 1 FROM unnest(p_item_ids) x(id)
        WHERE NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = x.id AND i.seller_id = v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;

  RETURN QUERY
    WITH mine AS (
      SELECT i.*, COALESCE(i.live_at, i.submitted_at, i.created_at) + interval '14 days' AS due
        FROM public.declutter_items i
       WHERE i.seller_id = v_uid
         AND (CASE WHEN p_item_ids IS NULL THEN i.status IN ('live', 'ended') ELSE i.id = ANY (p_item_ids) END)
    ),
    held AS (
      SELECT m.*, h.item_id AS linked, h.job_id AS link_job,
             CASE
               WHEN h.item_id IS NULL THEN NULL
               WHEN j.id IS NULL THEN 'none'
               WHEN COALESCE(j.payment_status, 'unpaid') = 'refunded' AND j.status IN ('completed', 'disputed') THEN 'none'
               WHEN j.status = 'completed' THEN 'hauled'
               WHEN j.status = 'cancelled' AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed', 'refunded', 'cancelled') THEN 'none'
               WHEN j.status = 'open' AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed')
                 THEN CASE WHEN j.stripe_session_id IS NOT NULL AND COALESCE(j.payment_status, 'unpaid') <> 'abandoned' THEN 'paying'
                           WHEN j.payment_status = 'failed' THEN 'job_stuck'
                           ELSE 'job_open' END
               ELSE 'booked'
             END AS hold
        FROM mine m
        LEFT JOIN public.declutter_haul_aways h ON h.item_id = m.id
        LEFT JOIN public.jobs j ON j.id = h.job_id
    )
    SELECT m.id, m.title, m.description, m.delivery_size, m.status,
           CASE
             WHEN m.hold = 'hauled' THEN 'hauled'
             WHEN m.hold = 'booked' THEN 'booked'
             WHEN m.hold = 'paying' THEN 'paying'
             WHEN m.hold IN ('none', 'job_open', 'job_stuck') AND m.status = 'ended' THEN 'unpaid'
             WHEN m.status IN ('reserved', 'sold', 'completed')
                  OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                              WHERE c.item_id = m.id AND c.status IN ('in_cart', 'paid')) THEN 'in_sale'
             WHEN m.linked IS NOT NULL THEN 'not_unsold'
             WHEN m.status = 'ended' THEN 'eligible'
             WHEN m.status = 'live' AND m.due <= now() THEN 'eligible'
             WHEN m.status = 'live' THEN 'too_soon'
             ELSE 'not_unsold'
           END,
           CASE WHEN m.status = 'live' THEN m.due END,
           m.link_job,
           -- Salted with the seller's id: never a fingerprint of a home address.
           md5(v_uid::text || ':' || lower(regexp_replace(COALESCE(p.pickup_address, ''), '\s+', '', 'g'))),
           COALESCE((SELECT array_agg(ph.storage_path ORDER BY ph.position)
                       FROM public.declutter_item_photos ph WHERE ph.item_id = m.id), ARRAY[]::text[]),
           m.hold
      FROM held m
      LEFT JOIN public.declutter_item_private p ON p.item_id = m.id
     ORDER BY m.due, m.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_haul_away_state(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_haul_away_state(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_rent_ledger(p_tenancy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_side text;
  v_plan public.rental_rent_plans%ROWTYPE;
  v_owed bigint;
  v_paid bigint;
  v_t public.rental_tenancies%ROWTYPE;
  v_today date := public.shop_local_today();
BEGIN
  PERFORM public.require_feature('rentals');
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- An ended tenancy's record stays readable by both sides.
  SELECT * INTO v_t FROM public.rental_tenancies t WHERE t.id = p_tenancy_id;
  v_side := CASE WHEN v_t.landlord_id = v_uid THEN 'landlord' WHEN v_t.tenant_id = v_uid THEN 'tenant' END;
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO v_plan FROM public.rental_rent_plans WHERE tenancy_id = p_tenancy_id;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_owed FROM public.rental_rent_charges
   WHERE tenancy_id = p_tenancy_id AND waived_at IS NULL AND due_on <= v_today;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_paid FROM public.rental_rent_payments
   WHERE tenancy_id = p_tenancy_id AND status = 'confirmed';
  RETURN jsonb_build_object(
    'side', v_side,
    'tenancy_status', v_t.status,
    'lease_ends_on', v_t.lease_ends_on,
    -- Writes stay open while the tenancy is live and for 90 days after it ended (then read-only).
    'open', v_t.status = 'active' OR (v_t.status = 'ended' AND v_t.ended_at > now() - interval '90 days'),
    'open_until', CASE WHEN v_t.status = 'ended' THEN ((v_t.ended_at + interval '90 days') AT TIME ZONE 'America/Chicago')::date END,
    -- Which home (for the receipts, R5): the property label, unit, city and ZIP; never the other side's id.
    'home', (SELECT jsonb_build_object('label', rp.label, 'unit_label', u.label, 'city', rp.city, 'zip_code', rp.zip_code)
               FROM public.rental_tenancies t
               JOIN public.rental_properties rp ON rp.id = t.property_id
               JOIN public.rental_units u ON u.id = t.unit_id
              WHERE t.id = p_tenancy_id),
    'plan', CASE WHEN v_plan.tenancy_id IS NULL THEN NULL ELSE jsonb_build_object(
      'amount_cents', v_plan.amount_cents, 'frequency', v_plan.frequency, 'first_due_on', v_plan.first_due_on,
      'grace_days', v_plan.grace_days, 'late_fee_cents', v_plan.late_fee_cents, 'pay_methods', to_jsonb(v_plan.pay_methods),
      'next_due_on', CASE WHEN v_t.status = 'active' THEN public.rentals_rent_next_due(v_plan.first_due_on, v_plan.frequency,
                       GREATEST(v_today + 1, (SELECT COALESCE(max(due_on) + 1, v_today) FROM public.rental_rent_charges
                                                   WHERE tenancy_id = p_tenancy_id AND kind = 'rent'))) END) END,
    'balance_cents', v_owed - v_paid,
    'charges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'due_on', c.due_on,
                          'amount_cents', c.amount_cents, 'waived', c.waived_at IS NOT NULL) ORDER BY c.due_on, c.kind)
                          FROM public.rental_rent_charges c WHERE c.tenancy_id = p_tenancy_id), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
                          'method', p.pay_method, 'reported_by', p.reported_by, 'status', p.status, 'decline_reason', p.decline_reason,
                          'decided_at', p.decided_at, 'corrections', p.corrections,
                          'correctable_until', CASE WHEN p.status = 'confirmed' AND p.decided_at > now() - interval '30 days'
                                                    THEN p.decided_at + interval '30 days' END,
                          'disputes', p.tenant_disputes)
                          ORDER BY p.paid_on, p.created_at)
                          FROM public.rental_rent_payments p WHERE p.tenancy_id = p_tenancy_id), '[]'::jsonb));
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_rent_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_rent_ledger(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_request_view(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_side text;
  v_refund public.declutter_refunds;
  v_show_address boolean;
  v_drop_address text;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF o.id IS NULL OR v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE order_id = o.id;
  IF r.refund_id IS NOT NULL THEN
    SELECT * INTO v_refund FROM public.declutter_refunds WHERE id = r.refund_id;
  END IF;
  v_show_address := COALESCE(r.status = 'returning' AND r.return_way = 'collect', false);
  -- CHANGED (BUY-23, owner 10-30): only while a drop-off is open, and only where the seller offered pickup: the same
  -- points the drop-off photo is measured from (declutter_return_dropped_off).
  IF r.status = 'returning' AND r.return_way = 'drop_off' AND o.handover IN ('pickup_home', 'porch') THEN
    SELECT string_agg(DISTINCT pt.address, '; ') INTO v_drop_address FROM public.declutter_order_pickup_points(o.id) pt;
  END IF;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'side', v_side,
    'handed_over', o.status = 'handed_over',
    'window_ends_at', CASE WHEN o.status = 'handed_over' THEN o.handed_over_at + interval '24 hours' END,
    'can_ask', COALESCE(v_side = 'buyer' AND o.status = 'handed_over' AND r.id IS NULL
               AND now() < o.handed_over_at + interval '24 hours'
               AND NOT public.declutter_sale_decided(o.id) AND public.declutter_payout_unsent(o.id)
               AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open'), false),
    'can_report', COALESCE(v_side = 'buyer' AND public.declutter_problem_window_open(o.id)
                  AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open'), false),
    'items_cents', o.items_cents,
    'full_refund_cents', public.declutter_full_refund_cents(o.id),
    -- BUY-25: never got it, the seller refunds in full: everything back, less a delivery a Helpr already made.
    'never_got_it_refund_cents', o.total_cents - public.declutter_delivery_reserved_cents(o.id),
    'delivery_kept_cents', public.declutter_delivery_reserved_cents(o.id),
    'can_drop_off', o.handover IN ('pickup_home', 'porch'),
    'request', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'status', r.status, 'reason', r.reason, 'note', r.note, 'answer_by', r.answer_by,
      -- D2-3: the buyer's photos (both sides read them through declutter-handover's read rule: the two parties and admins).
      'photo_paths', COALESCE(r.photo_paths, '{}'),
      'offer_cents', r.offer_cents, 'offer_answer_by', r.offer_answer_by, 'declined_at', r.declined_at,
      'return_by', r.return_by, 'returned_at', r.returned_at,
      'report_until', CASE WHEN r.status = 'declined' THEN greatest(r.declined_at, o.handed_over_at) + interval '24 hours' END,
      'refund_cents', v_refund.refund_cents, 'refund_status', v_refund.status, 'created_at', r.created_at,
      -- D2-5: the request ended with Louisiana Helpr's decision (not the seller's answer), so the panel says so.
      'admin_decided', r.status IN ('agreed', 'declined')
                       AND EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.id = r.problem_id AND x.status = 'decided'),
      'return_way', r.return_way, 'return_day', r.return_day, 'return_at', r.return_at,
      'return_dropped_off_at', r.return_dropped_off_at,
      'return_deadline', CASE WHEN r.status = 'returning' THEN public.declutter_return_backstop_at(r) END,
      'return_address', CASE WHEN v_show_address THEN r.return_address END,
      'return_lat', CASE WHEN v_show_address THEN r.return_lat END,
      'return_lng', CASE WHEN v_show_address THEN r.return_lng END,
      'drop_off_address', v_drop_address,
      -- CHANGED (A3-74): the seller's side (both parties read it; the photos through declutter-handover's read rule),
      -- the problem Louisiana Helpr decides, and when it usually decides (display only; nothing happens on its own).
      'seller_note', r.seller_note, 'seller_photo_paths', COALESCE(r.seller_photo_paths, '{}'),
      'problem_id', r.problem_id,
      'decide_by', (SELECT x.decide_by FROM public.declutter_problems x WHERE x.id = r.problem_id AND x.status = 'open')) END);
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_refund_request_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_view(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_view(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_role text;
  v_active boolean;
  v_drop_shown boolean;
  v_helpr_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_role := CASE WHEN t.helpr_id = v_uid THEN 'helpr'
                 WHEN t.customer_id = v_uid THEN 'customer'
                 WHEN t.pickup_contact_id = v_uid THEN 'pickup_contact' END;
  IF v_role IS NULL THEN
    -- An open task is visible to a Helpr who could take it (area words only).
    PERFORM public.helpr_task_source_require_feature(t.source_kind);
    PERFORM public.helpr_task_assert_helpr();
    -- The same checks helpr_tasks_open_near applies (lh-authz-rls #8).
    IF t.status <> 'open' OR t.open_until <= now() OR NOT public.helpr_task_vehicle_fits(v_uid, t.size)
       OR public.are_users_blocked(v_uid, t.customer_id) OR public.are_users_blocked(v_uid, t.pickup_contact_id)
       OR NOT public.helpr_task_same_stripe_mode(v_uid, t.customer_id) THEN
      RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
    END IF;
    v_role := 'candidate';
  END IF;
  v_active := t.status IN ('accepted', 'picked_up', 'delivered');
  v_drop_shown := v_role = 'helpr' AND v_active
                  AND COALESCE(now() > public.helpr_task_dropoff_shows_at(t.helpr_id, t.status, t.pickup_slot_start), false);
  SELECT NULLIF(split_part(COALESCE(public.member_display_name(pr.full_name, NULL), ''), ' ', 1), '') INTO v_helpr_name
    FROM public.profiles pr WHERE pr.user_id = t.helpr_id;
  RETURN jsonb_build_object(
    'task_id', t.id, 'source_kind', t.source_kind, 'source_id', CASE WHEN v_role <> 'candidate' THEN t.source_id END,
    'role', v_role, 'status', t.status, 'size', t.size, 'title', t.title,
    'pickup_area', t.pickup_area, 'dropoff_area', t.dropoff_area, 'trip_miles', t.trip_miles,
    'take_home_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents) END,
    'pay_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.pay_cents END,
    'fee_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.fee_cents END,
    'open_until', t.open_until, 'latest_pickup_at', t.latest_pickup_at,
    'pickup_slot_start', t.pickup_slot_start, 'accepted_at', t.accepted_at,
    'picked_up_at', t.picked_up_at, 'delivered_at', t.delivered_at, 'confirmed_at', t.confirmed_at,
    'confirmed_by', t.confirmed_by,
    'helpr_first_name', CASE WHEN v_role IN ('customer', 'pickup_contact') THEN v_helpr_name END,
    'pickup_address', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_address END,
    'pickup_lat', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_lat END,
    'pickup_lng', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_lng END,
    'dropoff_address', CASE WHEN v_drop_shown THEN t.dropoff_address END,
    'dropoff_lat', CASE WHEN v_drop_shown THEN t.dropoff_lat END,
    'dropoff_lng', CASE WHEN v_drop_shown THEN t.dropoff_lng END,
    'pickup_photo_path', CASE WHEN v_role <> 'candidate' THEN t.pickup_photo_path END,
    'dropoff_photo_path', CASE WHEN v_role <> 'candidate' THEN t.dropoff_photo_path END,
    -- 20261030012018: the seller's "Handed over" (only while it is for the current Helpr), and a problem
    -- holding the sale (the Helpr's "The seller wasn't there" among them), for the three parties only.
    'handed_over_at', CASE WHEN v_role <> 'candidate' AND t.helpr_id IS NOT NULL AND t.handed_over_to = t.helpr_id THEN t.handed_over_at END,
    'problem_open', CASE WHEN v_role <> 'candidate' THEN public.helpr_task_source_held(t.source_kind, t.source_id) END,
    -- BUY-36: where a delivery the Helpr can't finish stands, for the three parties. The collect note is for the two who meet.
    'stuck_stage', CASE WHEN v_role <> 'candidate' THEN t.stuck_stage END,
    'stuck_reason', CASE WHEN v_role <> 'candidate' THEN t.stuck_reason END,
    'stuck_note', CASE WHEN v_role <> 'candidate' THEN t.stuck_note END,
    'stuck_fault', CASE WHEN v_role <> 'candidate' THEN t.stuck_fault END,
    'stuck_fix_by', CASE WHEN v_role <> 'candidate' THEN t.stuck_fix_by END,
    'stuck_fix_note', CASE WHEN v_role IN ('helpr', 'customer') THEN t.stuck_fix_note END,
    'stuck_return_by', CASE WHEN v_role <> 'candidate' THEN t.stuck_return_by END,
    'stuck_choice', CASE WHEN v_role IN ('helpr', 'customer') THEN t.stuck_choice END,
    'stuck_choice_by', CASE WHEN v_role = 'customer' THEN t.stuck_choice_by END,
    'stuck_collect_note', CASE WHEN v_role IN ('helpr', 'customer') THEN t.stuck_collect_note END,
    'returned_at', CASE WHEN v_role <> 'candidate' THEN t.returned_at END,
    'return_photo_path', CASE WHEN v_role <> 'candidate' THEN t.return_photo_path END,
    'return_answer_by', CASE WHEN v_role <> 'candidate' THEN t.return_answer_by END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_view(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_route_suggestions(p_with_task uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  w public.helpr_tasks;
  t public.helpr_tasks;
  v_base jsonb := '[]'::jsonb;
  v_base_plan jsonb;
  v_plan jsonb;
  v_best jsonb;
  v_order jsonb;
  v_seq jsonb;
  v_n integer;
  j integer;
  v_own_shown boolean;
  v_held integer;
  v_scored jsonb := '[]'::jsonb;
  v_out jsonb := '[]'::jsonb;
  c jsonb;
  v_arrive timestamptz;
  v_slot timestamptz;
  v_found timestamptz;
  i integer;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  IF p_with_task IS NOT NULL THEN
    SELECT * INTO w FROM public.helpr_tasks WHERE id = p_with_task;
    -- The delivery being viewed: one the caller could take (helpr_task_view's candidate checks).
    IF NOT FOUND OR w.status <> 'open' OR w.open_until <= now()
       OR v_uid IN (w.customer_id, w.pickup_contact_id)
       OR NOT public.helpr_task_vehicle_fits(v_uid, w.size)
       OR public.are_users_blocked(v_uid, w.customer_id) OR public.are_users_blocked(v_uid, w.pickup_contact_id)
       OR NOT public.helpr_task_same_stripe_mode(v_uid, w.customer_id) THEN
      RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
    END IF;
  END IF;
  -- helpr_task_accept refuses a third delivery not yet picked up: suggest nothing that would be refused.
  SELECT count(*) INTO v_held FROM public.helpr_tasks x WHERE x.helpr_id = v_uid AND x.status = 'accepted';
  IF v_held + (CASE WHEN p_with_task IS NULL THEN 0 ELSE 1 END) >= 2 THEN
    RETURN jsonb_build_object('suggestions', '[]'::jsonb, 'reason', 'too_many_taken');
  END IF;
  -- ... nor to a Helpr helpr_task_accept pauses (3 back-outs or misses in 7 days, review #4).
  IF (SELECT count(*) FROM public.helpr_task_events e
       WHERE e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show')
         AND e.detail IS DISTINCT FROM 'seller_moved'
         AND e.created_at > now() - interval '7 days') >= 3 THEN
    RETURN jsonb_build_object('suggestions', '[]'::jsonb, 'reason', 'too_many_releases');
  END IF;
  FOR t IN SELECT * FROM public.helpr_tasks x
            WHERE x.helpr_id = v_uid AND x.status IN ('accepted', 'picked_up') ORDER BY x.pickup_slot_start, x.id LOOP
    IF t.status = 'accepted' THEN
      v_base := v_base || jsonb_build_array(jsonb_build_object('key', t.id::text || ':pickup', 'task', t.id, 'kind', 'pickup',
        'lat', t.pickup_lat, 'lng', t.pickup_lng, 'slot', t.pickup_slot_start));
    END IF;
    v_own_shown := COALESCE(now() > public.helpr_task_dropoff_shows_at(v_uid, t.status, t.pickup_slot_start), false);
    v_base := v_base || jsonb_build_array(jsonb_build_object('key', t.id::text || ':dropoff', 'task', t.id, 'kind', 'dropoff',
      'lat', CASE WHEN v_own_shown THEN t.dropoff_lat ELSE round(t.dropoff_lat, 2) END,
      'lng', CASE WHEN v_own_shown THEN t.dropoff_lng ELSE round(t.dropoff_lng, 2) END));
  END LOOP;
  IF p_with_task IS NOT NULL THEN
    v_base := v_base || jsonb_build_array(
      jsonb_build_object('key', w.id::text || ':pickup', 'task', w.id, 'kind', 'pickup', 'lat', round(w.pickup_lat, 2), 'lng', round(w.pickup_lng, 2)),
      jsonb_build_object('key', w.id::text || ':dropoff', 'task', w.id, 'kind', 'dropoff', 'lat', round(w.dropoff_lat, 1), 'lng', round(w.dropoff_lng, 1)));
  END IF;
  IF jsonb_array_length(v_base) = 0 THEN
    RETURN jsonb_build_object('suggestions', '[]'::jsonb, 'reason', 'no_route');
  END IF;
  -- The route as planned (helpr_route_plan's order), then its cost as a fixed sequence.
  v_order := (SELECT jsonb_agg(b ORDER BY (s->>'seq')::integer)
                FROM jsonb_array_elements(public.helpr_route_plan(v_base, NULL, NULL, now())->'stops') s
                JOIN jsonb_array_elements(v_base) b ON b->>'key' = s->>'key');
  v_n := jsonb_array_length(v_order);
  v_base_plan := public.helpr_route_cost(v_order, NULL, NULL, now());

  FOR t IN
    SELECT x.* FROM public.helpr_tasks x
     WHERE x.status = 'open' AND x.open_until > now() AND x.id IS DISTINCT FROM p_with_task
       AND x.latest_pickup_at > now() + interval '45 minutes'
       AND v_uid IS DISTINCT FROM x.customer_id AND v_uid IS DISTINCT FROM x.pickup_contact_id
       AND public.helpr_task_vehicle_fits(v_uid, x.size)
       AND NOT public.are_users_blocked(v_uid, x.customer_id)
       AND NOT public.are_users_blocked(v_uid, x.pickup_contact_id)
       AND public.helpr_task_same_stripe_mode(v_uid, x.customer_id)
       AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)
       AND NOT EXISTS (SELECT 1 FROM public.helpr_task_events e
                        WHERE e.task_id = x.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show'))
       AND (SELECT min(public.helpr_task_distance_m(round(x.pickup_lat, 2), round(x.pickup_lng, 2),
                                                    (s->>'lat')::numeric, (s->>'lng')::numeric))
              FROM jsonb_array_elements(v_base) s) <= 25 * 1609.344
     ORDER BY (SELECT min(public.helpr_task_distance_m(round(x.pickup_lat, 2), round(x.pickup_lng, 2),
                                                       (s->>'lat')::numeric, (s->>'lng')::numeric))
                 FROM jsonb_array_elements(v_base) s), x.id
     LIMIT 30
  LOOP
    -- Cheapest insertion: the candidate's pickup at position i and its drop-off at j > i of the
    -- planned order, kept only if no booked pickup becomes late; the cheapest in drive minutes.
    v_best := NULL;
    FOR i IN 0 .. v_n LOOP
      FOR j IN i .. v_n LOOP
        v_seq := (SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::jsonb) FROM jsonb_array_elements(v_order) WITH ORDINALITY AS q(e, o) WHERE o <= i)
          || jsonb_build_array(jsonb_build_object('key', 'cand:pickup', 'kind', 'pickup', 'lat', round(t.pickup_lat, 2), 'lng', round(t.pickup_lng, 2)))
          || (SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::jsonb) FROM jsonb_array_elements(v_order) WITH ORDINALITY AS q(e, o) WHERE o > i AND o <= j)
          || jsonb_build_array(jsonb_build_object('key', 'cand:dropoff', 'kind', 'dropoff', 'lat', round(t.dropoff_lat, 1), 'lng', round(t.dropoff_lng, 1)))
          || (SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::jsonb) FROM jsonb_array_elements(v_order) WITH ORDINALITY AS q(e, o) WHERE o > j);
        v_plan := public.helpr_route_cost(v_seq, NULL, NULL, now());
        CONTINUE WHEN (v_plan->>'late')::integer > (v_base_plan->>'late')::integer;
        IF v_best IS NULL OR (v_plan->>'drive_minutes')::numeric < (v_best->>'drive_minutes')::numeric THEN
          v_best := v_plan;
        END IF;
      END LOOP;
    END LOOP;
    IF v_best IS NOT NULL AND (v_best->>'drive_minutes')::numeric - (v_base_plan->>'drive_minutes')::numeric <= 30 THEN
      v_scored := v_scored || jsonb_build_array(jsonb_build_object(
        'task_id', t.id,
        'extra_minutes', (5 * greatest(1, ceil(((v_best->>'drive_minutes')::numeric - (v_base_plan->>'drive_minutes')::numeric) / 5)))::integer,
        'extra_miles', greatest(0, ceil((v_best->>'miles')::numeric - (v_base_plan->>'miles')::numeric))::integer,
        'arrive_at', v_best->'arrive'->>'cand:pickup',
        'take_home_cents', public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents)));
    END IF;
  END LOOP;

  -- Fewest extra minutes first (then the better pay); a pickup time for each until 3 have one.
  FOR c IN SELECT e FROM jsonb_array_elements(v_scored) e
            ORDER BY (e->>'extra_minutes')::integer, (e->>'take_home_cents')::integer DESC, e->>'task_id' LOOP
    EXIT WHEN jsonb_array_length(v_out) >= 3;
    SELECT * INTO t FROM public.helpr_tasks WHERE id = (c->>'task_id')::uuid;
    v_arrive := greatest(COALESCE((c->>'arrive_at')::timestamptz, now()), now() + interval '15 minutes');
    -- The next quarter hour at or after the plan gets there.
    v_slot := date_trunc('hour', v_arrive) + ceil(extract(minute FROM v_arrive - date_trunc('hour', v_arrive)) / 15) * interval '15 minutes';
    v_found := NULL;
    i := 0;
    WHILE v_found IS NULL AND i <= 12 AND v_slot + interval '30 minutes' <= t.latest_pickup_at LOOP
      IF public.helpr_task_source_slot_ok(t.source_kind, t.source_id, v_slot) THEN
        v_found := v_slot;
      END IF;
      v_slot := v_slot + interval '15 minutes';
      i := i + 1;
    END LOOP;
    CONTINUE WHEN v_found IS NULL;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'task_id', t.id, 'title', t.title, 'size', t.size,
      'pickup_area', t.pickup_area, 'dropoff_area', t.dropoff_area, 'trip_miles', t.trip_miles,
      'take_home_cents', (c->>'take_home_cents')::integer,
      'extra_minutes', (c->>'extra_minutes')::integer, 'extra_miles', (c->>'extra_miles')::integer,
      'pickup_slot_start', v_found, 'latest_pickup_at', t.latest_pickup_at));
  END LOOP;
  RETURN jsonb_build_object('suggestions', v_out, 'reason', CASE WHEN jsonb_array_length(v_out) = 0 THEN 'none_near' END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_route_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_route_suggestions(uuid) TO authenticated, service_role;

