-- Declutter: up to 5 porch pickup places per seller, each with its own weekdays (D-NEW14, owner-approved design
-- 2026-10-29: "A seller can save up to 5 porch pickup places, each with its own weekdays. The buyer picks a place,
-- then a day. Only the chosen address is shared after paying. The address is FROZEN on the order at checkout.
-- Helpr delivery uses the chosen place.").
--
-- WHAT WAS THERE: one pickup address per ITEM (declutter_item_private), and one set of porch weekdays per seller
-- (declutter_seller_porch_days, 20261029161347). A seller who keeps things at two homes could not say which porch.
--
-- WHAT THIS ADDS (the safe-meetup pattern, 20261027204500: a choice row, then a snapshot on the order):
--   1. declutter_porch_places: the seller's places (label, address, public area, point, weekdays), positions 0-4,
--      so the cap of 5 is structural. No client privilege: read and written only through the RPCs below.
--   2. declutter_porch_place_choices: the buyer's pick for one seller (buyer, seller) -> place.
--   3. declutter_order_porch_places: the pick FROZEN on the order at checkout (address, point, area, label AND the
--      weekdays; lead 2026-10-29: freeze the weekdays too). The seller editing or deleting a place never moves a
--      sale. When the seller's account goes (seller_id set null) the address and point are cleared by trigger.
--   4. declutter_order_pickup_points(order): the ONE reader of "where is this order's pickup": the frozen place,
--      else every item's own point (an order with no place: unchanged). declutter_porch_photo reads it.
--   5. declutter_order_is_porch_day(order, dow): the frozen place's weekdays, else declutter_is_porch_day (the
--      seller's porch days, else their pickup-time days). declutter_porch_days and declutter_book_porch_day read it.
--   6. RPCs: declutter_save_porch_place / declutter_delete_porch_place / declutter_my_porch_places (the seller's
--      own); declutter_seller_porch_places (label, area, weekdays only, never an address, to a buyer with that
--      seller's items in their cart); declutter_set_porch_place (the buyer's pick); declutter_order_place (either
--      side of an order: the frozen place; the address only to the seller, or to the buyer once paid).
--   7. Restated, each from its NEWEST definition (newest-definition scan of every migration, and each base's md5(prosrc) equal to prod, 2026-10-30):
--      declutter_start_checkout and declutter_checkout_free (20261028235247): for porch (and, paid only, Helpr
--      delivery) from a seller with places, the buyer's pick is required (porch_place_needed) and frozen;
--      declutter_porch_days and declutter_book_porch_day (20261029161347); declutter_porch_photo (20261029201542);
--      declutter_item_address (20261015042253): the paid buyer of an order with a place gets that place only;
--      declutter_delivery_compute (20261017055505) and declutter_delivery_open_task (20261028200440): the Helpr
--      picks up at the chosen / frozen place. helpr_tasks already freezes its own pickup, so the Helpr task
--      readers need no change.
--      declutter_return_dropped_off (20261030071818, Q2486): the return drop-off is measured from the order's pickup
--      points too, so a drop-off at the frozen place passes and one at the old item address fails.
--   NOT changed: declutter_seller_picked_up (pickup_home / meetup only: no place); declutter_seller_delivery_check
--   (seller delivery still measures from the item address: filed LOW, Q?b46-sd).
--
-- MONEY: no amount changes. A missing place is refused before an order row or a payment page exists, exactly as
-- meetup_spot_needed is; an open order is reused only for the same place as it is now.
--
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS, CREATE OR
-- REPLACE; grants restated. Proof: src/test/pglite/declutterPorchPlaces.pglite.mjs (applied 3x).

CREATE TABLE IF NOT EXISTS public.declutter_porch_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  address text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 5 AND 300),
  area text NOT NULL CHECK (char_length(btrim(area)) BETWEEN 1 AND 80),
  lat numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng numeric(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  weekdays smallint[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_porch_places_seller_position_key UNIQUE (seller_id, position)
);
ALTER TABLE public.declutter_porch_places ENABLE ROW LEVEL SECURITY;
-- No policy and no client privilege, on purpose (as declutter_item_private): the RPCs below are the only way in.
REVOKE ALL ON TABLE public.declutter_porch_places FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_porch_places TO service_role;
COMMENT ON TABLE public.declutter_porch_places IS
  'Declutter D-NEW14: a seller''s porch pickup places (up to 5, each with weekdays). No client privilege; read and '
  'written only through declutter_save_porch_place / declutter_delete_porch_place / declutter_my_porch_places / '
  'declutter_seller_porch_places (no address).';

CREATE TABLE IF NOT EXISTS public.declutter_porch_place_choices (
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id uuid NOT NULL REFERENCES public.declutter_porch_places(id) ON DELETE CASCADE,
  chosen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, seller_id)
);
CREATE INDEX IF NOT EXISTS declutter_porch_place_choices_seller_idx ON public.declutter_porch_place_choices (seller_id);
CREATE INDEX IF NOT EXISTS declutter_porch_place_choices_place_idx ON public.declutter_porch_place_choices (place_id);
ALTER TABLE public.declutter_porch_place_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_porch_place_choices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_porch_place_choices TO service_role;
COMMENT ON TABLE public.declutter_porch_place_choices IS
  'Declutter D-NEW14: the porch place a buyer picked for one seller. Written only by declutter_set_porch_place.';

CREATE TABLE IF NOT EXISTS public.declutter_order_porch_places (
  order_id uuid PRIMARY KEY REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  place_id uuid REFERENCES public.declutter_porch_places(id) ON DELETE SET NULL,
  label text,
  address text,
  area text,
  lat numeric(9,6),
  lng numeric(9,6),
  weekdays smallint[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  frozen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_order_porch_places_seller_idx ON public.declutter_order_porch_places (seller_id);
CREATE INDEX IF NOT EXISTS declutter_order_porch_places_place_idx ON public.declutter_order_porch_places (place_id);
ALTER TABLE public.declutter_order_porch_places ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_order_porch_places FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_order_porch_places TO service_role;
COMMENT ON TABLE public.declutter_order_porch_places IS
  'Declutter D-NEW14: the porch place frozen on an order at checkout. No client privilege; read through '
  'declutter_order_place, declutter_item_address (paid buyer) and the internal declutter_order_pickup_points.';

-- The seller's account going (the FK sets seller_id null) clears their address and point from the orders that stay.
CREATE OR REPLACE FUNCTION public.declutter_order_porch_place_scrub()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.seller_id IS NULL AND OLD.seller_id IS NOT NULL THEN
    NEW.address := NULL;
    NEW.lat := NULL;
    NEW.lng := NULL;
    NEW.label := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_porch_place_scrub() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS declutter_order_porch_place_scrub ON public.declutter_order_porch_places;
CREATE TRIGGER declutter_order_porch_place_scrub BEFORE UPDATE OF seller_id ON public.declutter_order_porch_places
  FOR EACH ROW EXECUTE FUNCTION public.declutter_order_porch_place_scrub();

-- Internal: the order's pickup point(s). The frozen place when the order has one (none at all once scrubbed: fail
-- closed), else every item's own point.
CREATE OR REPLACE FUNCTION public.declutter_order_pickup_points(p_order_id uuid)
RETURNS TABLE (address text, lat numeric, lng numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT pp.address, pp.lat::numeric, pp.lng::numeric
    FROM public.declutter_order_porch_places pp
   WHERE pp.order_id = p_order_id AND pp.lat IS NOT NULL AND pp.lng IS NOT NULL
  UNION ALL
  SELECT p.pickup_address, p.pickup_lat::numeric, p.pickup_lng::numeric
    FROM public.declutter_cart_items c
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.order_id = p_order_id AND p.pickup_lat IS NOT NULL AND p.pickup_lng IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.declutter_order_porch_places pp2 WHERE pp2.order_id = p_order_id);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_pickup_points(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_pickup_points(uuid) TO service_role;

-- Internal: is this weekday a porch day for this order? The frozen place's days, else the seller's (20261029161347).
CREATE OR REPLACE FUNCTION public.declutter_order_is_porch_day(p_order_id uuid, p_dow smallint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_order_id IS NULL OR p_dow IS NULL THEN false
    WHEN EXISTS (SELECT 1 FROM public.declutter_order_porch_places pp WHERE pp.order_id = p_order_id)
      THEN EXISTS (SELECT 1 FROM public.declutter_order_porch_places pp WHERE pp.order_id = p_order_id AND p_dow = ANY (pp.weekdays))
    ELSE COALESCE(public.declutter_is_porch_day((SELECT o.seller_id FROM public.declutter_orders o WHERE o.id = p_order_id), p_dow), false)
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_is_porch_day(uuid, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_is_porch_day(uuid, smallint) TO service_role;

-- The seller saves a place (p_place_id NULL = a new one, at most 5) or edits one of their own.
CREATE OR REPLACE FUNCTION public.declutter_save_porch_place(p_place_id uuid, p_label text, p_address text, p_area text,
  p_lat numeric, p_lng numeric, p_weekdays smallint[])
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
  IF p_weekdays IS NULL OR EXISTS (SELECT 1 FROM unnest(p_weekdays) d WHERE d IS NULL OR d < 0 OR d > 6) THEN
    RAISE EXCEPTION 'invalid_porch_days' USING ERRCODE = '22023', HINT = 'Pick days from Sunday to Saturday.';
  END IF;
  SELECT coalesce(array_agg(DISTINCT d ORDER BY d), '{}') INTO v_days FROM unnest(p_weekdays) d;
  IF cardinality(v_days) = 0 THEN
    RAISE EXCEPTION 'invalid_porch_days' USING ERRCODE = '22023', HINT = 'Pick at least one day.';
  END IF;
  -- One save per seller at a time, so two new places never race for the same free position.
  PERFORM pg_advisory_xact_lock(hashtextextended('declutter_porch_places:' || v_uid::text, 0));
  IF p_place_id IS NOT NULL THEN
    UPDATE public.declutter_porch_places
       SET label = btrim(p_label), address = btrim(p_address), area = btrim(p_area), lat = p_lat, lng = p_lng,
           weekdays = v_days, updated_at = now()
     WHERE id = p_place_id AND seller_id = v_uid
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'porch_place_not_found' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_id;
  END IF;
  SELECT min(g)::smallint INTO v_pos FROM generate_series(0, 4) g
   WHERE NOT EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = v_uid AND pl.position = g);
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'porch_places_full' USING ERRCODE = '22023', HINT = 'You can save up to 5 pickup places.';
  END IF;
  INSERT INTO public.declutter_porch_places (seller_id, position, label, address, area, lat, lng, weekdays)
  VALUES (v_uid, v_pos, btrim(p_label), btrim(p_address), btrim(p_area), p_lat, p_lng, v_days)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_save_porch_place(uuid, text, text, text, numeric, numeric, smallint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_save_porch_place(uuid, text, text, text, numeric, numeric, smallint[]) TO authenticated, service_role;

-- The seller removes one of their places. Orders already placed keep their frozen copy.
CREATE OR REPLACE FUNCTION public.declutter_delete_porch_place(p_place_id uuid)
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
  DELETE FROM public.declutter_porch_places WHERE id = p_place_id AND seller_id = v_uid RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'porch_place_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delete_porch_place(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delete_porch_place(uuid) TO authenticated, service_role;

-- The seller's own places, with their addresses.
CREATE OR REPLACE FUNCTION public.declutter_my_porch_places()
RETURNS TABLE (id uuid, "position" smallint, label text, address text, area text, lat numeric, lng numeric, weekdays smallint[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  v_uid := public.declutter_assert_member(false);
  RETURN QUERY
    SELECT pl.id, pl.position, pl.label, pl.address, pl.area, pl.lat::numeric, pl.lng::numeric, pl.weekdays
      FROM public.declutter_porch_places pl
     WHERE pl.seller_id = v_uid
     ORDER BY pl.position;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_porch_places() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_porch_places() TO authenticated, service_role;

-- A buyer with this seller's items in their cart: the seller's places to pick from. Never an address or a point.
-- No require_feature (row 62): a cart line is a sale already agreed, and checkout needs the pick.
CREATE OR REPLACE FUNCTION public.declutter_seller_porch_places(p_seller_id uuid)
RETURNS TABLE (id uuid, label text, area text, weekdays smallint[], chosen boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := public.declutter_assert_member(false);
  IF p_seller_id IS NULL OR cardinality(public.declutter_my_cart_lines(v_uid, p_seller_id)) = 0
     OR public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT pl.id, pl.label, pl.area, pl.weekdays,
           EXISTS (SELECT 1 FROM public.declutter_porch_place_choices ch
                    WHERE ch.buyer_id = v_uid AND ch.seller_id = p_seller_id AND ch.place_id = pl.id)
      FROM public.declutter_porch_places pl
     WHERE pl.seller_id = p_seller_id
     ORDER BY pl.position;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_porch_places(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_porch_places(uuid) TO authenticated, service_role;

-- The buyer picks one of the seller's places for their cart with that seller.
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
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
REVOKE ALL ON FUNCTION public.declutter_set_porch_place(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_porch_place(uuid, uuid) TO authenticated, service_role;

-- Either side of an order: the place frozen on it (none: no row). The address and point go to the seller, and to
-- the buyer only once the order is paid or handed over ("only the chosen address is shared after paying").
CREATE OR REPLACE FUNCTION public.declutter_order_place(p_order_id uuid)
RETURNS TABLE (label text, area text, address text, lat numeric, lng numeric, weekdays smallint[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_open := v_side = 'seller' OR o.status IN ('paid', 'handed_over');
  RETURN QUERY
    SELECT pp.label, pp.area,
           CASE WHEN v_open THEN pp.address END,
           CASE WHEN v_open THEN pp.lat::numeric END,
           CASE WHEN v_open THEN pp.lng::numeric END,
           pp.weekdays
      FROM public.declutter_order_porch_places pp
     WHERE pp.order_id = o.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_place(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_place(uuid) TO authenticated, service_role;

-- Restated from 20261028235247_declutter_handover_choices (its newest definition); only the D-NEW14 lines are new.
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
  v_bundle_off integer := 0;
  v_place public.declutter_porch_places%ROWTYPE;
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
         (SELECT pp.place_id::text || '|' || pp.address || '|' || pp.lat || '|' || pp.lng || '|' || pp.weekdays::text
            FROM public.declutter_order_porch_places pp WHERE pp.order_id = o.id) AS porch_key,
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
  -- Q2427: the seller's bundle discount on the paid lines (2 or more), from each line's ORIGINAL price every time,
  -- never below the item's floor (declutter_bundle_targets). The lines are locked above. Free lines never change.
  UPDATE public.declutter_cart_items c
     SET price_cents = t.target_cents,
         list_price_cents = CASE WHEN t.target_cents < t.base_cents THEN t.base_cents END
    FROM public.declutter_bundle_targets(p_seller_id, v_lines) t
   WHERE c.id = t.line_id
     AND (c.price_cents IS DISTINCT FROM t.target_cents
          OR c.list_price_cents IS DISTINCT FROM CASE WHEN t.target_cents < t.base_cents THEN t.base_cents END);
  SELECT COALESCE(sum(c.price_cents), 0)::integer,
         COALESCE(sum(COALESCE(c.list_price_cents, c.price_cents) - c.price_cents), 0)::integer
    INTO v_items, v_bundle_off
    FROM public.declutter_cart_items c WHERE c.id = ANY (v_lines);
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
  -- Owner 2026-10-28: the seller ticks which ways buyers may get each item (declutter_items.handovers,
  -- declutter_set_handovers); the ways checkout takes are those EVERY line here allows (an item listed before the
  -- choice, handovers NULL, allows every way). No fallback to the seller's door (owner 2026-10-28, Q2462 #3730:
  -- "let them chat to figure it out"): when no way works, the buyer and seller talk it through in a private
  -- Declutter chat and the missed-checkout strike waits (20261028235249_declutter_handover_talk).
  IF public.declutter_handover_refused(v_lines, p_handover) THEN
    RAISE EXCEPTION 'handover_not_offered' USING ERRCODE = '22023',
      HINT = 'The seller doesn''t offer that for one of these items. Choose another way to get it.';
  END IF;
  -- D-NEW14 (owner-approved 2026-10-29, 20261030164712): a seller with saved porch places hands over at the ONE the
  -- buyer picked (declutter_set_porch_place), for a porch pickup and for Helpr delivery alike. Read under a share
  -- lock so the seller cannot edit it mid-checkout; it is frozen on the order below. A seller with no places: as before.
  IF p_handover IN ('porch', 'delivery')
     AND EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller_id) THEN
    SELECT pl.* INTO v_place
      FROM public.declutter_porch_place_choices ch
      JOIN public.declutter_porch_places pl ON pl.id = ch.place_id
     WHERE ch.buyer_id = v_uid AND ch.seller_id = p_seller_id AND pl.seller_id = p_seller_id
       FOR SHARE OF pl;
    IF v_place.id IS NULL THEN
      RAISE EXCEPTION 'porch_place_needed' USING ERRCODE = '22023',
        HINT = 'Pick which of the seller''s pickup places you''ll use.';
    END IF;
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
    -- Q2427 (lh-money-escrow follow-up review #1): the rate from THIS checkout's items total (v_items, from the
    -- lines it locked and priced above), never the check's own re-computation: the check reads the bundle rule
    -- and floors in a later snapshot (after the setting-row wait), so a rule saved in between could otherwise
    -- price the delivery on one total and the items on another. The seller's rate and free-over amount are the
    -- locked setting row's (sd.base_rate_cents, sd.free_over_cents).
    v_delivery := public.declutter_seller_delivery_rate_cents(sd.base_rate_cents, sd.free_over_cents, v_items);
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
     -- Q2427: and the items total the bundle rule gives now (a changed or removed rule opens a new order).
     AND v_existing.items_cents = v_items
     AND (p_handover <> 'seller_delivery'
          OR (v_existing.held_slot = p_slot_start AND v_existing.sd_dropoff IS NOT DISTINCT FROM v_sd_dropoff))
     -- D-NEW14: and the same porch place, as it is now (an edited or changed place opens a new order).
     AND v_existing.porch_key IS NOT DISTINCT FROM
         (v_place.id::text || '|' || v_place.address || '|' || v_place.lat || '|' || v_place.lng || '|' || v_place.weekdays::text)
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
                                       delivery_cents, total_cents, setup_fee_cents, bundle_discount_cents)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items + v_premium + v_delivery, v_setup,
          v_bundle_off)
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

  -- D-NEW14: the chosen porch place, frozen: the seller editing or deleting it later never moves this sale.
  IF v_place.id IS NOT NULL THEN
    INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)
    VALUES (v_order, p_seller_id, v_place.id, v_place.label, v_place.address, v_place.area, v_place.lat, v_place.lng, v_place.weekdays);
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

-- Restated from 20261028235247_declutter_handover_choices (its newest definition); only the D-NEW14 lines are new.
CREATE OR REPLACE FUNCTION public.declutter_checkout_free(p_seller_id uuid, p_handover text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_taker text;
  v_n integer;
  v_items integer;
  v_lines uuid[];
  v_existing record;
  v_order uuid;
  r record;
  v_place public.declutter_porch_places%ROWTYPE;
BEGIN
  -- Row 62: no require_feature (a claim is a sale already agreed), the same as declutter_start_checkout.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  -- Free pickups at launch: at the seller's home or from the porch. Delivery costs money, so not for a $0 order.
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Free items are picked up: from the porch or at the seller''s home.';
  END IF;
  -- Lock order as checkout: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.stripe_checkout_session_id INTO v_existing
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
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'not_free_order' USING ERRCODE = '22023', HINT = 'Some of these items have a price. Check out to pay for them.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- Owner 2026-10-28: the seller ticks which ways buyers may get each item (declutter_items.handovers,
  -- declutter_set_handovers); the ways checkout takes are those EVERY line here allows (an item listed before the
  -- choice, handovers NULL, allows every way). No fallback to the seller's door (owner 2026-10-28, Q2462 #3730:
  -- "let them chat to figure it out"): when no way works, the buyer and seller talk it through in a private
  -- Declutter chat and the missed-checkout strike waits (20261028235249_declutter_handover_talk).
  IF public.declutter_handover_refused(v_lines, p_handover) THEN
    RAISE EXCEPTION 'handover_not_offered' USING ERRCODE = '22023',
      HINT = 'The seller doesn''t offer that for one of these items. Choose another way to get it.';
  END IF;
  -- D-NEW14 (20261030164712): a free porch pickup from a seller with saved places is at the place the buyer picked.
  IF p_handover = 'porch'
     AND EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller_id) THEN
    SELECT pl.* INTO v_place
      FROM public.declutter_porch_place_choices ch
      JOIN public.declutter_porch_places pl ON pl.id = ch.place_id
     WHERE ch.buyer_id = v_uid AND ch.seller_id = p_seller_id AND pl.seller_id = p_seller_id
       FOR SHARE OF pl;
    IF v_place.id IS NULL THEN
      RAISE EXCEPTION 'porch_place_needed' USING ERRCODE = '22023',
        HINT = 'Pick which of the seller''s pickup places you''ll use.';
    END IF;
  END IF;
  -- An order still open on a payment page (the cart once held a paid line) is never replaced here:
  -- that page could still be paid. The buyer finishes or leaves it first (it closes in 31 minutes).
  IF v_existing.id IS NOT NULL AND v_existing.stripe_checkout_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'checkout_page_open' USING ERRCODE = '55000',
      HINT = 'A payment page for this seller is still open. Close it, then try again in a few minutes.';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
  END IF;
  -- The order: $0 everywhere, paid_with 'free' (fee rule 'free' from the trigger), never a Stripe page,
  -- no setup fee. It is paid-equivalent at once: the existing handover RPCs take it from here.
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents, paid_with)
  VALUES (v_uid, p_seller_id, p_handover, 0, 0, 0, 0, 0, 0, 'free')
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order WHERE c.id = ANY (v_lines);
  IF v_place.id IS NOT NULL THEN
    INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)
    VALUES (v_order, p_seller_id, v_place.id, v_place.label, v_place.address, v_place.area, v_place.lat, v_place.lng, v_place.weekdays);
  END IF;
  UPDATE public.declutter_orders SET status = 'paid', paid_at = now(), card_fee_cents = 0
   WHERE id = v_order AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = v_order AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  PERFORM public.declutter_notify(v_uid, 'payment', 'It''s yours',
    'Your free item is set. Next: choose when to pick it up. Nothing was charged.',
    '/declutter?view=cart', p_seller_id);
  SELECT public.member_display_name(p.full_name, 'Someone') INTO v_taker FROM public.profiles p WHERE p.user_id = v_uid;
  PERFORM public.declutter_notify(p_seller_id, 'payment', 'Free item claimed',
    COALESCE(v_taker, 'Someone') || ' is picking up your free item. Nothing to pay and nothing to set up.',
    '/declutter?tab=selling', v_uid);
  RETURN v_order;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_checkout_free(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_checkout_free(uuid, text) TO authenticated, service_role;

-- Restated from 20261029161347_declutter_porch_weekdays (its newest definition); only the weekday test now reads
-- the order's frozen place (declutter_order_is_porch_day).
CREATE OR REPLACE FUNCTION public.declutter_porch_days(p_order_id uuid)
RETURNS SETOF date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL OR public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT d::date
      FROM generate_series(v_today, v_today + 7, interval '1 day') d
     WHERE (d::date::timestamp AT TIME ZONE 'America/Chicago') < o.paid_at + interval '7 days'
       AND public.declutter_order_is_porch_day(o.id, extract(dow FROM d::date)::smallint)
     ORDER BY 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_porch_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_days(uuid) TO authenticated, service_role;

-- Restated from 20261029161347_declutter_porch_weekdays (its newest definition); only the weekday test now reads
-- the order's frozen place (declutter_order_is_porch_day).
CREATE OR REPLACE FUNCTION public.declutter_book_porch_day(p_order_id uuid, p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  v_side text;
  v_kind text;
  v_start timestamptz;
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
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_day IS NULL OR p_day < (now() AT TIME ZONE 'America/Chicago')::date
     OR (p_day::timestamp AT TIME ZONE 'America/Chicago') >= o.paid_at + interval '7 days' THEN
    RAISE EXCEPTION 'invalid_day' USING ERRCODE = '22023',
      HINT = 'Pick a day from today until the 7-day pickup deadline.';
  END IF;
  IF NOT public.declutter_order_is_porch_day(o.id, extract(dow FROM p_day)::smallint) THEN
    RAISE EXCEPTION 'invalid_day' USING ERRCODE = '22023', HINT = 'Pick one of the seller''s pickup days.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'seller_set_out' USING ERRCODE = '55000', HINT = 'The item is already out on the porch.';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  -- declutter_book_pickup's own rules, for a day.
  IF v_side = 'buyer' THEN
    IF b.order_id IS NULL THEN
      v_kind := 'booked';
    ELSIF b.slot_start IS NULL THEN
      IF b.buyer_rebooked THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000';
      END IF;
      v_kind := 'rebooked';
    ELSE
      IF b.buyer_reschedules >= 1 THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
      END IF;
      v_kind := 'rescheduled';
    END IF;
  ELSE
    IF b.order_id IS NULL OR b.slot_start IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'The buyer picks the day first.';
    END IF;
    IF b.seller_reschedules >= 1 THEN
      RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
    END IF;
    v_kind := 'seller_rescheduled';
  END IF;
  v_start := p_day::timestamp AT TIME ZONE 'America/Chicago';
  IF b.order_id IS NULL THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end, porch_mode, pickup_day, reminded_slot_start)
    VALUES (o.id, o.buyer_id, o.seller_id, v_start, v_start + interval '30 minutes', 'all_day', p_day, v_start);
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
  ELSE
    UPDATE public.declutter_bookings
       SET slot_start = v_start, slot_end = v_start + interval '30 minutes', pickup_day = p_day,
           porch_mode = 'all_day', porch_until = NULL, reminded_slot_start = v_start, updated_at = now(),
           buyer_reschedules = buyer_reschedules + CASE WHEN v_kind = 'rescheduled' THEN 1 ELSE 0 END,
           seller_reschedules = seller_reschedules + CASE WHEN v_kind = 'seller_rescheduled' THEN 1 ELSE 0 END,
           buyer_rebooked = buyer_rebooked OR v_kind = 'rebooked'
     WHERE order_id = o.id;
  END IF;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'declutter_pickups',
    CASE v_kind WHEN 'booked' THEN 'Porch pickup day booked' ELSE 'Porch pickup day changed' END,
    CASE WHEN v_side = 'buyer'
         THEN format('The buyer picks it up from your porch on %s. Put it out that day and post the porch photo.', to_char(p_day, 'FMDay, Mon FMDD'))
         ELSE format('Your porch pickup is now on %s. We''ll tell you when it''s out.', to_char(p_day, 'FMDay, Mon FMDD')) END,
    CASE WHEN v_side = 'buyer' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END,
    v_uid);
  RETURN jsonb_build_object('result', v_kind, 'pickup_day', p_day);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_book_porch_day(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_book_porch_day(uuid, date) TO authenticated, service_role;

-- Restated from 20261029201542_declutter_porch_photo_not_before_the_day (its newest definition); only the distance
-- now reads the order's pickup points.
CREATE OR REPLACE FUNCTION public.declutter_porch_photo(p_order_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_m integer;
  v_done jsonb;
  v_day date;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' AND o.handover = 'porch' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  -- Audit 1a #4 (20261029201542): the seller puts it out ON the buyer's booked day, never before, so the buyer is
  -- not told to come early and the payout clock does not start early. The day is the booking's porch day, else the
  -- Louisiana date of an older timed booking's slot.
  IF v_side = 'seller' THEN
    SELECT COALESCE(b.pickup_day, (b.slot_start AT TIME ZONE 'America/Chicago')::date) INTO v_day
      FROM public.declutter_bookings b WHERE b.order_id = o.id;
    -- Fail closed: no day read (not_booked_yet above should make that impossible) is refused too, never waved through.
    IF v_day IS NULL OR (now() AT TIME ZONE 'America/Chicago')::date < v_day THEN
      RAISE EXCEPTION 'porch_day_not_yet' USING ERRCODE = '55000',
        HINT = format('Put it out on %s, the day the buyer picked.', to_char(v_day, 'FMDay, Mon FMDD'));
    END IF;
  END IF;
  IF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
  IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
    RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
      HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
  END IF;
  -- Both sides' photos are taken at the address (20261028235709): the seller's "Left on porch" as the buyer's
  -- "Picked up".
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  -- Haversine, metres, to the NEAREST pickup point of the ORDER (D-NEW14, 20261030164712): the porch place frozen
  -- on it at checkout, else (an order with no place) every item's own point, as before (authz review 2.7).
  SELECT min(round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat - pt.lat) / 2)), 2)
           + cos(radians(pt.lat)) * cos(radians(p_lat)) * power(sin(radians((p_lng - pt.lng) / 2)), 2)))))::integer)
    INTO v_m
    FROM public.declutter_order_pickup_points(o.id) pt;
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  IF v_side = 'seller' THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now(), set_out_distance_m = v_m
     WHERE order_id = o.id;
    -- The buyer's signal to go (20261028225038): its own title, the Pickups switch, Buying.
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'It''s on the porch: pick it up today',
      'The seller put your item out. Take a photo when you pick it up.', '/declutter?tab=buying', o.seller_id);
    RETURN jsonb_build_object('result', 'set_out', 'distance_m', v_m);
  END IF;
  UPDATE public.declutter_handovers
     SET picked_up_photo_path = p_photo_path, picked_up_at = now(), picked_up_distance_m = v_m
   WHERE order_id = o.id;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Your item was picked up',
      'The buyer picked up the item from your porch. A problem report is open, so Louisiana Helpr decides before anyone is paid.',
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', false);
  END IF;
  v_done := public.declutter_complete_handover(o.id, 'porch');
  RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', true, 'payout_id', v_done->'payout_id');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) TO authenticated, service_role;

-- Restated from 20261015042253_declutter_slice4_handover_payout (its newest definition); only the frozen-place
-- answer for the paid buyer is new.
CREATE OR REPLACE FUNCTION public.declutter_item_address(p_item_id uuid)
RETURNS TABLE(pickup_address text, pickup_lat numeric, pickup_lng numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_access text := public.declutter_address_access(p_item_id, (SELECT auth.uid()));
  v_pp public.declutter_order_porch_places%ROWTYPE;
BEGIN
  IF v_access IS DISTINCT FROM 'paid_buyer' AND NOT public.declutter_in_agreed_sale(p_item_id, (SELECT auth.uid())) THEN
    PERFORM public.require_feature('declutter');
  END IF;
  IF v_access IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
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
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_address(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_item_address(uuid) TO authenticated, service_role;

-- Restated from 20261017055505_declutter_helpr_delivery (its newest definition); only the chosen-place pickup is new.
CREATE OR REPLACE FUNCTION public.declutter_delivery_compute(p_buyer uuid, p_seller uuid, p_lines uuid[])
RETURNS TABLE (road_miles integer, size text, delivery_cents integer, base_cents integer, per_mile_cents integer,
               size_cents integer, pickup_address text, pickup_lat numeric, pickup_lng numeric, dropoff_address text,
               dropoff_area text, dropoff_lat numeric, dropoff_lng numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  d public.declutter_delivery_dropoffs;
  v_sizes text[];
  v_addr text;
  v_lat numeric;
  v_lng numeric;
  v_far integer;
  v_miles integer;
  v_place public.declutter_porch_places%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.declutter_delivery_dropoffs x WHERE x.buyer_id = p_buyer AND x.seller_id = p_seller;
  IF NOT FOUND OR d.geocoded_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'delivery_address_needed' USING ERRCODE = '22023',
      HINT = 'Enter the address to deliver to.';
  END IF;
  -- D-NEW14 (20261030164712): a seller with saved porch places is picked up from the place the buyer chose.
  IF EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller) THEN
    SELECT pl.* INTO v_place
      FROM public.declutter_porch_place_choices ch
      JOIN public.declutter_porch_places pl ON pl.id = ch.place_id
     WHERE ch.buyer_id = p_buyer AND ch.seller_id = p_seller AND pl.seller_id = p_seller;
    IF v_place.id IS NULL THEN
      RAISE EXCEPTION 'porch_place_needed' USING ERRCODE = '22023',
        HINT = 'Pick which of the seller''s pickup places the Helpr picks up from.';
    END IF;
  END IF;
  SELECT array_agg(i.delivery_size ORDER BY c.id),
         (array_agg(p.pickup_address ORDER BY c.id))[1],
         (array_agg(p.pickup_lat ORDER BY c.id))[1],
         (array_agg(p.pickup_lng ORDER BY c.id))[1]
    INTO v_sizes, v_addr, v_lat, v_lng
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.buyer_id = p_buyer AND c.seller_id = p_seller
     AND (CASE WHEN p_lines IS NULL THEN c.status = 'in_cart' AND c.checkout_by > now() ELSE c.id = ANY (p_lines) END);
  IF v_sizes IS NULL OR cardinality(v_sizes) = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000';
  END IF;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RAISE EXCEPTION 'delivery_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_place.id IS NOT NULL THEN
    -- D-NEW14: one place is one pickup stop.
    v_addr := v_place.address;
    v_lat := v_place.lat;
    v_lng := v_place.lng;
  ELSE
  -- B61: one pickup stop. Every item within 200 m of the first one's address.
  SELECT max(public.helpr_task_distance_m(v_lat, v_lng, p.pickup_lat, p.pickup_lng)) INTO v_far
    FROM public.declutter_cart_items c
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.buyer_id = p_buyer AND c.seller_id = p_seller
     AND (CASE WHEN p_lines IS NULL THEN c.status = 'in_cart' AND c.checkout_by > now() ELSE c.id = ANY (p_lines) END);
  IF v_far IS NULL OR v_far > 200 THEN
    RAISE EXCEPTION 'delivery_one_address' USING ERRCODE = '22023',
      HINT = 'These items are at different addresses, so they can''t be delivered together. Choose pickup.';
  END IF;
  END IF;
  -- Priced from the ROUNDED pickup point (2 decimals, ~1 km), never the exact
  -- one: the buyer chooses the drop-off, so a price measured from the exact
  -- point would let a buyer with an unpaid cart line trilaterate the seller's
  -- home by quoting chosen addresses (lh-authz-rls review #2, 2026-10-16; row
  -- 27). The error is at most about a mile, about $2.
  v_miles := public.declutter_road_miles(round(v_lat, 2), round(v_lng, 2), d.lat, d.lng);
  RETURN QUERY SELECT v_miles,
    CASE WHEN 'xl' = ANY (v_sizes) THEN 'xl' WHEN 'large' = ANY (v_sizes) THEN 'large' ELSE 'small' END,
    public.declutter_delivery_price_cents(v_miles, v_sizes),
    1000, 200 * v_miles, public.declutter_delivery_price_cents(v_miles, v_sizes) - 1000 - 200 * v_miles,
    v_addr, v_lat, v_lng, d.address, d.area_label, d.lat, d.lng;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_compute(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_compute(uuid, uuid, uuid[]) TO service_role;

-- Restated from 20261028200440_declutter_audit3_notices_and_empty_cart (its newest definition); only the frozen
-- place as the Helpr's pickup is new.
CREATE OR REPLACE FUNCTION public.declutter_delivery_open_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  od public.declutter_order_deliveries;
  v_task uuid;
  v_title text;
  v_addr text;
  v_lat numeric;
  v_lng numeric;
  v_area text;
  v_pp public.declutter_order_porch_places%ROWTYPE;
BEGIN
  IF NEW.status <> 'paid' OR OLD.status = 'paid' OR NEW.handover <> 'delivery' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO od FROM public.declutter_order_deliveries WHERE order_id = NEW.id;
  IF NOT FOUND OR od.task_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(i.title, ', ' ORDER BY c.id),
         (array_agg(p.pickup_address ORDER BY c.id))[1],
         (array_agg(p.pickup_lat ORDER BY c.id))[1],
         (array_agg(p.pickup_lng ORDER BY c.id))[1],
         (array_agg(i.area_label ORDER BY c.id))[1]
    INTO v_title, v_addr, v_lat, v_lng, v_area
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.order_id = NEW.id;
  -- D-NEW14 (20261030164712): the Helpr picks up at the porch place frozen on the order, when it has one.
  SELECT * INTO v_pp FROM public.declutter_order_porch_places pp WHERE pp.order_id = NEW.id;
  IF v_pp.order_id IS NOT NULL THEN
    v_addr := v_pp.address;
    v_lat := v_pp.lat;
    v_lng := v_pp.lng;
    v_area := v_pp.area;
  END IF;
  v_task := public.helpr_task_create('declutter_delivery', NEW.id, od.size, COALESCE(v_title, 'Declutter delivery'),
    COALESCE(v_area, 'Louisiana'), v_addr, v_lat, v_lng,
    od.dropoff_area, od.dropoff_address, od.dropoff_lat, od.dropoff_lng, od.road_miles, NEW.delivery_cents,
    NEW.buyer_id, NEW.seller_id,
    least(COALESCE(NEW.paid_at, now()) + interval '48 hours', COALESCE(NEW.paid_at, now()) + interval '7 days' - interval '2 hours'),
    COALESCE(NEW.paid_at, now()) + interval '7 days', NEW.is_seed);
  UPDATE public.declutter_order_deliveries SET task_id = v_task WHERE order_id = NEW.id;
  PERFORM public.declutter_notify(NEW.seller_id, 'payment', 'A Helpr will pick it up',
    'Your buyer chose Helpr delivery. We''re finding a Helpr; you''ll be told the pickup time.', '/declutter?tab=selling', NEW.buyer_id);
  RETURN NEW;
END;
$fn$;

-- Every public table keeps the unconfirmed-email gate (Q807; db-deploy smoke): the three tables above.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- Restated from 20261030071818_declutter_returns (its newest definition, Q2486); only the distance now reads the
-- order's pickup points.
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
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
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
