-- BUY-37 (Declutter buying audit, 10-30): a picked-up delivery that never arrives had no clock. helpr_task_sweep handled
-- open, accepted and delivered, never picked_up, and declutter_handover_sweep skips delivery orders, so the buyer read
-- "on the way" until someone reported it.
--
-- CHANGED: 24 hours after "Picked up", then weekly, the Helpr, the buyer and the seller are each told, while nobody has
-- marked it delivered and no problem is open. Words only: no status, money or strike changes.
--
-- Restated from prod's pg_get_functiondef, 2026-10-30: helpr_task_sweep (md5 e9d621ad), helpr_task_source_event (md5 07690e54).
-- declutter_delivery_on_task_event (the money) is not touched.
--
-- Not here, on purpose: opening a problem at a deadline. An admin's choices on a delivery the Helpr still has move money
-- in ways the owner hasn't decided (BUY-36, told to the lead).

ALTER TABLE public.helpr_tasks ADD COLUMN IF NOT EXISTS in_hand_nudged_at timestamptz;
COMMENT ON COLUMN public.helpr_tasks.in_hand_nudged_at IS
  'The last "still not delivered" nudge (helpr_task_sweep): 24 hours after Picked up, then weekly. Moves no money.';

CREATE OR REPLACE FUNCTION public.declutter_delivery_still_in_hand(p_order_id uuid, p_task uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.declutter_orders;
  t public.helpr_tasks;
  v_item text;
  v_when text;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  v_item := public.declutter_order_items_named(o.id);
  v_when := to_char(t.picked_up_at AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD');
  -- The member's own Pickups switch: off means none of this.
  IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = t.helpr_id AND np.declutter_pickups IS FALSE) THEN
    PERFORM public.declutter_pickup_remind(t.helpr_id, 'Still have this delivery?',
      format('You picked up %s on %s and it isn''t marked delivered. Take the drop-off photo at the address when you leave it. If something is stopping you, message Support.', v_item, v_when),
      '/declutter?view=deliver', o.buyer_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = o.buyer_id AND np.declutter_pickups IS FALSE) THEN
    PERFORM public.declutter_pickup_remind(o.buyer_id, 'Is your delivery still coming?',
      format('The Helpr picked up %s on %s and hasn''t marked it delivered. If you have it, tap "I got it" in Buying. If not, report a problem there. Your money stays held until then.', v_item, v_when),
      '/declutter?tab=buying', t.helpr_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = o.seller_id AND np.declutter_pickups IS FALSE) THEN
    PERFORM public.declutter_pickup_remind(o.seller_id, 'This delivery hasn''t arrived yet',
      format('The Helpr picked up %s on %s and hasn''t marked it delivered. You''re paid once the buyer has it. If you didn''t hand it over, report a problem in Selling.', v_item, v_when),
      '/declutter?tab=selling', t.helpr_id);
  END IF;
  RETURN jsonb_build_object('result', 'still_in_hand');
END;
$function$;

CREATE OR REPLACE FUNCTION public.helpr_task_source_event(p_task uuid, p_event text, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.helpr_tasks;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF t.source_kind = 'declutter_delivery' THEN
    -- BUY-37: only words, so it stays out of the function that moves the money.
    IF p_event = 'still_in_hand' THEN
      RETURN public.declutter_delivery_still_in_hand(t.source_id, t.id);
    END IF;
    RETURN public.declutter_delivery_on_task_event(t.source_id, t.id, p_event, p_by);
  END IF;
  RAISE EXCEPTION 'unknown_task_source' USING ERRCODE = '55000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.helpr_task_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  t public.helpr_tasks;
  v_unfilled integer := 0;
  v_noshow integer := 0;
  v_auto integer := 0;
  v_in_hand integer := 0;
BEGIN
  FOR r IN SELECT x.id FROM public.helpr_tasks x WHERE x.status = 'open' AND x.open_until <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      -- An open problem freezes the task: the admin decides the money, never
      -- this sweep (lh-money-escrow re-review #1, 2026-10-16: the late
      -- fall-through close would otherwise refund under the no-fault rule and
      -- leave the problem undecidable).
      IF t.status = 'open' AND t.open_until <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_close(t.id, 'unfilled', 'No Helpr took it in time');
        PERFORM public.helpr_task_source_event(t.id, 'unfilled', NULL);
        v_unfilled := v_unfilled + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'accepted' AND x.pickup_slot_start + interval '2 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      -- A problem on the source (e.g. the Helpr's "the seller wasn't there")
      -- freezes the task: an admin decides, the Helpr is not a no-show.
      IF t.status = 'accepted' AND t.pickup_slot_start + interval '2 hours' <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_reopen(t.id, 'helpr_no_show', t.helpr_id, 'not picked up 2 h after the pickup time');
        PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id,
          'Did not pick up a Helpr delivery within 2 hours of the pickup time');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'delivered' AND x.delivered_at + interval '24 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.status = 'delivered' AND t.delivered_at + interval '24 hours' <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_source_event(t.id, 'confirmed', 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- BUY-37: picked up, never marked delivered, nobody has said anything. Nudged 24 hours after the pickup, then weekly.
  -- No money moves and no strike: the money stays held (owner 10-30, "Nobody taps at all: hold the money"). An open
  -- problem means an admin already has it. Test data reaches nobody.
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'picked_up' AND x.picked_up_at + interval '24 hours' <= now()
              AND (x.in_hand_nudged_at IS NULL OR x.in_hand_nudged_at + interval '7 days' <= now())
              AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)
              AND x.is_seed IS NOT TRUE
              AND NOT EXISTS (SELECT 1 FROM public.test_accounts ta WHERE ta.user_id IN (x.customer_id, x.pickup_contact_id, x.helpr_id))
              AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (x.customer_id, x.pickup_contact_id, x.helpr_id) AND pr.is_seed)
            ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.status = 'picked_up' AND t.picked_up_at + interval '24 hours' <= now()
         AND (t.in_hand_nudged_at IS NULL OR t.in_hand_nudged_at + interval '7 days' <= now())
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        UPDATE public.helpr_tasks SET in_hand_nudged_at = now() WHERE id = t.id;
        PERFORM public.helpr_task_source_event(t.id, 'still_in_hand', NULL);
        v_in_hand := v_in_hand + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('unfilled', v_unfilled, 'helpr_no_show', v_noshow, 'auto_confirmed', v_auto,
                            'still_in_hand_nudged', v_in_hand);
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_delivery_still_in_hand(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_still_in_hand(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.helpr_task_source_event(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_source_event(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.helpr_task_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_sweep() TO service_role;
