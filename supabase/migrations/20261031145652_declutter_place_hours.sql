-- Declutter: each pickup place has its own days AND hours (LEAD-PLACE-TIMES, owner 2026-10-31 09:38: "one Pickup
-- places card; each place = address + days + hours using the existing Same hours every day / Different each day
-- control; remove the separate Pickup times card; copy current usual times onto places without their own").
--
-- WHAT WAS THERE (20261030164712, D-NEW14): a place had weekdays only; the hours came from the seller's usual pickup
-- times (declutter_pickup_windows), one set for every place.
--
-- WHAT THIS ADDS:
--   1. declutter_porch_places.windows and declutter_order_porch_places.windows (jsonb, the same
--      [{weekday, starts, ends}] rows declutter_set_pickup_windows takes). A CHECK keeps them well formed.
--   2. declutter_place_windows_fill(windows, seller, days) (internal): for each day, the place's own hours that day,
--      else the seller's usual hours that day, else the place's first hours, else the seller's first usual hours.
--      Backfill: every place with no hours gets it (the owner: 7 AM to 9 PM every day), so nobody loses theirs.
--   3. declutter_save_porch_place gains p_windows (DEFAULT NULL, so an older app build saving days only still works:
--      its hours are filled as above). With windows, the place's weekdays are the windows' days.
--      Signature changed: the 7-argument one is dropped first (an overload would make the call ambiguous).
--   4. declutter_my_porch_places and declutter_seller_porch_places also return windows (DROP + CREATE: the row type
--      changed). Never an address to the buyer, as before.
--   5. declutter_item_pickup_places(item) (new): the item page's places (label, area, days, hours; no address).
--   6. The order freezes the chosen place's hours (BEFORE INSERT trigger on declutter_order_porch_places, so the two
--      checkout functions are not restated): the seller editing hours later never moves a sale.
--   7. declutter_order_pickup_windows (newest: 20261028195840) reads the frozen place's hours when the order has
--      them, else the seller's usual times as before. declutter_book_pickup (newest: 20261015042253) checks the
--      buyer's time against the same (declutter_order_slot_in_windows, new, internal).
--
-- MONEY: no amount changes. REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, constraint added only when missing, DROP FUNCTION
-- IF EXISTS before each changed signature, CREATE OR REPLACE, DROP TRIGGER IF EXISTS; the backfill touches only rows
-- with no hours. Proof: src/test/pglite/declutterPlaceHours.pglite.mjs (applied 3x).

ALTER TABLE public.declutter_porch_places ADD COLUMN IF NOT EXISTS windows jsonb;
ALTER TABLE public.declutter_order_porch_places ADD COLUMN IF NOT EXISTS windows jsonb;

-- Well formed: 1-21 rows, weekday 0-6, "HH:MM" times, at least 30 minutes long (declutter_slot_in_windows' rule).
CREATE OR REPLACE FUNCTION public.declutter_place_windows_valid(p_windows jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_typeof(p_windows) = 'array'
     AND jsonb_array_length(p_windows) BETWEEN 1 AND 21
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_windows) e
        WHERE jsonb_typeof(e) <> 'object'
           OR coalesce(e ->> 'weekday', '') !~ '^[0-6]$'
           OR coalesce(e ->> 'starts', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR coalesce(e ->> 'ends', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR (e ->> 'ends')::time < (e ->> 'starts')::time + interval '30 minutes');
$fn$;
REVOKE ALL ON FUNCTION public.declutter_place_windows_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_place_windows_valid(jsonb) TO service_role;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_porch_places_windows_ok') THEN
    ALTER TABLE public.declutter_porch_places ADD CONSTRAINT declutter_porch_places_windows_ok
      CHECK (windows IS NULL OR public.declutter_place_windows_valid(windows));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_order_porch_places_windows_ok') THEN
    ALTER TABLE public.declutter_order_porch_places ADD CONSTRAINT declutter_order_porch_places_windows_ok
      CHECK (windows IS NULL OR public.declutter_place_windows_valid(windows));
  END IF;
END;
$do$;

-- For each day: the place's own hours that day, else the seller's usual hours that day, else the place's first
-- hours, else the seller's first usual hours. NULL only when there are no hours anywhere (no usual times, none given).
CREATE OR REPLACE FUNCTION public.declutter_place_windows_fill(p_windows jsonb, p_seller uuid, p_days smallint[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_given jsonb := CASE WHEN jsonb_typeof(p_windows) = 'array' THEN p_windows ELSE '[]'::jsonb END;
  v_out jsonb := '[]'::jsonb;
  v_day jsonb;
  v_first jsonb;
  v_usual_first jsonb;
  d smallint;
BEGIN
  SELECT jsonb_build_object('starts', e ->> 'starts', 'ends', e ->> 'ends') INTO v_first
    FROM jsonb_array_elements(v_given) e
   ORDER BY (e ->> 'weekday')::int, e ->> 'starts' LIMIT 1;
  SELECT jsonb_build_object('starts', left(w.starts_local::text, 5), 'ends', left(w.ends_local::text, 5)) INTO v_usual_first
    FROM public.declutter_pickup_windows w
   WHERE w.seller_id = p_seller
   ORDER BY w.weekday, w.starts_local LIMIT 1;
  FOREACH d IN ARRAY coalesce(p_days, '{}'::smallint[]) LOOP
    SELECT jsonb_agg(jsonb_build_object('weekday', d, 'starts', e ->> 'starts', 'ends', e ->> 'ends') ORDER BY e ->> 'starts')
      INTO v_day
      FROM jsonb_array_elements(v_given) e
     WHERE (e ->> 'weekday')::int = d;
    IF v_day IS NULL THEN
      SELECT jsonb_agg(jsonb_build_object('weekday', d, 'starts', left(w.starts_local::text, 5), 'ends', left(w.ends_local::text, 5))
                       ORDER BY w.starts_local)
        INTO v_day
        FROM public.declutter_pickup_windows w
       WHERE w.seller_id = p_seller AND w.weekday = d;
    END IF;
    IF v_day IS NULL AND coalesce(v_first, v_usual_first) IS NOT NULL THEN
      v_day := jsonb_build_array(jsonb_build_object('weekday', d) || coalesce(v_first, v_usual_first));
    END IF;
    IF v_day IS NULL THEN
      RETURN NULL;
    END IF;
    v_out := v_out || v_day;
  END LOOP;
  IF jsonb_array_length(v_out) = 0 OR jsonb_array_length(v_out) > 21 OR NOT public.declutter_place_windows_valid(v_out) THEN
    RETURN NULL;
  END IF;
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_place_windows_fill(jsonb, uuid, smallint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_place_windows_fill(jsonb, uuid, smallint[]) TO service_role;

-- Backfill: places with no hours of their own get the seller's usual times (only rows still without hours).
UPDATE public.declutter_porch_places pl
   SET windows = public.declutter_place_windows_fill(NULL, pl.seller_id, pl.weekdays)
 WHERE pl.windows IS NULL;

-- 3. Save, with hours. Restated from 20261030164712 (its newest definition); the hours are new.
DROP FUNCTION IF EXISTS public.declutter_save_porch_place(uuid, text, text, text, numeric, numeric, smallint[]);
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
      RAISE EXCEPTION 'porch_place_not_found' USING ERRCODE = 'P0002';
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

-- 4. The seller's own places, now with hours. Restated from 20261030164712.
DROP FUNCTION IF EXISTS public.declutter_my_porch_places();
CREATE OR REPLACE FUNCTION public.declutter_my_porch_places()
RETURNS TABLE (id uuid, "position" smallint, label text, address text, area text, lat numeric, lng numeric, weekdays smallint[], windows jsonb)
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
    SELECT pl.id, pl.position, pl.label, pl.address, pl.area, pl.lat::numeric, pl.lng::numeric, pl.weekdays,
           coalesce(pl.windows, public.declutter_place_windows_fill(NULL, pl.seller_id, pl.weekdays))
      FROM public.declutter_porch_places pl
     WHERE pl.seller_id = v_uid
     ORDER BY pl.position;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_porch_places() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_porch_places() TO authenticated, service_role;

-- The buyer's view for their cart with that seller: label, area, days, hours; never an address. Restated from 20261030164712.
DROP FUNCTION IF EXISTS public.declutter_seller_porch_places(uuid);
CREATE OR REPLACE FUNCTION public.declutter_seller_porch_places(p_seller_id uuid)
RETURNS TABLE (id uuid, label text, area text, weekdays smallint[], chosen boolean, windows jsonb)
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
                    WHERE ch.buyer_id = v_uid AND ch.seller_id = p_seller_id AND ch.place_id = pl.id),
           coalesce(pl.windows, public.declutter_place_windows_fill(NULL, pl.seller_id, pl.weekdays))
      FROM public.declutter_porch_places pl
     WHERE pl.seller_id = p_seller_id
     ORDER BY pl.position;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_porch_places(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_porch_places(uuid) TO authenticated, service_role;

-- 5. The item page's places (LEAD-POST-PLACES): label, area, days and hours of a listing still for sale; no address.
-- The same visibility as declutter_item_pickup_windows (20261030080020) for an item that is live or reserved.
CREATE OR REPLACE FUNCTION public.declutter_item_pickup_places(p_item_id uuid)
RETURNS TABLE (label text, area text, weekdays smallint[], windows jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seller uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT i.seller_id INTO v_seller FROM public.declutter_items i
   WHERE i.id = p_item_id
     AND ((i.status IN ('live', 'reserved') AND NOT i.seller_hidden) OR i.seller_id = v_uid);
  IF v_seller IS NULL OR (v_seller <> v_uid AND public.are_users_blocked(v_seller, v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- An out seller's places are never shown to anyone else (as declutter_seller_porch_places).
  IF v_seller <> v_uid AND public.declutter_seller_out(v_seller) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT pl.label, pl.area, pl.weekdays,
           coalesce(pl.windows, public.declutter_place_windows_fill(NULL, pl.seller_id, pl.weekdays))
      FROM public.declutter_porch_places pl
     WHERE pl.seller_id = v_seller
     ORDER BY pl.position;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_pickup_places(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_item_pickup_places(uuid) TO authenticated, service_role;

-- 6. The order freezes the chosen place's hours (filled the same way when the place has none of its own).
CREATE OR REPLACE FUNCTION public.declutter_order_porch_place_freeze_hours()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.windows IS NULL AND NEW.place_id IS NOT NULL THEN
    SELECT coalesce(pl.windows, public.declutter_place_windows_fill(NULL, pl.seller_id, pl.weekdays)) INTO NEW.windows
      FROM public.declutter_porch_places pl WHERE pl.id = NEW.place_id;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_porch_place_freeze_hours() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS declutter_order_porch_place_freeze_hours ON public.declutter_order_porch_places;
CREATE TRIGGER declutter_order_porch_place_freeze_hours BEFORE INSERT ON public.declutter_order_porch_places
  FOR EACH ROW EXECUTE FUNCTION public.declutter_order_porch_place_freeze_hours();

-- 7. The order's times: the frozen place's hours, else the seller's usual times. Restated from 20261028195840.
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
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
     ORDER BY w.weekday, w.starts_local;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_pickup_windows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_pickup_windows(uuid) TO authenticated, service_role;

-- A time inside the order's hours: the frozen place's, else declutter_slot_in_windows (the seller's usual times).
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
  IF v_hours IS NULL THEN
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

-- Restated from 20261015042253 (its newest definition); only the buyer's window check reads the order's hours now.
CREATE OR REPLACE FUNCTION public.declutter_book_pickup(p_order_id uuid, p_slot_start timestamptz)
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
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_slot_start IS NULL OR p_slot_start <= now() OR p_slot_start + interval '30 minutes' > o.paid_at + interval '7 days' THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
      HINT = 'Pick a time in the future, before the 7-day pickup deadline.';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  IF v_side = 'buyer' THEN
    IF NOT public.declutter_order_slot_in_windows(o.id, o.seller_id, p_slot_start) THEN
      RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023', HINT = 'Pick a time inside the seller''s pickup times.';
    END IF;
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
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'The buyer books the pickup first.';
    END IF;
    IF b.seller_reschedules >= 1 THEN
      RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
    END IF;
    v_kind := 'seller_rescheduled';
  END IF;
  IF b.order_id IS NULL THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
    VALUES (o.id, o.buyer_id, o.seller_id, p_slot_start, p_slot_start + interval '30 minutes');
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
  ELSE
    UPDATE public.declutter_bookings
       SET slot_start = p_slot_start, slot_end = p_slot_start + interval '30 minutes', updated_at = now(),
           -- a moved porch slot asks the seller again (row 97)
           porch_mode = NULL, porch_until = NULL,
           buyer_reschedules = buyer_reschedules + CASE WHEN v_kind = 'rescheduled' THEN 1 ELSE 0 END,
           seller_reschedules = seller_reschedules + CASE WHEN v_kind = 'seller_rescheduled' THEN 1 ELSE 0 END,
           buyer_rebooked = buyer_rebooked OR v_kind = 'rebooked'
     WHERE order_id = o.id;
  END IF;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'payment',
    CASE v_kind WHEN 'booked' THEN 'Pickup booked' ELSE 'Pickup time changed' END,
    format('Pickup is %s.', to_char(p_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END,
    v_uid);
  RETURN jsonb_build_object('result', v_kind, 'slot_start', p_slot_start);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_book_pickup(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_book_pickup(uuid, timestamptz) TO authenticated, service_role;

-- 8. The Helpr delivery path reads the frozen place hours too (review 2026-10-31). Restated from their newest CREATEs:
-- declutter_delivery_slot_ok (20261017055505, the second CREATE in that file; helpr_task_source_slot_ok calls it) and
-- helpr_task_pickup_windows (20261031082821). Only the hours they read change: the order's frozen place hours, else
-- the seller's usual times, as before.
CREATE OR REPLACE FUNCTION public.declutter_delivery_slot_ok(p_order_id uuid, p_start timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = p_order_id AND o.status = 'paid' AND o.handover = 'delivery'
                    AND p_start > now() AND p_start + interval '30 minutes' <= o.paid_at + interval '7 days'
                    AND public.declutter_order_slot_in_windows(o.id, o.seller_id, p_start));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_slot_ok(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_slot_ok(uuid, timestamptz) TO service_role;

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
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
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
