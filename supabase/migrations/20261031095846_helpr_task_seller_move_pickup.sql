-- BUY-42 (buying audit 10-30 #42): the seller could not move a Helpr's pickup time. The Helpr picks any time in the
-- seller's windows (helpr_task_accept) and the seller is only told; a seller who can't make it risked a no-show report.
-- Pickups and seller delivery already allow one move. New: helpr_task_seller_move_pickup(task, new start), the
-- seller's ONE move per Helpr booking. (For verdict: the rules below are the builder's defaults.)
--
-- Rules (for verdict):
--   * only the seller (helpr_tasks.pickup_contact_id), only while a Helpr is booked (status 'accepted'), not after the
--     seller tapped Handed over, not while a problem holds the order (helpr_task_source_held), and only before the
--     booked time starts;
--   * once per Helpr booking: a 'pickup_moved' event by the seller since this Helpr's accepted_at refuses the next
--     one ('already_moved'); a new Helpr after a back-out gets a fresh booking;
--   * the new time obeys helpr_task_accept's own rules (inside the seller's pickup times via helpr_task_source_slot_ok,
--     30 minutes before latest_pickup_at) and is at least 2 hours away, so the Helpr is told in time;
--   * the Helpr and the buyer get a bell notice "Pickup time changed" (titled as the existing pickup notice, so
--     declutter_notice_type files the buyer's under declutter_pickups; the Helpr's ?tab=deliver link keeps it work).
--   Every time rule that reads pickup_slot_start (the 30-minute Picked up gate, the 2-hour no-show sweep, the
--   drop-off address) follows the new time by itself: nothing else is restated.
--
-- The event CHECK is restated from its newest definition (20261030012018_helpr_delivery_seller_handover.sql, the
-- newest migration that names helpr_task_events_task_event_check on origin/main and on wip/b75-1031), with
-- 'pickup_moved' added. Replay-safe: DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE, grants by role name.
-- Proof: src/test/pglite/helprTaskSellerMovePickup.pglite.mjs (3x; NEW_MIGRATION=skip is red).

ALTER TABLE public.helpr_task_events DROP CONSTRAINT IF EXISTS helpr_task_events_task_event_check;
ALTER TABLE public.helpr_task_events ADD CONSTRAINT helpr_task_events_task_event_check CHECK (task_event IN (
  'created', 'accepted', 'released', 'helpr_no_show', 'picked_up', 'delivered', 'wrong_code', 'confirmed',
  'unfilled', 'cancelled', 'failed', 'pickup_no_show', 'handed_over', 'pickup_moved'));

CREATE OR REPLACE FUNCTION public.helpr_task_seller_move_pickup(p_task_id uuid, p_pickup_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_when text;
  v_what text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.pickup_contact_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.helpr_task_source_require_feature(t.source_kind);
  IF t.status <> 'accepted' OR t.helpr_id IS NULL
     OR (t.handed_over_at IS NOT NULL AND t.handed_over_to = t.helpr_id) THEN
    RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF t.pickup_slot_start <= now() THEN
    RAISE EXCEPTION 'too_late' USING ERRCODE = '55000',
      HINT = 'The pickup time has started. Message the Helpr instead.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.helpr_task_events e
              WHERE e.task_id = t.id AND e.task_event = 'pickup_moved' AND e.actor_id = v_uid
                AND e.created_at >= t.accepted_at) THEN
    RAISE EXCEPTION 'already_moved' USING ERRCODE = '55000',
      HINT = 'You can move a Helpr''s pickup once.';
  END IF;
  IF p_pickup_slot_start IS NULL OR p_pickup_slot_start < now() + interval '2 hours'
     OR p_pickup_slot_start = t.pickup_slot_start
     OR p_pickup_slot_start + interval '30 minutes' > t.latest_pickup_at
     OR NOT public.helpr_task_source_slot_ok(t.source_kind, t.source_id, p_pickup_slot_start) THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
      HINT = 'Pick a new time at least 2 hours away, inside your pickup times.';
  END IF;
  UPDATE public.helpr_tasks SET pickup_slot_start = p_pickup_slot_start, updated_at = now()
   WHERE id = t.id AND status = 'accepted';
  PERFORM public.helpr_task_log(t.id, 'pickup_moved', v_uid, to_char(p_pickup_slot_start, 'YYYY-MM-DD"T"HH24:MI:SSOF'));
  v_when := to_char(p_pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM');
  PERFORM public.declutter_notify(t.helpr_id, 'info', 'Pickup time changed',
    format('The seller moved the pickup of %s to %s.', t.title, v_when),
    '/declutter?tab=deliver', v_uid);
  IF t.source_kind = 'declutter_delivery' THEN
    v_what := public.declutter_order_items_named(t.source_id);
    PERFORM public.declutter_notify(t.customer_id, 'info', 'Pickup time changed',
      format('The seller moved the Helpr''s pickup of %s to %s. Your delivery comes after that.', v_what, v_when),
      '/declutter?tab=buying', v_uid);
  END IF;
  RETURN jsonb_build_object('result', 'moved', 'pickup_slot_start', p_pickup_slot_start);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_seller_move_pickup(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_seller_move_pickup(uuid, timestamptz) TO authenticated, service_role;
