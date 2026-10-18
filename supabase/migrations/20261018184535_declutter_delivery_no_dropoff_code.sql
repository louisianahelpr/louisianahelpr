-- Declutter Helpr delivery without its drop-off code (owner 2026-10-18
-- pop-ups: "no code, porch pickup"; after 20261018183715_declutter_handover_no_qr_no_code):
--   1. Helpr delivery has no drop-off code: helpr_task_delivered ignores
--      p_code (kept in the signature so an old build's call still parses) and
--      always takes the door photo at <= 200 m (the 1 km allowance came with
--      the code); helpr_task_view no longer returns dropoff_code/code_locked;
--      helpr_task_confirm no longer accepts 'code'. The buyer's "I got it" or
--      the 24 h auto-confirm completes it.
--   3. declutter_delivery_on_task_event: the buyer's "accepted" and "picked
--      up" notices no longer mention a code (lh-money-escrow review #4).
--   2. helpr_tasks.confirmed_by: 'code' stays in its CHECK for historical rows;
--      the trigger from 20261018183715 refuses any NEW 'code' here too.
--   helpr_tasks.dropoff_code is still drawn (NOT NULL); nothing reads it.
--
-- Bodies are restated from their NEWEST definition, 20261017055505, unchanged
-- except for the lines named. Replay safe: CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS, grants restated.

-- 1. Helpr delivery without the drop-off code.
CREATE OR REPLACE FUNCTION public.helpr_task_delivered(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric,
  p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'not_picked_up_yet' USING ERRCODE = '55000', HINT = 'Take the "Picked up" photo first.';
  END IF;
  -- No drop-off code any more (owner 2026-10-18): p_code is ignored, kept in
  -- the signature so an old build's call still parses; the door photo is the
  -- only drop-off.
  IF t.status = 'picked_up' THEN
    IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) OR p_photo_path = t.pickup_photo_path THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    v_m := public.helpr_task_distance_m(p_lat, p_lng, t.dropoff_lat, t.dropoff_lng);
    -- 200 m from the drop-off point.
    IF v_m IS NULL OR v_m > 200 THEN
      RAISE EXCEPTION 'not_at_dropoff' USING ERRCODE = '22023', HINT = 'Take the photo at the drop-off address.';
    END IF;
    UPDATE public.helpr_tasks
       SET status = 'delivered', delivered_at = now(), dropoff_photo_path = p_photo_path, dropoff_distance_m = v_m, updated_at = now()
     WHERE id = t.id AND status = 'picked_up';
    PERFORM public.helpr_task_log(t.id, 'delivered', v_uid, v_m::text || ' m');
  END IF;
  -- The "Delivered" notice goes out once, on the step itself; a repeat call
  -- on a task already at the door says so again without re-sending it
  -- (lh-silent-failure #5, lh-authz-rls #9).
  IF t.status = 'picked_up' THEN
    PERFORM public.helpr_task_source_event(t.id, 'delivered', NULL);
  END IF;
  RETURN jsonb_build_object('result', 'delivered', 'distance_m', v_m,
    'held', public.helpr_task_source_held(t.source_kind, t.source_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_delivered(uuid, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_delivered(uuid, text, numeric, numeric, text) TO authenticated, service_role;

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
  SELECT NULLIF(split_part(btrim(COALESCE(pr.full_name, '')), ' ', 1), '') INTO v_helpr_name
    FROM public.profiles pr WHERE pr.user_id = t.helpr_id;
  RETURN jsonb_build_object(
    'task_id', t.id, 'source_kind', t.source_kind, 'source_id', CASE WHEN v_role <> 'candidate' THEN t.source_id END,
    'role', v_role, 'status', t.status, 'size', t.size, 'title', t.title,
    'pickup_area', t.pickup_area, 'dropoff_area', t.dropoff_area, 'trip_miles', t.trip_miles,
    'take_home_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.pay_cents - t.fee_cents END,
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
    'dropoff_address', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_address END,
    'dropoff_lat', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_lat END,
    'dropoff_lng', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_lng END,
    'pickup_photo_path', CASE WHEN v_role <> 'candidate' THEN t.pickup_photo_path END,
    'dropoff_photo_path', CASE WHEN v_role <> 'candidate' THEN t.dropoff_photo_path END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_view(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_confirm(p_task uuid, p_by text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
  v_payout uuid;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
      HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  IF p_by IS NULL OR p_by NOT IN ('customer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  IF p_by <> 'admin' AND public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported. Louisiana Helpr decides before anyone is paid.';
  END IF;
  UPDATE public.helpr_tasks
     SET status = 'confirmed', confirmed_at = now(), confirmed_by = p_by, closed_at = now(), updated_at = now()
   WHERE id = t.id AND status IN ('picked_up', 'delivered');
  INSERT INTO public.helpr_task_payouts (task_id, helpr_id, pay_cents, fee_cents, amount_cents, status)
  VALUES (t.id, t.helpr_id, t.pay_cents, t.fee_cents, t.pay_cents - t.fee_cents,
          CASE WHEN t.pay_cents - t.fee_cents = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (task_id) DO NOTHING
  RETURNING id INTO v_payout;
  PERFORM public.helpr_task_log(t.id, 'confirmed', p_actor, p_by);
  PERFORM public.declutter_notify(t.helpr_id, 'payment', 'Delivery done',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL)
         THEN format('Set up payouts in Settings to get your $%s. We send it as soon as you do.',
                     to_char((t.pay_cents - t.fee_cents) / 100.0, 'FM999990.00'))
         ELSE format('$%s is on its way to your payout account.', to_char((t.pay_cents - t.fee_cents) / 100.0, 'FM999990.00')) END,
    '/declutter?view=deliver', t.customer_id);
  RETURN jsonb_build_object('result', 'confirmed', 'helpr_payout_id', v_payout, 'by', p_by);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_confirm(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_confirm(uuid, text, uuid) TO service_role;

-- 2. No new 'code' confirmation on a Helpr task either.
DROP TRIGGER IF EXISTS trg_helpr_tasks_no_new_code ON public.helpr_tasks;
CREATE TRIGGER trg_helpr_tasks_no_new_code
  BEFORE INSERT OR UPDATE OF confirmed_by ON public.helpr_tasks
  FOR EACH ROW EXECUTE FUNCTION public.declutter_no_new_code_confirmation();

-- 3. The buyer's notices without the code (restated from 20261017055505, those two lines only).
CREATE OR REPLACE FUNCTION public.declutter_delivery_on_task_event(p_order_id uuid, p_task uuid, p_event text, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  t public.helpr_tasks;
  v_out jsonb;
  v_refund uuid;
  v_problem uuid;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF p_event = 'accepted' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'A Helpr took your delivery',
      format('Pickup from the seller is %s. They leave it at your door with a photo.',
             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?view=cart', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Helpr pickup booked',
      format('A Helpr picks up your item %s. Have it ready.',
             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?view=cart', t.helpr_id);
  ELSIF p_event = 'released' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Finding another Helpr',
      'Your Helpr can''t make it. Your delivery is back up for another Helpr.', '/declutter?view=cart', NULL);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Pickup time cancelled',
      'The Helpr can''t make it. You''ll be told the new pickup time.', '/declutter?view=cart', NULL);
  ELSIF p_event = 'picked_up' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your item is on its way',
      'The Helpr picked up your item. They leave it at your door with a photo; tap "I got it" when you have it.', '/declutter?view=cart', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Picked up',
      'The Helpr picked up your item. You''re paid when the buyer has it.', '/declutter?view=cart', t.helpr_id);
  ELSIF p_event = 'delivered' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Delivered',
      'The Helpr left your item at the drop-off address. Tap "I got it", or report a problem within 24 hours.',
      '/declutter?view=cart', t.helpr_id);
  ELSIF p_event = 'confirmed' THEN
    -- The handover IS the delivery: the seller is paid (and the Helpr, below).
    v_out := public.declutter_complete_handover(o.id,
      CASE p_by WHEN 'code' THEN 'code' WHEN 'customer' THEN 'buyer' WHEN 'admin' THEN 'admin' ELSE 'auto' END);
    RETURN v_out;
  ELSIF p_event = 'unfilled' THEN
    -- Row 40: no Helpr in 48 h. The delivery fee goes back in full; the order
    -- becomes a pickup at the seller's home; the 7-day clock keeps running.
    IF o.status = 'paid' AND o.handover = 'delivery' THEN
      v_refund := public.declutter_delivery_refund(o.id, 'no_helpr');
      -- B76: a Helpr who backed out or never came late in the week can leave
      -- the buyer too little time to book a pickup, and the handover sweep
      -- would then close it as the BUYER's no-show (strike, fee kept). With
      -- under 48 h to the 7-day deadline the sale is closed instead as no one's
      -- fault: the delivery fee back in full (above), the rest under the
      -- no-fault policy (row 100: the card fee is kept), no strike, the item
      -- back on sale.
      IF o.paid_at + interval '7 days' < now() + interval '48 hours' THEN
        PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your delivery fell through',
          'No Helpr could deliver in time, so this sale is cancelled. Your delivery fee comes back in full and the rest of your payment minus the card fee.',
          '/declutter?view=cart', o.seller_id);
        v_out := public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
        RETURN jsonb_build_object('result', 'unfilled', 'delivery_refund_id', v_refund, 'closed', v_out);
      END IF;
      UPDATE public.declutter_orders SET handover = 'pickup_home' WHERE id = o.id AND status = 'paid';
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'No Helpr took your delivery',
        format('Your $%s delivery fee is coming back to your card. Book a time to pick up at the seller''s home before your 7-day deadline.',
               to_char(o.delivery_cents / 100.0, 'FM999990.00')),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'The buyer will pick it up',
        'No Helpr took this delivery, so the buyer will book a pickup at your home.', '/declutter?view=cart', o.buyer_id);
    END IF;
    RETURN jsonb_build_object('result', 'unfilled', 'delivery_refund_id', v_refund);
  ELSIF p_event = 'pickup_no_show' THEN
    -- B67 (revised 2026-10-16 after lh-authz-rls #3): the Helpr's report, with
    -- a photo at the pickup point, opens a problem on the order. The money
    -- waits (the problem holds it; the task stays taken, so the Helpr is not
    -- counted a no-show) and an admin decides: a seller no-show = refund the
    -- buyer, the seller's fault (row 19: everything back, card fee to the
    -- seller's debt, a strike); or pay the seller (the delivery fee goes
    -- back, B70).
    -- The Helpr's photo goes on the problem so the admin sees the evidence
    -- (lh-silent-failure re-review #1); p_by carries "<metres> m|<photo path>".
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths, is_seed)
    VALUES (o.id, t.helpr_id, 'helpr', 'no_show',
            format('The Helpr says the seller wasn''t there for the pickup at %s. Their photo at the pickup address (%s m away) is on the delivery.',
                   to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD FMHH12:MI AM'), COALESCE(split_part(p_by, '|', 1), '?')),
            CASE WHEN NULLIF(split_part(p_by, '|', 2), '') IS NULL THEN '{}'::text[] ELSE ARRAY[split_part(p_by, '|', 2)] END,
            o.is_seed)
    RETURNING id INTO v_problem;
    PERFORM public.declutter_notify(o.seller_id, 'info', 'The Helpr couldn''t pick up',
      'The Helpr says you weren''t there for the pickup. Louisiana Helpr will look at it and decide; the money waits until then.',
      '/declutter?view=sales', t.helpr_id);
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Your delivery is on hold',
      'The Helpr couldn''t pick up your item from the seller. Louisiana Helpr will look at it and decide; you''ll be told.',
      '/declutter?view=cart', t.helpr_id);
    RETURN jsonb_build_object('result', 'reported', 'problem_id', v_problem);
  END IF;
  RETURN jsonb_build_object('result', p_event);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_on_task_event(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_on_task_event(uuid, uuid, text, text) TO service_role;
