-- BUY-41 follow-up (lander 41, 10-31). 20261031082821 gave helpr_task_pickup_windows the two filters
-- helpr_tasks_open_near got in 20261031075157 (never a delivery this Helpr released or missed, never one whose
-- sale is held by an open problem). helpr_task_same_pickup_slot (20261030152601) runs "helpr_task_pickup_windows'
-- own filter, for this one task" (src/test/helprRouteSameSellerVisit.test.ts holds the two filters equal), so it
-- still answered the accept card's time for a delivery the list no longer shows.
-- Restated verbatim from 20261030152601 with the same two filters added (nothing else changed).
-- Grants unchanged. Replay-safe: CREATE OR REPLACE; REVOKE/GRANT are idempotent; reads only objects that exist
-- before this timestamp (helpr_task_events, helpr_task_source_held).

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
