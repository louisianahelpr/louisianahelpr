-- B110 (owner 11-01 1:00 PM; lead spec): a SELLER adds their own public meet spots (name, address of a public place,
-- days and times, e.g. "Walmart parking lot, New Iberia · Sat 9-12"); the police safe spots are offered as one-tap
-- suggestions; at checkout "Meet up" lists the seller's spots (with the admin spots near, as before).
--
-- 1. declutter_meetup_spots: seller_id (NULL = an admin spot, as before), windows (the seller's days and times),
--    kind 'seller'. Members still cannot read the table (the admins-read policy is unchanged): every read is an RPC.
-- 2. declutter_meetup_spot_near_lines, restated from its newest CREATE (20261027204500_declutter_safe_meetup): a
--    seller's spot is usable only for THAT seller's lines (any distance: the seller chose it); an admin spot as before
--    (active and within max_miles of every item). declutter_meetup_spots_near, declutter_set_meetup_spot and
--    declutter_start_checkout call it, so a buyer sees and checks out with only this seller's spots plus admin spots.
-- 3. New member RPCs (authenticated): declutter_my_meetup_spots, declutter_save_my_meetup_spot (owner only, max 10
--    active), declutter_remove_my_meetup_spot (switched off, never deleted: orders keep their snapshot),
--    declutter_meetup_spot_suggestions (active admin POLICE spots: public places, name + address).
-- 4. declutter_order_slot_in_windows, restated from its newest CREATE (20261031171727): a meetup at a seller spot with
--    days and times keeps to THOSE (checkout's pickup time and declutter_book_pickup both call it).
--
-- AUTHZ: a seller writes only their own rows (seller_id = auth.uid()); the address is public by design (a public
-- place). MONEY: none. REPLAY-SAFE: IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE.
-- Proof: src/test/pglite/declutterSellerMeetupSpots.pglite.mjs.

ALTER TABLE public.declutter_meetup_spots ADD COLUMN IF NOT EXISTS seller_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.declutter_meetup_spots ADD COLUMN IF NOT EXISTS windows jsonb;
ALTER TABLE public.declutter_meetup_spots DROP CONSTRAINT IF EXISTS declutter_meetup_spots_kind_check;
ALTER TABLE public.declutter_meetup_spots ADD CONSTRAINT declutter_meetup_spots_kind_check
  CHECK (kind IN ('police', 'store', 'other', 'seller'));
ALTER TABLE public.declutter_meetup_spots DROP CONSTRAINT IF EXISTS declutter_meetup_spots_seller_kind;
ALTER TABLE public.declutter_meetup_spots ADD CONSTRAINT declutter_meetup_spots_seller_kind
  CHECK ((seller_id IS NULL) = (kind <> 'seller'));
CREATE INDEX IF NOT EXISTS declutter_meetup_spots_seller_idx ON public.declutter_meetup_spots (seller_id) WHERE seller_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.declutter_meetup_spot_near_lines(p_spot_id uuid, p_lines uuid[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(cardinality(p_lines), 0) > 0
     AND EXISTS (SELECT 1 FROM public.declutter_meetup_spots s WHERE s.id = p_spot_id AND s.active)
     -- B110: a seller's own spot serves only that seller's lines.
     AND NOT EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_meetup_spots s ON s.id = p_spot_id
        WHERE c.id = ANY (p_lines) AND s.seller_id IS NOT NULL AND c.seller_id IS DISTINCT FROM s.seller_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
         JOIN public.declutter_meetup_spots s ON s.id = p_spot_id
        WHERE c.id = ANY (p_lines)
          AND s.seller_id IS NULL
          AND public.declutter_miles_between(i.area_lat, i.area_lng, s.lat, s.lng)
              > (public.declutter_meetup_rules() ->> 'max_miles')::numeric);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_meetup_spot_near_lines(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_meetup_spot_near_lines(uuid, uuid[]) TO service_role;

-- Days and times, as declutter_porch_places.windows: [{weekday 0-6, starts "HH:MM", ends "HH:MM"}], at most 21.
CREATE OR REPLACE FUNCTION public.declutter_meetup_windows_ok(p_windows jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_windows IS NULL OR (
    jsonb_typeof(p_windows) = 'array' AND jsonb_array_length(p_windows) BETWEEN 1 AND 21
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_windows) e
       WHERE jsonb_typeof(e) <> 'object'
          OR (e ->> 'weekday') !~ '^[0-6]$'
          OR (e ->> 'starts') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
          OR (e ->> 'ends') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
          OR (e ->> 'ends')::time < (e ->> 'starts')::time + interval '30 minutes'));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_meetup_windows_ok(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_meetup_windows_ok(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_my_meetup_spots()
RETURNS TABLE (id uuid, name text, address text, area text, lat numeric, lng numeric, windows jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.name, s.address, s.parish, s.lat, s.lng, s.windows
      FROM public.declutter_meetup_spots s
     WHERE s.seller_id = v_uid AND s.active
     ORDER BY s.created_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_meetup_spots() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_meetup_spots() TO authenticated, service_role;

-- Add (p_id NULL) or edit one of the caller's own spots. The address is a public place's, shown to buyers at checkout.
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
    RAISE EXCEPTION 'meetup_spot_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_save_my_meetup_spot(uuid, text, text, text, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_save_my_meetup_spot(uuid, text, text, text, numeric, numeric, jsonb) TO authenticated, service_role;

-- Switched off, never deleted: an order already made keeps its frozen snapshot (declutter_order_meetups).
CREATE OR REPLACE FUNCTION public.declutter_remove_my_meetup_spot(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_meetup_spots s SET active = false, updated_at = now()
   WHERE s.id = p_id AND s.seller_id = v_uid AND s.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meetup_spot_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_remove_my_meetup_spot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_my_meetup_spot(uuid) TO authenticated, service_role;

-- The police safe spots as one-tap suggestions for a seller's own list (public places; name, address, area).
CREATE OR REPLACE FUNCTION public.declutter_meetup_spot_suggestions()
RETURNS TABLE (id uuid, name text, address text, area text, lat numeric, lng numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.name, s.address, s.parish, s.lat, s.lng
      FROM public.declutter_meetup_spots s
     WHERE s.active AND s.seller_id IS NULL AND s.kind = 'police'
     ORDER BY s.parish, s.name
     LIMIT 100;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_meetup_spot_suggestions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_meetup_spot_suggestions() TO authenticated, service_role;

-- 4. Restated from 20261031171727_declutter_porch_days_without_places (newest CREATE).
CREATE OR REPLACE FUNCTION public.declutter_order_slot_in_windows(p_order_id uuid, p_seller uuid, p_start timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_hours jsonb;
  v_local timestamp := p_start AT TIME ZONE 'America/Chicago';
BEGIN
  -- Q140: a NULL argument never says yes (a NULL order would fall through to the seller's usual times).
  IF p_order_id IS NULL OR p_seller IS NULL OR p_start IS NULL THEN
    RETURN false;
  END IF;
  SELECT op.windows INTO v_hours FROM public.declutter_order_porch_places op WHERE op.order_id = p_order_id;
  -- B110: a meetup at a seller's own spot with days and times keeps to THOSE.
  IF v_hours IS NULL THEN
    SELECT s.windows INTO v_hours
      FROM public.declutter_orders o
      JOIN public.declutter_order_meetups m ON m.order_id = o.id
      JOIN public.declutter_meetup_spots s ON s.id = m.spot_id
     WHERE o.id = p_order_id AND o.handover = 'meetup' AND s.seller_id IS NOT NULL;
  END IF;
  IF v_hours IS NULL THEN
    -- Review 2026-10-31 #2: a porch order with no frozen place keeps to the seller's porch days.
    IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = p_order_id AND o.handover = 'porch')
       AND NOT public.declutter_order_is_porch_day(p_order_id, extract(dow FROM v_local)::smallint) THEN
      RETURN false;
    END IF;
    RETURN public.declutter_slot_in_windows(p_seller, p_start);
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_hours) e
     WHERE (e ->> 'weekday')::int = extract(dow FROM v_local)::int
       AND v_local::time >= (e ->> 'starts')::time
       AND (e ->> 'ends')::time >= (e ->> 'starts')::time + interval '30 minutes'
       AND v_local::time <= (e ->> 'ends')::time - interval '30 minutes');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_slot_in_windows(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_slot_in_windows(uuid, uuid, timestamptz) TO service_role;
