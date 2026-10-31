-- BUY-41 follow-up (lead 10-31). 20261031075157 taught helpr_tasks_open_near two filters: never a delivery this
-- Helpr released or missed (helpr_no_show), and never one whose sale is held by an open problem
-- (helpr_task_source_held); helpr_task_accept already refuses both. Its two siblings did not get them:
--   - helpr_tasks_open_count (20261030044539), Deliver's "3 deliveries are waiting" count, must be the listing read
--     minus ONLY the vehicle fit, so it counted deliveries the list no longer shows;
--   - helpr_task_pickup_windows (20261028232930) must answer exactly where the list shows the task, so it still gave
--     the seller's pickup times for a delivery the Helpr can't take.
-- Both are restated verbatim from those migrations with the same two filters added (nothing else changed).
-- Grants unchanged. Replay-safe: CREATE OR REPLACE; COMMENT/REVOKE/GRANT are idempotent.

CREATE OR REPLACE FUNCTION public.helpr_tasks_open_count()
RETURNS TABLE(pickup_area text, open_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  RETURN QUERY
  SELECT t.pickup_area, count(*)::integer
    FROM public.helpr_tasks t
   WHERE t.status = 'open' AND t.open_until > now()
     AND v_uid IS DISTINCT FROM t.customer_id AND v_uid IS DISTINCT FROM t.pickup_contact_id
     AND NOT public.are_users_blocked(v_uid, t.customer_id)
     AND NOT public.are_users_blocked(v_uid, t.pickup_contact_id)
     AND public.helpr_task_same_stripe_mode(v_uid, t.customer_id)
     -- BUY-41 (new): as helpr_tasks_open_near, never one this Helpr backed out of or missed ...
     AND NOT EXISTS (SELECT 1 FROM public.helpr_task_events e
                      WHERE e.task_id = t.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show'))
     -- ... and never one whose sale is held by an open problem.
     AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)
   GROUP BY t.pickup_area
   ORDER BY count(*) DESC, t.pickup_area;
END;
$fn$;
COMMENT ON FUNCTION public.helpr_tasks_open_count() IS
  'Open Declutter deliveries the caller could take with the right vehicle, counted by pickup area (no addresses). Same filters as helpr_tasks_open_near minus the vehicle fit (audit 1c D3-6).';
REVOKE ALL ON FUNCTION public.helpr_tasks_open_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_tasks_open_count() TO authenticated, service_role;

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
  RETURN QUERY
    SELECT w.weekday, w.starts_local, w.ends_local, LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')
      FROM public.declutter_pickup_windows w
     WHERE w.seller_id = o.seller_id
     ORDER BY w.weekday, w.starts_local;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_pickup_windows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_pickup_windows(uuid) TO authenticated, service_role;
