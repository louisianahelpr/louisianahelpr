-- AUD31-27 (the date part): a Helpr's finished deliveries on Declutter > Deliver ("Delivered and paid.", "Closed.",
-- "Decided as damaged in delivery. Not paid.") carried no date, so a Helpr with several could not tell which was which
-- or when each ended. helpr_my_tasks() returned no time the task ended.
--
-- Fix: helpr_my_tasks() gains one column, ended_at: for a finished task (confirmed, unfilled, cancelled, failed) the
-- time it ended, COALESCE(confirmed_at, closed_at, updated_at); NULL while the task is open or under way. Everything
-- else is the newest body unchanged (20261021181118_helpr_delivery_payout_round_down, the only CREATE since
-- 20261017055505; same on origin/main): the caller's own tasks only, the same 30-day window, order and limit, and the
-- same take-home (helpr_payout_round_down_cents). It reads only the caller's rows, as before.
--
-- A RETURNS TABLE shape cannot change under CREATE OR REPLACE, so the function is dropped and created again in this
-- one transaction, with its grants restated (REVOKE ... FROM PUBLIC, anon; authenticated + service_role). An app
-- that does not know the column yet ignores it; the new app shows the date only when the column is there.
--
-- REPLAY-SAFETY: DROP FUNCTION IF EXISTS + CREATE, run 3x in PGlite (src/test/pglite/helprMyTasksEndedAt.pglite.mjs).
-- No later migration defines helpr_my_tasks.

DROP FUNCTION IF EXISTS public.helpr_my_tasks();

CREATE FUNCTION public.helpr_my_tasks()
RETURNS TABLE (task_id uuid, status text, size text, title text, pickup_area text, dropoff_area text,
               trip_miles integer, take_home_cents integer, pickup_slot_start timestamptz, payout_status text,
               ended_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.status, t.size, t.title, t.pickup_area, t.dropoff_area, t.trip_miles, public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents),
         t.pickup_slot_start, p.status,
         CASE WHEN t.status IN ('open', 'accepted', 'picked_up', 'delivered') THEN NULL
              ELSE COALESCE(t.confirmed_at, t.closed_at, t.updated_at) END
    FROM public.helpr_tasks t
    LEFT JOIN public.helpr_task_payouts p ON p.task_id = t.id
   WHERE t.helpr_id = v_uid
     AND (t.status IN ('accepted', 'picked_up', 'delivered') OR t.updated_at > now() - interval '30 days')
   ORDER BY (t.status IN ('accepted', 'picked_up', 'delivered')) DESC, t.pickup_slot_start
   LIMIT 100;
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_my_tasks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_my_tasks() TO authenticated, service_role;
