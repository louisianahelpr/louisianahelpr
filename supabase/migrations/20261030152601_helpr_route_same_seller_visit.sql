-- Audit 1c D3-2 (2026-10-29, 1c-h3-tab-p3-375): two deliveries from one seller sent the Helpr there twice, with a
-- drop-off in between.
--
-- 1. helpr_route_plan: restated from prod's pg_get_functiondef (2026-10-30, identical to 20261027194235) with only the
--    lines marked D3-2 added. Once at a pickup, another pickup from the SAME seller within 50 m (the accept card's own
--    rule, below) joins that visit when its Picked up is already open by then (helpr_task_picked_up: from 30 minutes
--    before the booked time, 20261030012018) or it has no booked time. A joined stop carries the same seq, leg 0 and no
--    extra minutes, and the screen shows one visit (routeVisits). A later pickup (more than 30 minutes after this visit)
--    stays its own stop: it could not be marked yet, and the booked time is the seller's. A stop with no seller on it
--    (helpr_route_suggestions' stops) never joins, so that plan is as it was.
--
-- 1b. helpr_my_route: restated from prod (md5 of the source a9264518, identical to 20261030012018). Passes each pickup's
--    seller to the plan (never returned) and returns handed_over_at, so the route stop knows Picked up is open.
--
-- 2. helpr_task_same_pickup_slot: on the accept card of an OPEN delivery, the time of the caller's own pickup at the
--    same seller and place, when the seller's times and this delivery's deadline allow it; so the second delivery can
--    be booked into the same visit. Same candidate filter as helpr_task_pickup_windows. Returns only a time, and only
--    when the caller already holds that seller's address: it tells them nothing new about where anyone lives.
--
-- Replay-safe: CREATE OR REPLACE only; grants by role name. Proof: src/test/pglite/helprRouteSameSellerVisit.pglite.mjs.
-- Guard: src/test/helprRouteSameSellerVisit.test.ts.

CREATE OR REPLACE FUNCTION public.helpr_route_plan(p_stops jsonb, p_lat numeric, p_lng numeric, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c_min_per_mile constant numeric := 2;   -- 30 mph
  c_stop_min constant numeric := 5;       -- at each stop
  v_left jsonb[] := ARRAY(SELECT e FROM jsonb_array_elements(COALESCE(p_stops, '[]'::jsonb)) e);
  v_out jsonb := '[]'::jsonb;
  v_lat numeric := p_lat;
  v_lng numeric := p_lng;
  v_t timestamptz := COALESCE(p_now, now());
  v_fixed jsonb;
  v_fixed_i integer;
  v_best jsonb;
  v_best_i integer;
  v_best_d numeric;
  v_s jsonb;
  v_d numeric;
  v_arrive timestamptz;
  v_slot timestamptz;
  v_late boolean;
  v_miles numeric := 0;
  v_minutes numeric := 0;
  v_seq integer := 0;
  i integer;
  v_at_pickup boolean := false;  -- D3-2: the visit just planned is a pickup
  v_visit timestamptz;           -- D3-2: when that visit happens
  v_join integer;                -- D3-2: a pickup that joins it
  v_seller text;                 -- D3-2: the seller of that visit
BEGIN
  WHILE COALESCE(array_length(v_left, 1), 0) > 0 LOOP
    -- D3-2: another pickup from this seller, within 50 m, joins this visit once its Picked up is open by then.
    v_join := NULL;
    IF v_at_pickup THEN
      FOR i IN 1 .. array_length(v_left, 1) LOOP
        v_s := v_left[i];
        IF v_s->>'kind' = 'pickup'
           AND v_s->>'seller' = v_seller
           AND public.helpr_task_distance_m(v_lat, v_lng, (v_s->>'lat')::numeric, (v_s->>'lng')::numeric) <= 50
           AND (v_s->>'slot' IS NULL OR (v_s->>'slot')::timestamptz - interval '30 minutes' <= v_visit) THEN
          v_join := i;
          EXIT;
        END IF;
      END LOOP;
    END IF;
    IF v_join IS NOT NULL THEN
      v_s := v_left[v_join];
      v_slot := (v_s->>'slot')::timestamptz;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'key', v_s->>'key', 'task', v_s->>'task', 'kind', v_s->>'kind', 'seq', v_seq,
        'leg_miles', 0, 'arrive_at', v_visit,
        'slot', v_slot, 'late', v_slot IS NOT NULL AND v_visit > v_slot + interval '30 minutes'));
      v_left := v_left[1:v_join - 1] || v_left[v_join + 1:];
      CONTINUE;
    END IF;
    -- The next booked pickup (earliest time).
    v_fixed := NULL; v_fixed_i := NULL;
    FOR i IN 1 .. array_length(v_left, 1) LOOP
      v_s := v_left[i];
      IF v_s->>'kind' = 'pickup' AND v_s->>'slot' IS NOT NULL
         AND (v_fixed IS NULL OR (v_s->>'slot')::timestamptz < (v_fixed->>'slot')::timestamptz) THEN
        v_fixed := v_s; v_fixed_i := i;
      END IF;
    END LOOP;
    -- The nearest other stop that is free to visit and still lets the Helpr make that pickup in time.
    v_best := NULL; v_best_i := NULL; v_best_d := NULL;
    FOR i IN 1 .. array_length(v_left, 1) LOOP
      v_s := v_left[i];
      CONTINUE WHEN v_s->>'kind' = 'pickup' AND v_s->>'slot' IS NOT NULL;
      -- A drop-off waits for its own pickup.
      CONTINUE WHEN v_s->>'kind' = 'dropoff' AND EXISTS (
        SELECT 1 FROM unnest(v_left) o WHERE o->>'kind' = 'pickup' AND o->>'task' = v_s->>'task');
      v_d := public.helpr_route_leg_miles(v_lat, v_lng, (v_s->>'lat')::numeric, (v_s->>'lng')::numeric);
      IF v_fixed IS NOT NULL AND v_t + make_interval(secs => (v_d * c_min_per_mile + c_stop_min
           + public.helpr_route_leg_miles((v_s->>'lat')::numeric, (v_s->>'lng')::numeric,
                                          (v_fixed->>'lat')::numeric, (v_fixed->>'lng')::numeric) * c_min_per_mile) * 60)
         > (v_fixed->>'slot')::timestamptz + interval '30 minutes' THEN
        CONTINUE;
      END IF;
      IF v_best_d IS NULL OR v_d < v_best_d THEN
        v_best := v_s; v_best_i := i; v_best_d := v_d;
      END IF;
    END LOOP;
    IF v_best IS NULL THEN
      v_best := v_fixed; v_best_i := v_fixed_i;
    END IF;
    EXIT WHEN v_best IS NULL;
    v_d := public.helpr_route_leg_miles(v_lat, v_lng, (v_best->>'lat')::numeric, (v_best->>'lng')::numeric);
    v_arrive := v_t + make_interval(secs => v_d * c_min_per_mile * 60);
    v_slot := CASE WHEN v_best->>'kind' = 'pickup' THEN (v_best->>'slot')::timestamptz END;
    v_late := v_slot IS NOT NULL AND v_arrive > v_slot + interval '30 minutes';
    v_t := greatest(v_arrive, COALESCE(v_slot, v_arrive)) + make_interval(mins => c_stop_min::integer);
    v_miles := v_miles + v_d;
    v_minutes := v_minutes + v_d * c_min_per_mile + c_stop_min;
    v_seq := v_seq + 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', v_best->>'key', 'task', v_best->>'task', 'kind', v_best->>'kind', 'seq', v_seq,
      'leg_miles', round(v_d, 1), 'arrive_at', greatest(v_arrive, COALESCE(v_slot, v_arrive)),
      'slot', v_slot, 'late', v_late));
    v_lat := (v_best->>'lat')::numeric;
    v_lng := (v_best->>'lng')::numeric;
    v_at_pickup := v_best->>'kind' = 'pickup';                     -- D3-2
    v_visit := greatest(v_arrive, COALESCE(v_slot, v_arrive));     -- D3-2
    v_seller := v_best->>'seller';                                 -- D3-2
    v_left := v_left[1:v_best_i - 1] || v_left[v_best_i + 1:];
  END LOOP;
  RETURN jsonb_build_object('stops', v_out, 'miles', round(v_miles, 1), 'drive_minutes', ceil(v_minutes)::integer,
                            'finish_at', CASE WHEN v_seq > 0 THEN v_t END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_route_plan(jsonb, numeric, numeric, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_route_plan(jsonb, numeric, numeric, timestamptz) TO service_role;

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
        'lat', t.pickup_lat, 'lng', t.pickup_lng, 'slot', t.pickup_slot_start,
        -- D3-2: for the plan only, never returned: pickups join one visit only at the same seller.
        'seller', t.pickup_contact_id));
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
      -- D3-2 follow-up: "Picked up" opens at once after the seller's "Handed over" to THIS Helpr (helpr_task_picked_up's own
      -- gate compares handed_over_to with the caller, so a handover from before a reopen does not count).
      'handed_over_at', CASE WHEN p->>'kind' = 'pickup' AND t.handed_over_to = v_uid THEN t.handed_over_at END,
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
     AND public.helpr_task_same_stripe_mode(v_uid, x.customer_id);
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
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
