-- Audit 1c D3-2 (2026-10-29, 1c-h3-tab-p3-375): two deliveries from one seller sent the Helpr there twice, with a
-- drop-off in between.
--
-- 1. helpr_route_plan: restated from prod's pg_get_functiondef (2026-10-30, identical to 20261027194235) with only the
--    lines marked D3-2 added. Once at a pickup, another pickup at the SAME point joins that visit when its Picked up
--    is already open by then (helpr_task_picked_up: from 30 minutes before the booked time, 20261030012018) or it has
--    no booked time. A joined stop carries the same seq, leg 0 and no extra minutes, so helpr_my_route passes it
--    through unchanged and the screen shows one visit (routeVisits). A later pickup (more than 30 minutes after this
--    visit) stays its own stop: it could not be marked yet, and the booked time is the seller's.
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
BEGIN
  WHILE COALESCE(array_length(v_left, 1), 0) > 0 LOOP
    -- D3-2: another pickup at this same point joins this visit once its Picked up is open by then.
    v_join := NULL;
    IF v_at_pickup THEN
      FOR i IN 1 .. array_length(v_left, 1) LOOP
        v_s := v_left[i];
        IF v_s->>'kind' = 'pickup'
           AND (v_s->>'lat')::numeric = v_lat AND (v_s->>'lng')::numeric = v_lng
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
    v_left := v_left[1:v_best_i - 1] || v_left[v_best_i + 1:];
  END LOOP;
  RETURN jsonb_build_object('stops', v_out, 'miles', round(v_miles, 1), 'drive_minutes', ceil(v_minutes)::integer,
                            'finish_at', CASE WHEN v_seq > 0 THEN v_t END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_route_plan(jsonb, numeric, numeric, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_route_plan(jsonb, numeric, numeric, timestamptz) TO service_role;

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
