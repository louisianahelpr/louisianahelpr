-- "ON YOUR WAY": open deliveries that add little to a Helpr's route (owner request 2026-10-27,
-- multi-stop Declutter delivery, part 3). When a Helpr views an open delivery or has taken some,
-- suggest up to 3 more whose pickup and drop-off add little detour, as "+$X pay, about N extra
-- minutes", each taken with one tap through the existing accept path (helpr_task_accept, with the
-- pickup time suggested here).
--
-- helpr_route_suggestions(p_with_task):
--   - who: helpr_task_assert_helpr() (the gate every delivery RPC uses), behind the member switch;
--     nothing for a Helpr helpr_task_accept would pause (3 back-outs or misses in 7 days);
--   - the route: the caller's own deliveries in hand, each drop-off at its exact point only once it is
--     the caller's to read (helpr_task_dropoff_shows_at, owner decision #3684), else at its ~1 km point
--     as helpr_my_route places it (lh-authz-rls re-review of #3684, #2), plus p_with_task when given: an open delivery the caller may see (the same checks
--     as helpr_task_view's candidate branch, else task_not_found). The route starts at its first
--     stop: the caller's position is NOT an input (lh-authz-rls review of this file, #1: a
--     caller-chosen start moved the arrival time, and the bounded-by-nothing slot search then traced
--     a seller's private pickup windows over a sweep of calls);
--   - the candidates: exactly the deliveries helpr_tasks_open_near would list for the caller, minus
--     the ones helpr_task_accept would refuse anyway (one the caller backed out of or missed, an
--     open problem, no pickup time left), within 25 straight miles of a route stop, the 30 nearest;
--   - the cost: cheapest insertion into the route as helpr_route_plan orders it. The candidate's
--     pickup (at its 2-decimal point, ~1 km, B72) and drop-off (at its 1-decimal point, ~11 km: a
--     Helpr who has not taken a delivery never learns its drop-off cell, review #2) are tried at every pair of
--     positions; an insertion that makes a booked pickup late is not allowed; the extra drive
--     minutes (helpr_route_cost: 2 a road mile + 5 a stop) of the cheapest one is the detour. A
--     full re-plan was tried first and measured wrong in the PGlite proof: nearest-next went to
--     the new drop-off and back while waiting for a booked pickup, scoring a 10-minute detour as
--     46. Up to 3 that add at most 30 minutes, fewest first, reported as whole extra miles and
--     extra minutes in 5-minute steps;
--   - the pickup time: the first 30-minute time, on the quarter hour, from when the plan reaches the
--     pickup to 3 hours after it (13 checks at most), inside the seller's pickup times
--     (helpr_task_source_slot_ok) and the deadline; a delivery with no such time is not suggested.
--   - nothing when the caller would hold 2 deliveries not yet picked up (helpr_task_accept's
--     too_many_taken cap), with reason 'too_many_taken'; 'no_route' when there is no route.
-- Returned per suggestion: area words, rough trip miles, the take-home pay (the figure Deliver for
-- pay already shows; never the fee), extra minutes and miles, the suggested pickup time. Never an
-- address, a point or an exact distance of a delivery the caller has not taken.
--
-- Replay-safe: CREATE OR REPLACE; grants by role name (REVOKE ... FROM PUBLIC, anon).
-- Proof: src/test/pglite/helprRouteSuggestions.pglite.mjs (3x replay). Guard:
-- src/test/helprRouteSuggestions.test.ts.

-- The cost of visiting stops in exactly the given order (no reordering), timed as helpr_route_plan
-- times them: road miles, drive minutes (2 a mile + 5 a stop, unrounded), how many booked pickups
-- are reached after their 30 minutes, and each stop's arrival. Internal: service_role only.
CREATE OR REPLACE FUNCTION public.helpr_route_cost(p_seq jsonb, p_lat numeric, p_lng numeric, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_lat numeric := p_lat;
  v_lng numeric := p_lng;
  v_t timestamptz := p_now;
  v_miles numeric := 0;
  v_minutes numeric := 0;
  v_late integer := 0;
  v_arrive_all jsonb := '{}'::jsonb;
  s jsonb;
  v_d numeric;
  v_arrive timestamptz;
  v_slot timestamptz;
BEGIN
  FOR s IN SELECT e FROM jsonb_array_elements(COALESCE(p_seq, '[]'::jsonb)) WITH ORDINALITY AS q(e, o) ORDER BY o LOOP
    v_d := public.helpr_route_leg_miles(v_lat, v_lng, (s->>'lat')::numeric, (s->>'lng')::numeric);
    v_arrive := v_t + make_interval(secs => v_d * 2 * 60);
    v_slot := CASE WHEN s->>'kind' = 'pickup' THEN (s->>'slot')::timestamptz END;
    IF v_slot IS NOT NULL AND v_arrive > v_slot + interval '30 minutes' THEN v_late := v_late + 1; END IF;
    v_t := greatest(v_arrive, COALESCE(v_slot, v_arrive)) + interval '5 minutes';
    v_arrive_all := v_arrive_all || jsonb_build_object(s->>'key', greatest(v_arrive, COALESCE(v_slot, v_arrive)));
    v_miles := v_miles + v_d;
    v_minutes := v_minutes + v_d * 2 + 5;
    v_lat := (s->>'lat')::numeric;
    v_lng := (s->>'lng')::numeric;
  END LOOP;
  RETURN jsonb_build_object('miles', v_miles, 'drive_minutes', v_minutes, 'late', v_late, 'arrive', v_arrive_all);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_route_cost(jsonb, numeric, numeric, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_route_cost(jsonb, numeric, numeric, timestamptz) TO service_role;

-- An earlier draft took the caller's position; it never reached main, but drop it if a copy exists anywhere.
DROP FUNCTION IF EXISTS public.helpr_route_suggestions(uuid, numeric, numeric);

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
      RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
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
