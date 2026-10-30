-- Audit 1c D3-6 (Builder 75, 2026-10-30): how many deliveries are open, for a Helpr who has no car yet.
--
-- What was wrong: Deliver's only read of open deliveries is helpr_tasks_open_near, which keeps only the
-- tasks the caller's vehicle fits (helpr_task_vehicle_fits). A Helpr with no car saved reads zero rows, so
-- the page could not say "3 deliveries are waiting. Add your car to take them." and the "Busy right now"
-- card had nothing to count.
--
-- The fix: public.helpr_tasks_open_count(), counts only, by pickup AREA (the same area words
-- helpr_tasks_open_near already shows to every Helpr whose vehicle fits; never an address or a point).
-- Same gates and filters as helpr_tasks_open_near (effective prod definition read 2026-10-30 with
-- pg_get_functiondef: 20261021181118), minus ONLY the vehicle fit:
--   - helpr_task_source_require_feature('declutter_delivery') and helpr_task_assert_helpr() (signed in, not
--     banned, 18+, under the strike limit, payout setup when required);
--   - open and not past open_until; not the caller's own sale or purchase; nobody blocked either way;
--   - helpr_task_same_stripe_mode: test accounts and real members never count each other's tasks, so test
--     data never counts for a real member (owner rule).
-- Nothing is written. Replay-safe: CREATE OR REPLACE; grants re-stated.

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
   GROUP BY t.pickup_area
   ORDER BY count(*) DESC, t.pickup_area;
END;
$fn$;
COMMENT ON FUNCTION public.helpr_tasks_open_count() IS
  'Open Declutter deliveries the caller could take with the right vehicle, counted by pickup area (no addresses). Same filters as helpr_tasks_open_near minus the vehicle fit (audit 1c D3-6).';
REVOKE ALL ON FUNCTION public.helpr_tasks_open_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_tasks_open_count() TO authenticated, service_role;
