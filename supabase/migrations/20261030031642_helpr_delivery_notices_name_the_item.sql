-- Audit 1c D3-5 (Declutter Helpr delivery, prod 2026-10-29): the delivery step notices did not name the item
-- ("A Helpr took your delivery", "Your item is on its way", "Your delivery is on hold", the seller's "The Helpr
-- couldn't pick up", the Helpr's "Delivery done"), so a buyer with two deliveries could not tell which one moved; and
-- every buyer notice still linked the retired /declutter?view=cart (the Helpr's, ?view=deliver).
--
-- Restated from prod's EFFECTIVE definitions (pg_get_functiondef, read-only, 2026-10-30):
--   declutter_delivery_on_task_event(uuid,uuid,text,text)  md5 a6c72c382c5d5063610e82fe5cb327ff
--   helpr_task_confirm(uuid,text,uuid)                      md5 f23e3d581aa35fa695e3bf9e7913af4b
-- Changed: notice BODIES name the item (declutter_order_items_named for the order; the task's title for the Helpr) and
-- the links open the recipient's tab (?tab=buying, ?tab=deliver). Titles are unchanged (declutter_notice_type files
-- notices by title). Every other line, the money and the order of writes are as on prod.
-- Grants as on prod (proacl {postgres=X, service_role=X}, read 2026-10-30): internal, called by other definers only.
-- CREATE OR REPLACE keeps the ACL; the REVOKEs at the end restate it so a replay on a fresh database matches.

CREATE OR REPLACE FUNCTION public.declutter_delivery_on_task_event(p_order_id uuid, p_task uuid, p_event text, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      format('A Helpr picks up %s from the seller %s. They leave it at your door with a photo.',
             public.declutter_order_items_named(o.id),
             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?tab=buying', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Helpr pickup booked',
      format('A Helpr picks up %s %s. Have it ready.', public.declutter_order_items_named(o.id),
             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?tab=selling', t.helpr_id);
  ELSIF p_event = 'released' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Finding another Helpr',
      format('Your Helpr can''t make it. The delivery of %s is back up for another Helpr.', public.declutter_order_items_named(o.id)),
      '/declutter?tab=buying', NULL);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Pickup time cancelled',
      format('The Helpr can''t make it to pick up %s. You''ll be told the new pickup time.', public.declutter_order_items_named(o.id)),
      '/declutter?tab=selling', NULL);
  ELSIF p_event = 'picked_up' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your item is on its way',
      format('The Helpr picked up %s. They leave it at your door with a photo; tap "I got it" when you have it.',
             public.declutter_order_items_named(o.id)),
      '/declutter?tab=buying', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Picked up',
      format('The Helpr picked up %s. You''re paid when the buyer has it.', public.declutter_order_items_named(o.id)),
      '/declutter?tab=selling', t.helpr_id);
  ELSIF p_event = 'delivered' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Delivered',
      format('The Helpr left %s at the drop-off address. Tap "I got it", or report a problem within 24 hours.',
             public.declutter_order_items_named(o.id)),
      '/declutter?tab=buying', t.helpr_id);
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
          format('No Helpr could deliver %s in time, so this sale is cancelled. What you paid for delivery comes back in full, and most of the rest of your payment.',
                 public.declutter_order_items_named(o.id)),
          '/declutter?tab=buying', o.seller_id);
        v_out := public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
        RETURN jsonb_build_object('result', 'unfilled', 'delivery_refund_id', v_refund, 'closed', v_out);
      END IF;
      UPDATE public.declutter_orders SET handover = 'pickup_home' WHERE id = o.id AND status = 'paid';
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'No Helpr took your delivery',
        format('No Helpr took the delivery of %s. The $%s you paid for delivery is coming back to your card. Book a time to pick up at the seller''s home before your 7-day deadline.',
               public.declutter_order_items_named(o.id), to_char(o.delivery_cents / 100.0, 'FM999990.00')),
        '/declutter?tab=buying', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'The buyer will pick it up',
        format('No Helpr took the delivery of %s, so the buyer will book a pickup at your home.', public.declutter_order_items_named(o.id)),
        '/declutter?tab=selling', o.buyer_id);
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
      format('The Helpr says you weren''t there to hand over %s. Louisiana Helpr will look at it and decide; the money waits until then.',
             public.declutter_order_items_named(o.id)),
      '/declutter?tab=selling', t.helpr_id);
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Your delivery is on hold',
      format('The Helpr couldn''t pick up %s from the seller. Louisiana Helpr will look at it and decide; you''ll be told.',
             public.declutter_order_items_named(o.id)),
      '/declutter?tab=buying', t.helpr_id);
    RETURN jsonb_build_object('result', 'reported', 'problem_id', v_problem);
  END IF;
  RETURN jsonb_build_object('result', p_event);
END;
$function$;

CREATE OR REPLACE FUNCTION public.helpr_task_confirm(p_task uuid, p_by text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.helpr_tasks;
  v_payout uuid;
  v_amount integer;
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
  v_amount := public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents);
  INSERT INTO public.helpr_task_payouts (task_id, helpr_id, pay_cents, fee_cents, amount_cents, status)
  VALUES (t.id, t.helpr_id, t.pay_cents, t.fee_cents, v_amount,
          CASE WHEN v_amount = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (task_id) DO NOTHING
  RETURNING id INTO v_payout;
  PERFORM public.helpr_task_log(t.id, 'confirmed', p_actor, p_by);
  PERFORM public.declutter_notify(t.helpr_id, 'payment', 'Delivery done',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL)
         THEN format('"%s" is delivered. Set up payouts in Settings to get your $%s. We send it as soon as you do.',
                     t.title, (v_amount / 100)::text)
         ELSE format('"%s" is delivered. $%s is on its way to your payout account.', t.title, (v_amount / 100)::text) END,
    '/declutter?tab=deliver', t.customer_id);
  RETURN jsonb_build_object('result', 'confirmed', 'helpr_payout_id', v_payout, 'by', p_by);
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_delivery_on_task_event(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.helpr_task_confirm(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_on_task_event(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.helpr_task_confirm(uuid, text, uuid) TO service_role;
