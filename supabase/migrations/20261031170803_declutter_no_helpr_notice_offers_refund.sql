-- LEAD-NOHELPR-NOTICE (owner 10-31, with BUY-2): when no Helpr takes a delivery, the notices still said the sale is
-- now a pickup at the seller's home and nothing else. Since BUY-2 (20261031133938, declutter_cancel_after_no_helpr)
-- the buyer may instead cancel for a refund in which the BUYER bears the card fee. The two 'unfilled' notices now say so:
--   buyer:  "... Book a time to pick up at the seller's home before your 7-day deadline, or cancel the sale for a
--            refund. Buying shows how much comes back before you choose."
--   (No fee is named: members never see a fee name or number, owner 2026-10-25, src/test/membersSeeNoFeeWords.test.ts.
--   The amount that comes back, which leaves out the card fee the buyer bears, is on the Buying card.)
--   seller: "... The buyer can book a pickup at your home or cancel the sale. If they cancel, your item goes back on
--            sale."
-- Titles are unchanged ('No Helpr took your delivery', 'The buyer will pick it up'; declutter_notice_type files them).
--
-- Restated verbatim from the NEWEST CREATE of declutter_delivery_on_task_event, 20261031140431 (LEAD-BUY44, on
-- wip/b85-1031 with BUY-2; origin/main's newest is the older 20261030031642). Measured 2026-10-31 with git grep over
-- every origin wip/ and ready/ branch: none newer. The ONLY change is the two marked notice bodies. Words only: no
-- status, money or strike changes. MUST land in the same train as BUY-2 (a notice promising a refund needs the cancel).
-- REPLAY-SAFE: CREATE OR REPLACE; grants restated by role name.
-- Proof: src/test/pglite/declutterNoHelprNoticeOffersRefund.pglite.mjs (3x; NEW_MIGRATION=skip is red).

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
    -- CHANGED (LEAD-BUY44, buying audit #44): the seller was told "Picked up" and then nothing until the payout. The
    -- payout words are the seller's rule for a Helpr delivery (src/lib/declutter/sellerPayoutRule.ts, "delivery").
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Delivered',
      format('The Helpr left %s at the buyer''s address. You''re paid 24 hours after the buyer taps "I got it", or about 48 hours after the drop-off if they say nothing.',
             public.declutter_order_items_named(o.id)),
      '/declutter?tab=selling', t.helpr_id);
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
        -- LEAD-NOHELPR-NOTICE: and the buyer's other choice, BUY-2's cancel. No fee named (membersSeeNoFeeWords, owner
        -- 2026-10-25): Buying shows the amount (declutter_no_helpr_choice.refund_cents).
        format('No Helpr took the delivery of %s. The $%s you paid for delivery is coming back to your card. Book a time to pick up at the seller''s home before your 7-day deadline, or cancel the sale for a refund. Buying shows how much comes back before you choose.',
               public.declutter_order_items_named(o.id), to_char(o.delivery_cents / 100.0, 'FM999990.00')),
        '/declutter?tab=buying', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'The buyer will pick it up',
        -- LEAD-NOHELPR-NOTICE: the buyer may cancel instead (BUY-2), and the item goes back on sale then.
        format('No Helpr took the delivery of %s. The buyer can book a pickup at your home or cancel the sale. If they cancel, your item goes back on sale.', public.declutter_order_items_named(o.id)),
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

REVOKE ALL ON FUNCTION public.declutter_delivery_on_task_event(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_on_task_event(uuid, uuid, text, text) TO service_role;
