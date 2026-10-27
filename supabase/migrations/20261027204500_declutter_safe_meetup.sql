-- Q2425 (owner 2026-10-27): Declutter safe meetup spots.
--
-- The problem: a Declutter handover was the seller's porch, the seller's door (the buyer gets the home address after
-- paying), or a delivery. A buyer or seller who does not want a home address shared had no choice.
--
-- What this adds:
--   * declutter_meetup_spots: public places an ADMIN curates per parish (police "safe exchange" lots, busy stores).
--     None are seeded; admins add them in Admin (admin_declutter_save_meetup_spot, audited). Members never read the
--     table; they ask declutter_meetup_spots_near (active spots near the items in their cart from one seller).
--   * A new handover, 'meetup' ("Meet at a safe spot"). The buyer picks a spot for that seller's items
--     (declutter_set_meetup_spot: active, within 25 miles of every item); declutter_start_checkout takes
--     p_handover = 'meetup', re-checks the choice and freezes a snapshot of the spot on the order
--     (declutter_order_meetups; an admin editing or retiring a spot never moves an agreed meeting). Fee: the same
--     buyer's fee as a pickup (no delivery). The pickup time is booked as for a pickup.
--   * The home address is NEVER shared for a meetup (declutter_address_access: 'paid_buyer' excludes 'meetup').
--   * "I'm here": declutter_meetup_here stamps each side's arrival (from an hour before the booked time) and tells
--     the other. Then the EXISTING handover confirm finishes it: the buyer's "I got it", or the seller's
--     "Picked up" (declutter_seller_picked_up now takes a meetup as it takes a door pickup), and the existing 24 h
--     auto-pay / no-show sweep, which already treats every non-delivery handover as a pickup.
-- Free (claimed) items keep pickup only (declutter_checkout_free, lead 2026-10-27), unchanged here.
--
-- Restated, each from its newest definition with only the meetup lines added: declutter_start_checkout
-- (20261027170717_declutter_free_section.sql), declutter_address_access (20261027153244_declutter_seller_delivery.sql), declutter_seller_picked_up
-- (20261018183715_declutter_handover_no_qr_no_code.sql).
-- REPLAY-SAFETY: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS, CREATE OR REPLACE; the CHECK is
-- dropped and re-added in one block with one more allowed value.

CREATE TABLE IF NOT EXISTS public.declutter_meetup_spots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish text NOT NULL CHECK (char_length(btrim(parish)) BETWEEN 2 AND 60),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  address text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 5 AND 200),
  lat numeric(9,6) NOT NULL CHECK (lat BETWEEN 28 AND 34),     -- Louisiana and a margin
  lng numeric(9,6) NOT NULL CHECK (lng BETWEEN -95 AND -88),
  kind text NOT NULL CHECK (kind IN ('police', 'store', 'other')),
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_meetup_spots_active_idx ON public.declutter_meetup_spots (parish) WHERE active;
ALTER TABLE public.declutter_meetup_spots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_meetup_spots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_meetup_spots TO authenticated;
GRANT ALL ON TABLE public.declutter_meetup_spots TO service_role;
DROP POLICY IF EXISTS "meetup spots: admins read" ON public.declutter_meetup_spots;
CREATE POLICY "meetup spots: admins read" ON public.declutter_meetup_spots
  FOR SELECT TO authenticated
  USING (COALESCE(public.has_role((SELECT auth.uid()), 'admin'::public.app_role), false));
COMMENT ON TABLE public.declutter_meetup_spots IS
  'Q2425: public places for a Declutter handover, curated by admins per parish. Members read them only through '
  'declutter_meetup_spots_near; admins read the table and write through admin_declutter_save_meetup_spot.';

-- The buyer's choice of spot for one seller's cart, before checkout (as the delivery drop-off is).
CREATE TABLE IF NOT EXISTS public.declutter_meetup_choices (
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spot_id uuid NOT NULL REFERENCES public.declutter_meetup_spots(id) ON DELETE CASCADE,
  chosen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, seller_id)
);
ALTER TABLE public.declutter_meetup_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_meetup_choices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_meetup_choices TO service_role;

-- The spot frozen on an order, and each side's "I'm here".
CREATE TABLE IF NOT EXISTS public.declutter_order_meetups (
  order_id uuid PRIMARY KEY REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  spot_id uuid REFERENCES public.declutter_meetup_spots(id) ON DELETE SET NULL,
  spot_name text NOT NULL,
  spot_address text NOT NULL,
  spot_lat numeric(9,6) NOT NULL,
  spot_lng numeric(9,6) NOT NULL,
  buyer_here_at timestamptz,
  seller_here_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.declutter_order_meetups ENABLE ROW LEVEL SECURITY;
-- Every public table keeps the unconfirmed-email gate (Q807; db-deploy smoke): the three tables above.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
REVOKE ALL ON TABLE public.declutter_order_meetups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_order_meetups TO authenticated;
GRANT ALL ON TABLE public.declutter_order_meetups TO service_role;
DROP POLICY IF EXISTS "order meetups: the order's two sides read" ON public.declutter_order_meetups;
CREATE POLICY "order meetups: the order's two sides read" ON public.declutter_order_meetups
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = order_id AND (SELECT auth.uid()) IN (o.buyer_id, o.seller_id)));

-- DESTRUCTIVE-DDL-ACK: declutter_orders_handover_check
-- ACK-REASON: dropped only to be re-added in the same block with 'meetup' added; every existing row satisfies the
--   new CHECK, which only ever allows one more value.
-- ACK-DATA-LOSS: none; no column, table or row is dropped.
DO $do$
BEGIN
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_handover_check;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_handover_check
    CHECK (handover IN ('pickup_home', 'porch', 'delivery', 'seller_delivery', 'meetup'));
END
$do$;

CREATE OR REPLACE FUNCTION public.declutter_meetup_rules()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object('max_miles', 25, 'here_from_minutes_before', 60);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_meetup_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_meetup_rules() TO authenticated, service_role;

-- Straight-line miles between two points (haversine). Items carry coarse area coordinates (2 decimals).
CREATE OR REPLACE FUNCTION public.declutter_miles_between(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT (3958.8 * 2 * asin(sqrt(
    power(sin(radians((p_lat2 - p_lat1)::float8) / 2), 2)
    + cos(radians(p_lat1::float8)) * cos(radians(p_lat2::float8)) * power(sin(radians((p_lng2 - p_lng1)::float8) / 2), 2))))::numeric;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_miles_between(numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_miles_between(numeric, numeric, numeric, numeric) TO service_role;

-- Is this active spot within the rule's miles of EVERY item on these cart lines?
CREATE OR REPLACE FUNCTION public.declutter_meetup_spot_near_lines(p_spot_id uuid, p_lines uuid[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(cardinality(p_lines), 0) > 0
     AND EXISTS (SELECT 1 FROM public.declutter_meetup_spots s WHERE s.id = p_spot_id AND s.active)
     AND NOT EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
         JOIN public.declutter_meetup_spots s ON s.id = p_spot_id
        WHERE c.id = ANY (p_lines)
          AND public.declutter_miles_between(i.area_lat, i.area_lng, s.lat, s.lng)
              > (public.declutter_meetup_rules() ->> 'max_miles')::numeric);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_meetup_spot_near_lines(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_meetup_spot_near_lines(uuid, uuid[]) TO service_role;

-- The caller's live cart lines from one seller (the lines checkout would group).
CREATE OR REPLACE FUNCTION public.declutter_my_cart_lines(p_buyer uuid, p_seller uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), '{}'::uuid[])
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = p_buyer AND c.seller_id = p_seller AND c.status = 'in_cart' AND c.checkout_by > now();
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_cart_lines(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_my_cart_lines(uuid, uuid) TO service_role;

-- Member read: active spots near the caller's cart from this seller, nearest first. Nothing else about anyone.
CREATE OR REPLACE FUNCTION public.declutter_meetup_spots_near(p_seller_id uuid)
RETURNS TABLE (id uuid, name text, address text, parish text, kind text, note text, miles numeric, chosen boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_lines uuid[];
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_lines := public.declutter_my_cart_lines(v_uid, p_seller_id);
  RETURN QUERY
    SELECT s.id, s.name, s.address, s.parish, s.kind, s.note,
           round((SELECT max(public.declutter_miles_between(i.area_lat, i.area_lng, s.lat, s.lng))
                    FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                   WHERE c.id = ANY (v_lines)), 1),
           EXISTS (SELECT 1 FROM public.declutter_meetup_choices mc
                    WHERE mc.buyer_id = v_uid AND mc.seller_id = p_seller_id AND mc.spot_id = s.id)
      FROM public.declutter_meetup_spots s
     WHERE public.declutter_meetup_spot_near_lines(s.id, v_lines)
     ORDER BY 7, s.name
     -- Enough that a buyer's chosen spot is listed unless over 50 active spots are within 25 miles (the checkout
     -- pre-check reads its chosen flag; lh-authz-rls review note 3).
     LIMIT 50;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_meetup_spots_near(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_meetup_spots_near(uuid) TO authenticated, service_role;

-- The buyer picks a spot for this seller's cart.
CREATE OR REPLACE FUNCTION public.declutter_set_meetup_spot(p_seller_id uuid, p_spot_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF NOT public.declutter_meetup_spot_near_lines(p_spot_id, public.declutter_my_cart_lines(v_uid, p_seller_id)) THEN
    RAISE EXCEPTION 'meetup_spot_unavailable' USING ERRCODE = '22023',
      HINT = 'That spot isn''t available for these items. Pick another.';
  END IF;
  INSERT INTO public.declutter_meetup_choices (buyer_id, seller_id, spot_id)
  VALUES (v_uid, p_seller_id, p_spot_id)
  ON CONFLICT (buyer_id, seller_id) DO UPDATE SET spot_id = EXCLUDED.spot_id, chosen_at = now();
  RETURN p_spot_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_meetup_spot(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_meetup_spot(uuid, uuid) TO authenticated, service_role;

-- "I'm here": either side, on a paid meetup order, from an hour before the booked time. Tells the other once.
CREATE OR REPLACE FUNCTION public.declutter_meetup_here(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  m public.declutter_order_meetups%ROWTYPE;
  v_slot timestamptz;
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'meetup' THEN
    RAISE EXCEPTION 'not_a_meetup' USING ERRCODE = '55000', HINT = 'This order isn''t a meetup that''s waiting.';
  END IF;
  SELECT b.slot_start INTO v_slot FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL;
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'Book a time to meet first.';
  END IF;
  IF now() < v_slot - make_interval(mins => (public.declutter_meetup_rules() ->> 'here_from_minutes_before')::integer) THEN
    RAISE EXCEPTION 'too_early_to_check_in' USING ERRCODE = '55000', HINT = 'You can check in from an hour before the meeting time.';
  END IF;
  SELECT * INTO m FROM public.declutter_order_meetups WHERE order_id = o.id FOR UPDATE;
  IF m.order_id IS NULL THEN
    RAISE EXCEPTION 'not_a_meetup' USING ERRCODE = '55000';
  END IF;
  IF (v_side = 'buyer' AND m.buyer_here_at IS NOT NULL) OR (v_side = 'seller' AND m.seller_here_at IS NOT NULL) THEN
    RETURN 'already_here';
  END IF;
  IF v_side = 'buyer' THEN
    UPDATE public.declutter_order_meetups SET buyer_here_at = now() WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.seller_id, 'work_status', 'Your buyer is at the meeting spot',
      format('They checked in at %s.', m.spot_name), '/declutter?view=selling', o.buyer_id);
  ELSE
    UPDATE public.declutter_order_meetups SET seller_here_at = now() WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'work_status', 'The seller is at the meeting spot',
      format('They checked in at %s.', m.spot_name), '/declutter?view=bought', o.seller_id);
  END IF;
  RETURN 'here';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_meetup_here(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_meetup_here(uuid) TO authenticated, service_role;

-- Admin: add or edit a spot (and retire it with p_active false). Audited.
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
      RAISE EXCEPTION 'meetup_spot_not_found' USING ERRCODE = 'P0002';
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

-- Checkout: 'meetup' (restated from 20261027170717_declutter_free_section.sql).
CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text, p_slot_start timestamptz DEFAULT NULL,
  p_handoff text DEFAULT NULL)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text, delivery_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_items integer;
  v_premium integer;
  v_order uuid;
  v_old_session text;
  v_n integer;
  v_lines uuid[];
  v_existing record;
  v_delivery integer := 0;
  v_setup integer := 0;
  v_dropoff_key text;
  q record;
  sd record;
  v_sd_dropoff text;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_spot public.declutter_meetup_spots%ROWTYPE;
BEGIN
  -- Row 62 (B44): no require_feature here. Nothing NEW can start without the
  -- switch (offer, Buy and accept all require it); a line already in the cart
  -- is a sale already agreed, and checkout below needs one.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch', 'delivery', 'seller_delivery', 'meetup') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Choose porch pickup, pickup at the seller''s home, a safe meeting spot, delivery by the seller, or Helpr delivery.';
  END IF;
  -- Q2425: a safe meeting spot is new work for the seller, so it needs the switch (row 62's rule).
  IF p_handover = 'meetup' THEN
    PERFORM public.require_feature('declutter');
  END IF;
  -- Slice 5: delivery is new work for a Helpr, so it needs the switch (row 62:
  -- a member the switch is off for can still finish with a pickup).
  IF p_handover = 'delivery' THEN
    PERFORM public.require_feature('declutter');
  END IF;
  -- Seller delivery is new work for the seller: both switches. The buyer says
  -- how they want it: left at the door or handed to them (owner 2026-10-22).
  IF p_handover = 'seller_delivery' THEN
    PERFORM public.require_feature('declutter');
    PERFORM public.require_feature('declutter_seller_delivery');
    IF p_handoff IS NULL OR p_handoff NOT IN ('leave', 'hand') THEN
      RAISE EXCEPTION 'invalid_handoff' USING ERRCODE = '22023',
        HINT = 'Choose "Leave it at my door" or "Hand it to me".';
    END IF;
  ELSE
    p_slot_start := NULL;
    p_handoff := NULL;
  END IF;

  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.handover, o.stripe_checkout_session_id, o.items_cents, o.premium_cents, o.tax_cents, o.total_cents,
         o.delivery_cents, o.setup_fee_cents,
         (SELECT od.dropoff_address || '|' || od.road_miles FROM public.declutter_order_deliveries od WHERE od.order_id = o.id) AS dropoff_key,
         (SELECT x.slot_start FROM public.declutter_seller_deliveries x
           WHERE x.order_id = o.id AND x.status = 'held' AND x.held_until > now()) AS held_slot,
         (SELECT x.dropoff_address FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id) AS sd_dropoff,
         (SELECT m.spot_id FROM public.declutter_order_meetups m WHERE m.order_id = o.id) AS meetup_spot,
         ARRAY(SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'in_cart' ORDER BY c.id) AS lines
    INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  -- The caller's own cart first: an empty cart says nothing about the seller
  -- (no ban / strike / tax-flag oracle on an arbitrary id).
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  -- Only free items (20261027170717): nothing to pay, so never a payment page (no fee, no setup fee).
  -- declutter_checkout_free takes it. A cart mixing free and paid lines checks out here as usual:
  -- the free lines are $0 and the fee is on the paid total.
  IF v_items = 0 THEN
    RAISE EXCEPTION 'free_order' USING ERRCODE = '22023', HINT = 'These items are free. Choose a pickup and tap Get it free.';
  END IF;
  -- B33 tax hook: a business-like seller's sale is never taken untaxed.
  IF EXISTS (SELECT 1 FROM public.declutter_seller_flags f
              WHERE f.user_id = p_seller_id AND f.business_like) THEN
    RAISE EXCEPTION 'seller_tax_not_ready' USING ERRCODE = '55000',
      HINT = 'Checkout for this seller is not available yet.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Row 101: porch only when EVERY line's item allows it. Read from the lines
  -- this checkout groups (v_lines), under the item locks taken above. Before the
  -- idempotent return, so no open porch order is handed back either.
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked buyers to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- Slice 5: the delivery for exactly these lines, from server data only.
  IF p_handover = 'delivery' THEN
    SELECT * INTO q FROM public.declutter_delivery_compute(v_uid, p_seller_id, v_lines);
    v_delivery := q.delivery_cents;
    v_dropoff_key := q.dropoff_address || '|' || q.road_miles;
  END IF;
  -- Seller delivery: under the seller's setting-row lock (held to the end of
  -- this transaction), taken BEFORE the setting is read (lh-money-escrow review
  -- of the free-delivery change #1): a seller saving a new price or turning
  -- delivery off mid-checkout is either seen here or waits, so the order never
  -- freezes terms the seller already changed. Then the setting, items, address,
  -- range and the rate; then the slot.
  IF p_handover = 'seller_delivery' THEN
    PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = p_seller_id FOR UPDATE;
    SELECT * INTO sd FROM public.declutter_seller_delivery_check(v_uid, p_seller_id, v_lines);
    IF sd.reason = 'address_needed' THEN
      RAISE EXCEPTION 'delivery_address_needed' USING ERRCODE = '22023', HINT = 'Enter the address to deliver to.';
    ELSIF sd.reason = 'out_of_range' THEN
      RAISE EXCEPTION 'delivery_out_of_range' USING ERRCODE = '22023',
        HINT = 'This seller doesn''t deliver that far. Choose pickup or another delivery.';
    ELSIF sd.reason IS NOT NULL THEN
      RAISE EXCEPTION 'seller_delivery_unavailable' USING ERRCODE = '22023',
        HINT = 'This seller can''t deliver these items. Choose another way to get them.';
    END IF;
    IF p_slot_start IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.declutter_delivery_open_slots(p_seller_id, v_existing.id) s WHERE s = p_slot_start) THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = '22023',
        HINT = 'That delivery time was just taken or is no longer open. Pick another time.';
    END IF;
    v_delivery := sd.rate_cents;
    v_sd_dropoff := sd.dropoff_address;
  END IF;

  -- Q2425: a safe meeting spot is the one the buyer chose for this seller (declutter_set_meetup_spot), still
  -- active and still near these items. Never the seller's home: the address is not shared for a meetup.
  IF p_handover = 'meetup' THEN
    SELECT s.* INTO v_spot
      FROM public.declutter_meetup_choices mc
      JOIN public.declutter_meetup_spots s ON s.id = mc.spot_id
     WHERE mc.buyer_id = v_uid AND mc.seller_id = p_seller_id AND s.active
       AND public.declutter_meetup_spot_near_lines(s.id, v_lines);
    IF v_spot.id IS NULL THEN
      RAISE EXCEPTION 'meetup_spot_needed' USING ERRCODE = '22023',
        HINT = 'Pick a safe meeting spot near the seller.';
    END IF;
  END IF;

  -- Q2352 (owner 2026-10-22, terms #9): the one-time account setup fee rides
  -- the buyer's first Declutter purchase when the account never paid it. It is
  -- frozen on the order OUTSIDE total_cents (the sale's own amount, which every
  -- refund is computed from), so a refund of the sale never returns it.
  v_setup := public.declutter_setup_fee_due_cents(v_uid);

  -- Idempotent (money review #3): the same lines and the same handover return
  -- the order already open, and its Stripe session for the app to reuse.
  -- Slice 5: and the same delivery (fee and drop-off). Seller delivery: and
  -- the same slot, still held, to the same address.
  IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover AND v_existing.lines = v_lines
     AND v_existing.delivery_cents = v_delivery
     AND v_existing.dropoff_key IS NOT DISTINCT FROM v_dropoff_key
     -- Q2352: and the same setup fee (paid elsewhere since: a fresh order without it).
     AND v_existing.setup_fee_cents = v_setup
     AND (p_handover <> 'seller_delivery'
          OR (v_existing.held_slot = p_slot_start AND v_existing.sd_dropoff IS NOT DISTINCT FROM v_sd_dropoff))
     -- Q2425: and the same meeting spot.
     AND (p_handover <> 'meetup' OR v_existing.meetup_spot IS NOT DISTINCT FROM v_spot.id) THEN
    -- lh-money-escrow review #1: an order handed back with NO page yet (the
    -- last try failed before Stripe attached one) gets a new page that lives
    -- 31 min from now, so its hold is re-armed from now too (the setting row
    -- is locked above). An order with a page keeps its hold: the page dies first.
    IF p_handover = 'seller_delivery' AND v_existing.stripe_checkout_session_id IS NULL THEN
      UPDATE public.declutter_seller_deliveries x
         SET held_until = now() + make_interval(mins => (v_rules ->> 'hold_minutes')::integer), updated_at = now()
       WHERE x.order_id = v_existing.id AND x.status = 'held' AND x.held_until > now();
    END IF;
    -- A changed door choice moves no money: it is updated on the order already open.
    IF p_handover = 'seller_delivery' THEN
      UPDATE public.declutter_seller_deliveries x SET handoff = p_handoff, updated_at = now()
       WHERE x.order_id = v_existing.id AND x.handoff IS DISTINCT FROM p_handoff;
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.items_cents, v_existing.premium_cents, v_existing.tax_cents,
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id, v_existing.delivery_cents;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
    v_old_session := v_existing.stripe_checkout_session_id;
  END IF;

  -- F1: 5% of the item total + 70c, once per checkout (card cost inside it).
  -- The Helpr delivery fee is not part of the item total (row 29 prices it
  -- alone); the seller's delivery rate is (owner 2026-10-22, the shipping rule).
  v_premium := CASE WHEN p_handover = 'seller_delivery'
                    THEN public.declutter_buyer_fee_cents_seller_delivery(v_items, v_delivery)
                    ELSE public.declutter_buyer_fee_cents(v_items) END;
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items + v_premium + v_delivery, v_setup)
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order
   WHERE c.id = ANY (v_lines);
  IF p_handover = 'delivery' THEN
    INSERT INTO public.declutter_order_deliveries (order_id, dropoff_address, dropoff_area, dropoff_lat, dropoff_lng,
                                                   road_miles, size, delivery_cents)
    VALUES (v_order, q.dropoff_address, q.dropoff_area, q.dropoff_lat, q.dropoff_lng, q.road_miles, q.size, v_delivery);
  END IF;
  IF p_handover = 'seller_delivery' THEN
    INSERT INTO public.declutter_seller_deliveries (order_id, buyer_id, seller_id, status, slot_start, slot_end, held_until,
                                                    dropoff_address, dropoff_area, dropoff_lat, dropoff_lng, handoff)
    VALUES (v_order, v_uid, p_seller_id, 'held', p_slot_start,
            p_slot_start + make_interval(mins => (v_rules ->> 'slot_minutes')::integer),
            now() + make_interval(mins => (v_rules ->> 'hold_minutes')::integer),
            sd.dropoff_address, sd.dropoff_area, sd.dropoff_lat, sd.dropoff_lng, p_handoff);
  END IF;

  IF p_handover = 'meetup' THEN
    -- A snapshot: an admin editing or retiring the spot later never moves a meeting already agreed.
    INSERT INTO public.declutter_order_meetups (order_id, spot_id, spot_name, spot_address, spot_lat, spot_lng)
    VALUES (v_order, v_spot.id, v_spot.name, v_spot.address, v_spot.lat, v_spot.lng);
  END IF;

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium + v_delivery, v_old_session, NULL::text, v_delivery;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) TO authenticated, service_role;

-- The home address is never shared for a meetup (restated from 20261027153244_declutter_seller_delivery.sql).
CREATE OR REPLACE FUNCTION public.declutter_address_access(p_item_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
           WHEN i.seller_id = p_user_id THEN 'seller'
           WHEN EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_orders o ON o.id = c.order_id
                         WHERE c.item_id = i.id AND c.status = 'paid'
                           AND o.status = 'paid' AND o.buyer_id = p_user_id
                           -- Q2425: a safe-spot meetup never shares the seller's home address.
                           AND o.handover NOT IN ('seller_delivery', 'meetup')) THEN 'paid_buyer'
         END
    FROM public.declutter_items i
   WHERE i.id = p_item_id
     AND p_user_id IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_address_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_address_access(uuid, uuid) TO service_role;

-- The seller's "Picked up" works at a meeting spot as at the door (restated from 20261018183715_declutter_handover_no_qr_no_code.sql).
CREATE OR REPLACE FUNCTION public.declutter_seller_picked_up(p_order_id uuid, p_photo_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_out jsonb;
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- Q2425: handing it over at a safe meeting spot is the same act as at the door.
  IF o.handover NOT IN ('pickup_home', 'meetup') THEN
    RAISE EXCEPTION 'not_a_door_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  -- Not before the booked time (lh-money-escrow review #1): the seller cannot
  -- mark it picked up, and be paid, before the buyer could have come.
  IF EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start > now()) THEN
    RAISE EXCEPTION 'before_pickup_time' USING ERRCODE = '55000',
      HINT = 'You can mark it picked up from the booked pickup time.';
  END IF;
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF p_photo_path IS NOT NULL THEN
    IF split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
       OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
       OR split_part(p_photo_path, '/', 5) = ''
       OR split_part(p_photo_path, '/', 6) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- complete_handover first (it refuses an open problem); then the photo is kept with the handover.
  v_out := public.declutter_complete_handover(o.id, 'seller');
  IF p_photo_path IS NOT NULL THEN
    UPDATE public.declutter_handovers SET picked_up_photo_path = p_photo_path, picked_up_at = now()
     WHERE order_id = o.id AND picked_up_photo_path IS NULL;
  END IF;
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_picked_up(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_picked_up(uuid, text) TO authenticated, service_role;
