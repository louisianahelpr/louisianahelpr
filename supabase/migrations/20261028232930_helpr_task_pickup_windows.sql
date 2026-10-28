-- A Helpr choosing a pickup time for an open delivery sees the seller's pickup times (lead 2026-10-28, after
-- builder 2's day + time chips for the buyer, b2-pickup-times / 149028fbd9).
--
-- WHY: the Helpr's "Accept delivery" picker was a free time; helpr_task_accept refuses any time outside the
-- seller's pickup windows (helpr_task_source_slot_ok -> declutter_delivery_slot_ok -> declutter_slot_in_windows)
-- or past the deadline, but the Helpr could not read those windows (declutter_pickup_windows: the seller reads
-- their own only; declutter_order_pickup_windows answers the assigned Helpr only, after the accept).
--
-- WHAT THIS ADDS: helpr_task_pickup_windows(p_task_id) -> (weekday, starts, ends, latest_pickup_at), the order's
-- seller's windows and the latest a 30-minute pickup may END, for an OPEN declutter_delivery task, to exactly the
-- member helpr_tasks_open_near would show it to: the Declutter switch (helpr_task_source_require_feature) and a
-- Helpr who may take deliveries (helpr_task_assert_helpr), not the task's buyer or seller, not blocked by either,
-- the same Stripe mode, a vehicle that fits, the task open and not closed. Anyone else gets task_not_found (no
-- oracle on whether the task exists). latest_pickup_at is LEAST(the task's latest pickup, the order's 7-day
-- deadline): both bounds helpr_task_accept checks, so every slot offered from it is one the accept takes. No
-- address, no seller id. STABLE SECURITY DEFINER, search_path pinned; REVOKE FROM PUBLIC, anon.
-- REPLAY-SAFETY: CREATE OR REPLACE (a new function).
-- Proof: src/test/pglite/helprTaskPickupWindows.pglite.mjs. Guard: src/test/helprTaskPickupWindows.test.ts.

CREATE OR REPLACE FUNCTION public.helpr_task_pickup_windows(p_task_id uuid)
RETURNS TABLE(weekday smallint, starts time, ends time, latest_pickup_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  t public.helpr_tasks;
  o public.declutter_orders;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  -- helpr_tasks_open_near's own filter, for this one task.
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
  RETURN QUERY
    SELECT w.weekday, w.starts_local, w.ends_local, LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')
      FROM public.declutter_pickup_windows w
     WHERE w.seller_id = o.seller_id
     ORDER BY w.weekday, w.starts_local;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_pickup_windows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_pickup_windows(uuid) TO authenticated, service_role;
