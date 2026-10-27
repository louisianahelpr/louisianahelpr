-- MY ROUTE: every stop of a Helpr's deliveries in one ordered list (owner request 2026-10-27:
-- multi-stop Declutter delivery, "how they can see what they need to get, like routes, pick up
-- and drop off").
--
-- Before this, each delivery (helpr_tasks) was one card with one pickup and one drop-off, and a
-- Helpr holding two or three had to work out the order themselves. Two functions:
--
-- 1. helpr_route_plan(stops, lat, lng, now): the ordering, shared with the "On your way"
--    suggestions. A simple nearest-next walk that keeps two rules:
--      - a drop-off comes after its own pickup (it is not available while its pickup is left);
--      - a pickup with a booked 30-minute time is met in that time: a nearer stop is taken
--        first only if the Helpr can still reach the next booked pickup before its time ends,
--        and the Helpr waits for a booked time that has not started. A pickup with no time yet
--        (a suggestion) is just a nearer-next stop.
--    Distances are road miles the way declutter_road_miles estimates them (straight line x 1.3,
--    20261017055505 B60), unrounded so short legs are not each counted as a whole mile; drive
--    time is 2 minutes a road mile (30 mph) plus 5 minutes at each stop. No routing service is
--    called. Internal: service_role only.
--
-- 2. helpr_my_route(lat, lng): the caller's own deliveries in hand ('accepted', 'picked_up'),
--    as stops in that order, each with what the Helpr needs at it: Pick up / Drop off, the area,
--    the exact addresses as helpr_task_view shows them to the assigned Helpr (the pickup once the
--    delivery is theirs; the drop-off by helpr_task_dropoff_shows_at: owner decided 2026-10-27, issue
--    #3684: at once for a Helpr with a finished delivery, else 2 hours before the booked pickup or
--    after Picked up). A drop-off not shown yet is placed in the order from its point rounded to 2
--    decimals (~1 km, B72) and returns no address and no point, only when it will show; porch or door,
--    the items with their listing photos, the booked pickup time, the leg's road miles. Each
--    stop's point is returned for the in-app map (Apple MapKit JS, owner add-on 2026-10-27);
--    Open in Maps sends addresses, never points (src/lib/mapsLink.ts, owner: "stop sending
--    coordinates to Google").
--    No pay, fee or money field (members never see fee numbers, owner 2026-10-25).
--
-- Replay-safe: CREATE OR REPLACE only; grants by role name (REVOKE ... FROM PUBLIC, anon).
-- Proof: src/test/pglite/helprMyRoute.pglite.mjs (3x replay). Guard: src/test/helprMyRoute.test.ts.

-- Unrounded road miles between two points (declutter_road_miles' estimate, before its ceil).
CREATE OR REPLACE FUNCTION public.helpr_route_leg_miles(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN 0
              ELSE public.helpr_task_distance_m(p_lat1, p_lng1, p_lat2, p_lng2) / 1609.344 * 1.3 END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_route_leg_miles(numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_route_leg_miles(numeric, numeric, numeric, numeric) TO service_role;

-- The ordering. p_stops: [{key, task, kind: 'pickup'|'dropoff', lat, lng, slot (pickup, may be null)}].
-- Returns {stops: [{key, task, kind, seq, leg_miles, arrive_at, slot, late}], miles, drive_minutes, finish_at}.
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
BEGIN
  WHILE COALESCE(array_length(v_left, 1), 0) > 0 LOOP
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
    v_left := v_left[1:v_best_i - 1] || v_left[v_best_i + 1:];
  END LOOP;
  RETURN jsonb_build_object('stops', v_out, 'miles', round(v_miles, 1), 'drive_minutes', ceil(v_minutes)::integer,
                            'finish_at', CASE WHEN v_seq > 0 THEN v_t END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_route_plan(jsonb, numeric, numeric, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_route_plan(jsonb, numeric, numeric, timestamptz) TO service_role;

-- The items of a task, with each item's first listing photo (the public listing bucket), for the stop card.
-- Not SECURITY DEFINER: it has no caller check of its own and is only read inside helpr_my_route, which
-- runs as the owner and has already limited the tasks to the caller's own (lh-authz-rls review #3).
-- An item an admin removed keeps its title but loses its photo.
CREATE OR REPLACE FUNCTION public.helpr_task_items(p_kind text, p_source uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'title', i.title,
             'photo_path', CASE WHEN i.status <> 'removed' THEN (SELECT ph.storage_path FROM public.declutter_item_photos ph
                             WHERE ph.item_id = i.id ORDER BY ph.position LIMIT 1) END,
             'porch_ok', i.porch_ok) ORDER BY c.id)
      FROM public.declutter_cart_items c
      JOIN public.declutter_items i ON i.id = c.item_id
     WHERE p_kind = 'declutter_delivery' AND c.order_id = p_source), '[]'::jsonb);
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_items(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_items(text, uuid) TO service_role;

-- When the assigned Helpr may read a taken delivery's drop-off (owner decided 2026-10-27, issue #3684):
-- once they have picked the item up; or at once for a Helpr with at least one finished (confirmed)
-- delivery; or, for a brand-new Helpr, from just after 2 hours before the booked pickup (strictly after:
-- at exactly 2 hours a back-out is still strike-free in helpr_task_release, so the address must not show
-- yet; lh-authz-rls re-review #3). '-infinity' = shown now
-- whatever the clock; NULL = never (not active, no Helpr, no slot): a deny on NULL. One rule, read by
-- helpr_task_view (20261027201327) and helpr_my_route. Not SECURITY DEFINER; service role only (it is
-- read inside those two, which already limit the task to its own Helpr).
CREATE OR REPLACE FUNCTION public.helpr_task_dropoff_shows_at(p_helpr uuid, p_status text, p_slot timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_helpr IS NULL OR p_status IS NULL THEN NULL
    WHEN p_status IN ('picked_up', 'delivered') THEN '-infinity'::timestamptz
    WHEN p_status <> 'accepted' THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.helpr_tasks x WHERE x.helpr_id = p_helpr AND x.status = 'confirmed') THEN '-infinity'::timestamptz
    ELSE p_slot - interval '2 hours' END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_dropoff_shows_at(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_dropoff_shows_at(uuid, text, timestamptz) TO service_role;

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
    v_porch := jsonb_array_length(v_items) > 0
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) it WHERE NOT COALESCE((it->>'porch_ok')::boolean, false));
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
      -- Where the item is: porch (every item may be left out) or the seller's door; always the buyer's door at the drop-off.
      -- The point only where the address is shown (the in-app map pins it; Apple MapKit, never Google).
      'lat', CASE WHEN p->>'kind' = 'pickup' THEN t.pickup_lat WHEN v_shown THEN t.dropoff_lat END,
      'lng', CASE WHEN p->>'kind' = 'pickup' THEN t.pickup_lng WHEN v_shown THEN t.dropoff_lng END,
      'place', CASE WHEN p->>'kind' = 'dropoff' THEN 'door' WHEN v_porch THEN 'porch' ELSE 'door' END,
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
