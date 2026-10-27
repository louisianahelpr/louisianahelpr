-- WHEN THE DELIVERY HELPR READS THE BUYER'S DROP-OFF ADDRESS (owner decided 2026-10-27, issue #3684,
-- recommended option: "A Helpr with at least one finished delivery sees the drop-off on accept. A
-- brand-new Helpr (no finished delivery yet) sees it 2 h before the booked pickup, or once their first
-- delivery is done, whichever comes first." It first read "as soon as they ACCEPT" for everyone; the
-- review of that found throwaway accounts could take and back out to collect buyers' addresses).
--
-- Before: helpr_task_view showed the assigned Helpr the pickup address while the task was active
-- ('accepted', 'picked_up', 'delivered') but the drop-off address and point only from 'picked_up'
-- (spec row 27 note, B72). That kept a taken delivery's last stop out of My route's map and Open in
-- Maps until the item was in the car.
--
-- Now (owner decided issue #3684 the same day, recommended option): the assigned Helpr reads the
-- drop-off address and point at once if they have at least one finished delivery; a brand-new Helpr
-- reads it from 2 hours before the booked pickup, or once their first delivery is finished, or after
-- Picked up, whichever comes first (helpr_task_dropoff_shows_at, 20261027194235). A throwaway account
-- that takes and backs out more than 2 hours ahead therefore never reads a buyer's address, and backing
-- out inside those 2 hours already costs a delivery strike (helpr_task_release). Unchanged: a candidate (an eligible Helpr looking at an OPEN task), the
-- buyer and the seller read no address through the task; open deliveries and "On your way" keep area
-- words and rough miles; a Helpr who backs out loses both addresses with the task (it reopens, they
-- are no longer helpr_id); helpr_task_accept still holds a Helpr to 2 deliveries not yet picked up
-- and never gives one back to a Helpr who backed out of it, so taking and releasing still cannot be
-- used to collect addresses faster than before (the drop-off now comes with the pickup on the same
-- accept). helpr_my_route (20261027194235) reveals the drop-off on the same rule.
--
-- helpr_task_view restated from its newest definition, 20261021181118_helpr_delivery_payout_round_down
-- (no later migration redefines it), with only the three drop-off CASEs changed. Replay-safe: CREATE
-- OR REPLACE; grants restated (REVOKE ... FROM PUBLIC, anon). Proof:
-- src/test/pglite/helprMyRoute.pglite.mjs (the view: an accepted Helpr reads it, a candidate, the
-- buyer and the seller do not). Guard: src/test/helprMyRoute.test.ts.

-- helpr_task_view: restated from 20261021181118_helpr_delivery_payout_round_down.sql; the drop-off shows to the assigned Helpr by helpr_task_dropoff_shows_at.
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
    'dropoff_photo_path', CASE WHEN v_role <> 'candidate' THEN t.dropoff_photo_path END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_view(uuid) TO authenticated, service_role;
