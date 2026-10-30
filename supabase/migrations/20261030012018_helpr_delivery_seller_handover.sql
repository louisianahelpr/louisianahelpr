-- A HELPR CAN NO LONGER MARK A DELIVERY "PICKED UP" DAYS EARLY; THE SELLER CAN CONFIRM THE HANDOVER;
-- A HELD PICKUP LEAVES THE HELPR'S STEPS AND ROUTE (app audit 2026-10-28, report 1c findings 1 and 4).
--
-- Before (prod's effective definitions, pg_get_functiondef read 2026-10-29): helpr_task_picked_up had no
-- time check. A Helpr booked for Sat 9:00 AM took the photo at the seller's address at 8:09 PM Thursday,
-- the seller's card said "picked it up" and the seller had no say. Picking up also opened the buyer's
-- drop-off address at once (helpr_task_dropoff_shows_at returns -infinity from 'picked_up'), around the
-- "2 hours before the pickup" rule. And after "The seller wasn't there" (an open declutter_problems row)
-- helpr_task_view gave the Helpr no sign of it, so the card kept offering "Picked up" (which then failed
-- with problem_open) and helpr_my_route kept the stop.
--
-- Now (lead-approved plan, 2026-10-29):
-- 1. helpr_task_picked_up refuses 'too_early' until 30 minutes before the booked pickup_slot_start
--    (helpr_task_accept never leaves it NULL), unless the seller confirmed the handover to THIS Helpr.
--    The photo within 200 m is still required either way.
-- 2. helpr_task_handed_over(task): the seller (pickup_contact) taps "Handed over" while the delivery is
--    accepted. It records handed_over_at / handed_over_to and a 'handed_over' task event. It changes no
--    status and moves no money: the Helpr still takes the photo. A reopened task (helpr_id changes)
--    never inherits the confirmation, because the gate compares handed_over_to with the caller.
-- 3. helpr_task_view also returns handed_over_at (to the Helpr, buyer and seller, only while it is for
--    the current Helpr) and problem_open (to the same three; a candidate reads neither).
-- 4. helpr_my_route leaves out an accepted task whose source is held by an open problem.
--
-- Restated from prod: helpr_task_picked_up (newest file 20261017055505), helpr_task_view (newest file
-- 20261027201327), helpr_my_route (newest file 20261028231116), each with only the lines marked
-- 20261030012018 changed. Replay-safe: ADD COLUMN IF NOT EXISTS, the event CHECK dropped and re-added,
-- CREATE OR REPLACE; grants restated (REVOKE ... FROM PUBLIC, anon).
-- Proof: src/test/pglite/helprDeliverySellerHandover.pglite.mjs (3x; NEW_MIGRATION=skip is red).

ALTER TABLE public.helpr_tasks
  ADD COLUMN IF NOT EXISTS handed_over_at timestamptz,
  ADD COLUMN IF NOT EXISTS handed_over_to uuid;

ALTER TABLE public.helpr_task_events DROP CONSTRAINT IF EXISTS helpr_task_events_task_event_check;
ALTER TABLE public.helpr_task_events ADD CONSTRAINT helpr_task_events_task_event_check CHECK (task_event IN (
  'created', 'accepted', 'released', 'helpr_no_show', 'picked_up', 'delivered', 'wrong_code', 'confirmed',
  'unfilled', 'cancelled', 'failed', 'pickup_no_show', 'handed_over'));

-- helpr_task_picked_up: restated from prod (20261017055505); the 'too_early' gate is new.
CREATE OR REPLACE FUNCTION public.helpr_task_picked_up(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status = 'picked_up' THEN
    RETURN jsonb_build_object('result', 'already_picked_up');
  END IF;
  IF t.status <> 'accepted' THEN
    RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  -- 20261030012018 (audit 1c #1): not before 30 minutes ahead of the booked pickup, unless the seller
  -- tapped "Handed over" for this Helpr. A NULL slot (never left by helpr_task_accept) is refused too.
  IF t.handed_over_to IS DISTINCT FROM v_uid
     AND (t.pickup_slot_start IS NULL OR now() < t.pickup_slot_start - interval '30 minutes') THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000',
      HINT = 'You can mark it picked up 30 minutes before the pickup time, or once the seller taps Handed over.';
  END IF;
  IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  v_m := public.helpr_task_distance_m(p_lat, p_lng, t.pickup_lat, t.pickup_lng);
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  UPDATE public.helpr_tasks SET status = 'picked_up', picked_up_at = now(), pickup_photo_path = p_photo_path, updated_at = now()
   WHERE id = t.id AND status = 'accepted';
  PERFORM public.helpr_task_log(t.id, 'picked_up', v_uid, v_m::text || ' m');
  PERFORM public.helpr_task_source_event(t.id, 'picked_up', NULL);
  RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m);
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_picked_up(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_picked_up(uuid, text, numeric, numeric) TO authenticated, service_role;

-- helpr_task_handed_over: new. The seller confirms they gave the item to the assigned Helpr.
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
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
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

REVOKE ALL ON FUNCTION public.helpr_task_handed_over(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_handed_over(uuid) TO authenticated, service_role;

-- helpr_task_view: restated from prod (20261027201327); handed_over_at and problem_open are new.
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
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
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
      RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
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
    'problem_open', CASE WHEN v_role <> 'candidate' THEN public.helpr_task_source_held(t.source_kind, t.source_id) END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_view(uuid) TO authenticated, service_role;

-- helpr_my_route: restated from prod (20261028231116); a held pickup is left out.
CREATE OR REPLACE FUNCTION public.helpr_my_route(p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_stops jsonb := '[]'::jsonb;
  v_plan jsonb;
  v_out jsonb := '[]'::jsonb;
  t public.helpr_tasks;
  p jsonb;
  v_items jsonb;
  v_porch boolean;
  v_shows timestamptz;
  v_shown boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng IS NULL OR p_lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;
  FOR t IN SELECT * FROM public.helpr_tasks x
            WHERE x.helpr_id = v_uid AND x.status IN ('accepted', 'picked_up')
              -- 20261030012018 (D3-4): a pickup held by an open problem (the Helpr reported "The seller wasn't
              -- there") is no stop until Louisiana Helpr decides; an item already in the car keeps its drop-off.
              AND NOT (x.status = 'accepted' AND public.helpr_task_source_held(x.source_kind, x.source_id))
            ORDER BY x.pickup_slot_start, x.id LOOP
    IF t.status = 'accepted' THEN
      v_stops := v_stops || jsonb_build_array(jsonb_build_object('key', t.id::text || ':pickup', 'task', t.id, 'kind', 'pickup',
        'lat', t.pickup_lat, 'lng', t.pickup_lng, 'slot', t.pickup_slot_start));
    END IF;
    -- The drop-off's exact point only once it is the Helpr's to read (issue #3684); until then ~1 km.
    v_shown := COALESCE(now() > public.helpr_task_dropoff_shows_at(v_uid, t.status, t.pickup_slot_start), false);
    v_stops := v_stops || jsonb_build_array(jsonb_build_object('key', t.id::text || ':dropoff', 'task', t.id, 'kind', 'dropoff',
      'lat', CASE WHEN v_shown THEN t.dropoff_lat ELSE round(t.dropoff_lat, 2) END,
      'lng', CASE WHEN v_shown THEN t.dropoff_lng ELSE round(t.dropoff_lng, 2) END,
      'slot', NULL));
  END LOOP;
  v_plan := public.helpr_route_plan(v_stops, p_lat, p_lng, now());
  FOR p IN SELECT e FROM jsonb_array_elements(v_plan->'stops') e LOOP
    -- Re-read with the same ownership filter as the first loop (lh-authz-rls review #4).
    SELECT * INTO t FROM public.helpr_tasks
     WHERE id = (p->>'task')::uuid AND helpr_id = v_uid AND status IN ('accepted', 'picked_up');
    CONTINUE WHEN NOT FOUND;
    v_shows := public.helpr_task_dropoff_shows_at(v_uid, t.status, t.pickup_slot_start);
    v_shown := p->>'kind' = 'pickup' OR COALESCE(now() > v_shows, false);
    v_items := public.helpr_task_items(t.source_kind, t.source_id);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'seq', (p->>'seq')::integer,
      'task_id', t.id,
      'kind', p->>'kind',
      'status', t.status,
      'title', t.title,
      'size', t.size,
      'area', CASE WHEN p->>'kind' = 'pickup' THEN t.pickup_area ELSE t.dropoff_area END,
      'address', CASE WHEN p->>'kind' = 'pickup' THEN t.pickup_address WHEN v_shown THEN t.dropoff_address END,
      -- A drop-off not shown yet says when it will be (2 hours before the booked pickup).
      'address_shows_at', CASE WHEN NOT v_shown THEN v_shows END,
      -- Where the item is: at the seller's ('seller': porch or door, the seller never chose one for a Helpr pickup;
      -- an item's porch_ok defaults to true, so it is no choice), always the buyer's door at the drop-off.
      -- The point only where the address is shown (the in-app map pins it; Apple MapKit, never Google).
      'lat', CASE WHEN p->>'kind' = 'pickup' THEN t.pickup_lat WHEN v_shown THEN t.dropoff_lat END,
      'lng', CASE WHEN p->>'kind' = 'pickup' THEN t.pickup_lng WHEN v_shown THEN t.dropoff_lng END,
      'place', CASE WHEN p->>'kind' = 'dropoff' THEN 'door' ELSE 'seller' END,
      'items', (SELECT COALESCE(jsonb_agg(it - 'porch_ok'), '[]'::jsonb) FROM jsonb_array_elements(v_items) it),
      'slot_start', CASE WHEN p->>'kind' = 'pickup' THEN t.pickup_slot_start END,
      'slot_end', CASE WHEN p->>'kind' = 'pickup' THEN t.pickup_slot_start + interval '30 minutes' END,
      'arrive_at', p->'arrive_at',
      'late', (p->>'late')::boolean,
      'leg_miles', (p->>'leg_miles')::numeric));
  END LOOP;
  RETURN jsonb_build_object('stops', v_out, 'miles', v_plan->'miles', 'drive_minutes', v_plan->'drive_minutes',
                            'finish_at', v_plan->'finish_at');
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_my_route(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_my_route(numeric, numeric) TO authenticated, service_role;
