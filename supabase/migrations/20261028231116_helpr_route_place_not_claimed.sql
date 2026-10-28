-- The Helpr's route never says a pickup is "On the seller's porch" when the seller never chose the porch
-- (Declutter audit 2, 2026-10-28: D2-1 / A2-12; lead decision (a) 2026-10-28).
--
-- WHAT WAS WRONG: helpr_my_route said 'place' = 'porch' for a pickup when every item had porch_ok. porch_ok is the
-- item's "may be left on the porch" flag and defaults to true (20261017055504), so it is not a choice, and nothing
-- records a porch-or-door choice for a Helpr pickup (no column on declutter_order_deliveries or helpr_tasks).
-- The route card then read "On the seller's porch" for a seller who never chose it.
--
-- WHAT THIS DOES: a pickup stop's 'place' is 'seller' (at the seller's: porch or door, not chosen); a drop-off
-- stays 'door'. The client reads 'seller' as "At the seller's door, or on the porch if they leave it out".
-- Restated from its EFFECTIVE definition (20261027194235_helpr_my_route.sql; equal to prod's pg_get_functiondef body, read 2026-10-28)
-- with only those lines changed; grants as on prod.
-- REPLAY-SAFETY: CREATE OR REPLACE. Guard: src/test/helprRouteClaimsNoPorch.test.ts.

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
