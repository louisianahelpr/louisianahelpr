-- LEAD-MOVE-BACKOUT (lead decision 10-31, after BUY-42): once the seller has moved a Helpr's pickup time
-- (helpr_task_seller_move_pickup, 20261031095846), the booked time is no longer the one the Helpr chose. A Helpr who
-- then backed out got a delivery strike under 2 hours before the pickup, and the back-out counted toward the
-- "3 back-outs or misses in 7 days" pause. Lead decision: no strike, and it does not count toward the pause.
-- (For verdict.)
--
--   * helpr_task_release (from its only CREATE, 20261017055505): a 'pickup_moved' event by the seller
--     (pickup_contact_id) since this Helpr's accepted_at means no strike; the 'released' event is logged with detail
--     'seller_moved'. It stays a 'released' event, so every "hide the delivery you backed out of" filter still hides it.
--   * helpr_task_accept (from its newest CREATE, 20261028012406) and helpr_route_suggestions (from its newest CREATE,
--     20261027200024): the 3-in-7-days count skips 'seller_moved' releases. No other line of either changes.
-- Checked for newer restatements on wip/b75-1031, wip/b76-1031 and open PR land/l43-next-ea305f7d: none.
-- Replay-safe: CREATE OR REPLACE only; grants by role name as before.
-- Proof: src/test/pglite/helprBackoutAfterSellerMove.pglite.mjs (3x; NEW_MIGRATION=skip is red).

CREATE OR REPLACE FUNCTION public.helpr_task_release(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_late boolean;
  v_moved boolean;
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
  IF t.status = 'accepted' AND public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    -- A problem is open on this sale: the task stays as it is until an admin decides.
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF t.status <> 'accepted' THEN
    RAISE EXCEPTION 'already_picked_up' USING ERRCODE = '55000',
      HINT = 'You already have the item. Deliver it, or report a problem.';
  END IF;
  -- The seller moved this booking's pickup (helpr_task_seller_move_pickup): backing out costs nothing (lead 10-31).
  v_moved := EXISTS (SELECT 1 FROM public.helpr_task_events e
                      WHERE e.task_id = t.id AND e.task_event = 'pickup_moved' AND e.actor_id = t.pickup_contact_id
                        AND e.created_at >= t.accepted_at);
  v_late := NOT v_moved AND now() > t.pickup_slot_start - interval '2 hours';
  PERFORM public.helpr_task_reopen(t.id, 'released', v_uid,
    CASE WHEN v_moved THEN 'seller_moved' WHEN v_late THEN 'late' END);
  IF v_late THEN
    PERFORM public.helpr_task_give_job_strike(v_uid, 'delivery_backed_out', t.id,
      'Backed out of a Helpr delivery less than 2 hours before the pickup time');
  END IF;
  RETURN jsonb_build_object('result', 'released', 'strike', v_late);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_release(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_release(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_accept(p_task_id uuid, p_pickup_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  t public.helpr_tasks;
  v_reason text;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.helpr_task_source_require_feature(t.source_kind);
  v_uid := public.helpr_task_assert_helpr();
  -- ID once (owner 2026-10-20): taking a delivery is the Helpr's accept, so it
  -- reads the one helper every accept reads. helpr_task_assert_helpr already
  -- refused an unready payout account, so what is left here is the ID.
  v_reason := public.helper_accept_block_reason(v_uid);
  IF v_reason = 'helper_identity_unverified' THEN
    RAISE EXCEPTION 'helper_identity_unverified' USING ERRCODE = '42501',
      HINT = 'Verify your ID to accept a delivery. You only do it once.';
  ELSIF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'payout_setup_incomplete' USING ERRCODE = '42501',
      HINT = 'Set up payouts in Settings before you take a delivery.';
  END IF;
  IF v_uid IN (t.customer_id, t.pickup_contact_id) THEN
    RAISE EXCEPTION 'own_task' USING ERRCODE = '42501', HINT = 'You cannot deliver your own sale.';
  END IF;
  IF public.are_users_blocked(v_uid, t.customer_id) OR public.are_users_blocked(v_uid, t.pickup_contact_id)
     OR NOT public.helpr_task_same_stripe_mode(v_uid, t.customer_id) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- 20261028012406 (lh-authz-rls review nit 1): the vehicle row stays as read until this
  -- take commits, so helpr_set_vehicle cannot drop what this delivery needs meanwhile.
  PERFORM 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid FOR SHARE;
  IF NOT public.helpr_task_vehicle_fits(v_uid, t.size) THEN
    -- 20261028012406 (Q2452, owner 2026-10-28): every delivery needs a car.
    IF NOT EXISTS (SELECT 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid AND v.has_car) THEN
      RAISE EXCEPTION 'vehicle_needs_car' USING ERRCODE = '42501',
        HINT = 'Add your car under Your vehicle to take deliveries.';
    END IF;
    RAISE EXCEPTION 'vehicle_too_small' USING ERRCODE = '42501',
      HINT = 'This item needs a truck (and a second person for extra large). Add your truck under Your vehicle.';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.status <> 'open' OR t.open_until <= now() THEN
    RAISE EXCEPTION 'task_taken' USING ERRCODE = '55000', HINT = 'Another Helpr took this delivery, or it closed.';
  END IF;
  -- Taking a delivery shows its pickup address, so taking and backing out must
  -- not be a way to collect addresses (lh-authz-rls review #4, 2026-10-16): a
  -- Helpr never takes back a delivery they backed out of or missed, and three
  -- back-outs or misses in 7 days pause taking new ones for the rest of that week.
  IF EXISTS (SELECT 1 FROM public.helpr_task_events e
              WHERE e.task_id = t.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show')) THEN
    RAISE EXCEPTION 'task_taken' USING ERRCODE = '55000', HINT = 'Another Helpr took this delivery, or it closed.';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  -- At most 2 deliveries taken and not yet picked up at a time, so a Helpr
  -- cannot take every nearby delivery at once to read the addresses
  -- (lh-authz-rls re-review #1, 2026-10-16).
  IF (SELECT count(*) FROM public.helpr_tasks x WHERE x.helpr_id = v_uid AND x.status = 'accepted') >= 2 THEN
    RAISE EXCEPTION 'too_many_taken' USING ERRCODE = '55000',
      HINT = 'Pick up one of your deliveries before you take another.';
  END IF;
  IF (SELECT count(*) FROM public.helpr_task_events e
       WHERE e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show')
         AND e.detail IS DISTINCT FROM 'seller_moved'
         AND e.created_at > now() - interval '7 days') >= 3 THEN
    RAISE EXCEPTION 'too_many_releases' USING ERRCODE = '55000',
      HINT = 'You backed out of or missed 3 deliveries this week. You can take new ones again in a few days.';
  END IF;
  IF p_pickup_slot_start IS NULL OR p_pickup_slot_start <= now()
     OR p_pickup_slot_start + interval '30 minutes' > t.latest_pickup_at
     OR NOT public.helpr_task_source_slot_ok(t.source_kind, t.source_id, p_pickup_slot_start) THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
      HINT = 'Pick a time in the future, inside the seller''s pickup times.';
  END IF;
  UPDATE public.helpr_tasks
     SET status = 'accepted', helpr_id = v_uid, accepted_at = now(), pickup_slot_start = p_pickup_slot_start, updated_at = now()
   WHERE id = t.id AND status = 'open';
  PERFORM public.helpr_task_log(t.id, 'accepted', v_uid, to_char(p_pickup_slot_start, 'YYYY-MM-DD"T"HH24:MI:SSOF'));
  PERFORM public.helpr_task_source_event(t.id, 'accepted', NULL);
  RETURN jsonb_build_object('result', 'accepted', 'pickup_slot_start', p_pickup_slot_start);
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_accept(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_accept(uuid, timestamptz) TO authenticated, service_role;

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
         AND e.detail IS DISTINCT FROM 'seller_moved'
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
