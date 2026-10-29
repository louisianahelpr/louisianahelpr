-- AL-4 "One dispute screen for admin" (owner 2026-10-28, anti-lying measures, ~/.lh-wt/declutter-next-queue-1028.md #4:
-- "Both sides' photos with times and places side by side, the chat, and the order steps, with decide buttons").
--
-- The problem card already had the seller's "set it out" and the buyer's "picked it up" photos with their times
-- (declutter_admin_open_problems, 20261028195212) and the chat comes from declutter_admin_problem_talk (AL-6). What it
-- could not show: where the order stood (booked? delivered?) and, on a Helpr delivery, the Helpr's own pickup and
-- drop-off photos with their times and how far the drop-off photo was from the drop-off address.
--
-- declutter_admin_problem_case(p_problem_id) (new, read-only): one row of facts the order's own rows hold, the same
-- facts the buyer's and seller's trackers read (BuyingOrders' buyerOrderFacts): the booking's time or porch day, the
-- seller delivery's status, time and delivered time, and the Helpr task's accepted / picked-up / delivered times with
-- its pickup and drop-off photo paths and the drop-off distance. No names, ids, addresses or codes (the drop-off code
-- stays out). has_role admin is the FIRST statement (42501 not_admin). No require_feature on purpose (row 62).
-- Admin-only data (photo paths): needs lh-authz-rls. STABLE SECURITY DEFINER, search_path pinned; REVOKE FROM PUBLIC,
-- anon; GRANT authenticated, service_role.
-- REPLAY-SAFETY: CREATE OR REPLACE of a new function; REVOKE/GRANT repeat.
-- Proof: src/test/pglite/declutterHandoverChoices.pglite.mjs T10 (applied 3x).

CREATE OR REPLACE FUNCTION public.declutter_admin_problem_case(p_problem_id uuid)
RETURNS TABLE(handover text, order_status text, slot_start timestamptz, pickup_day date,
  seller_delivery_status text, seller_delivery_slot_start timestamptz, seller_delivered_at timestamptz,
  helpr_accepted_at timestamptz, helpr_picked_up_at timestamptz, helpr_pickup_photo_path text,
  helpr_delivered_at timestamptz, helpr_dropoff_photo_path text, helpr_dropoff_distance_m integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.id = p_problem_id) THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT o.handover, o.status, b.slot_start, b.pickup_day,
           sd.status, sd.slot_start, sd.delivered_at,
           t.accepted_at, t.picked_up_at, t.pickup_photo_path,
           t.delivered_at, t.dropoff_photo_path, t.dropoff_distance_m
      FROM public.declutter_problems p
      JOIN public.declutter_orders o ON o.id = p.order_id
      LEFT JOIN public.declutter_bookings b ON b.order_id = o.id
      LEFT JOIN public.declutter_seller_deliveries sd ON sd.order_id = o.id
      LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id
      LEFT JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE p.id = p_problem_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_problem_case(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_problem_case(uuid) TO authenticated, service_role;
