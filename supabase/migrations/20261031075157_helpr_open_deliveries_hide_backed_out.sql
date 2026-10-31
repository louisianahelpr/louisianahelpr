-- BUY-41 (buying audit 10-30 #41): a delivery a Helpr backed out of or missed stayed in their "Deliveries near you",
-- and taking it then said "Another Helpr took this delivery, or it closed." (helpr_task_accept refuses a Helpr's own
-- released / helpr_no_show task, and any task whose sale has an open problem: problem_open). The list now leaves out
-- exactly what accept refuses on those two counts, so it never offers a delivery the Helpr can't take.
--
-- helpr_tasks_open_near restated verbatim from 20261021181118_helpr_delivery_payout_round_down.sql (the newest CREATE
-- in the repo); only the two marked conditions are new. Same signature, same grants.
-- Replay-safe: CREATE OR REPLACE; REVOKE/GRANT are idempotent.

CREATE OR REPLACE FUNCTION public.helpr_tasks_open_near(p_lat numeric, p_lng numeric, p_limit integer)
RETURNS TABLE (task_id uuid, source_kind text, size text, title text, pickup_area text, dropoff_area text,
               trip_miles integer, miles_to_pickup integer, take_home_cents integer, open_until timestamptz,
               latest_pickup_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng IS NULL OR p_lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT t.id, t.source_kind, t.size, t.title, t.pickup_area, t.dropoff_area, t.trip_miles,
         CASE WHEN p_lat IS NULL THEN NULL
              ELSE greatest(1, ceil(public.helpr_task_distance_m(p_lat, p_lng, round(t.pickup_lat, 2), round(t.pickup_lng, 2)) / 1609.344))::integer END,
         public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents), t.open_until, t.latest_pickup_at
    FROM public.helpr_tasks t
   WHERE t.status = 'open' AND t.open_until > now()
     AND v_uid IS DISTINCT FROM t.customer_id AND v_uid IS DISTINCT FROM t.pickup_contact_id
     AND public.helpr_task_vehicle_fits(v_uid, t.size)
     AND NOT public.are_users_blocked(v_uid, t.customer_id)
     AND NOT public.are_users_blocked(v_uid, t.pickup_contact_id)
     AND public.helpr_task_same_stripe_mode(v_uid, t.customer_id)
     -- BUY-41 (new): never one this Helpr backed out of or missed (helpr_task_accept refuses it: task_taken) ...
     AND NOT EXISTS (SELECT 1 FROM public.helpr_task_events e
                      WHERE e.task_id = t.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show'))
     -- ... and never one whose sale is held by an open problem (refused: problem_open).
     AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)
   ORDER BY CASE WHEN p_lat IS NULL THEN 0 ELSE public.helpr_task_distance_m(p_lat, p_lng, round(t.pickup_lat, 2), round(t.pickup_lng, 2)) END, t.open_until
   LIMIT least(greatest(COALESCE(p_limit, 50), 1), 100);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_tasks_open_near(numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_tasks_open_near(numeric, numeric, integer) TO authenticated, service_role;
