-- A3 STACK RECONCILE (builder 166, lead 11-02 for Lander 33). The A3 stack (b149 -> b154 -> b159) and b164-open each
-- restated three functions from different bases, so the newest file of each dropped a hunk an earlier one added.
-- This restates each from its newest definition PLUS the hunks that newest one lost (3-way merge of the bodies):
--
--   (1) declutter_handover_sweep: 20261102031228 (Q2465 reminders_retry_strict: the two "Delivery coming up" sends
--       are declutter_notify_strict) PLUS A3-72's loop (b2) from 20261102031000 (a seller delivery still needs_time at
--       book_by is closed as delivery_never_booked, no strike) with its v_sd_unbooked counter and result key.
--   (2) declutter_close_paid_order: 20261102063343 (Q1928 gap 3 seller_out + Shipping S6 2d held shipping + Q1935
--       prorated card fee; 20261102080936 does not restate it) PLUS A3-72's two delivery_never_booked copy lines
--       (buyer "Refund on its way", seller "Sale cancelled") from 20261102031000.
--   (3) notify_on_payment_escrowed: 20261102043115 (A3-38: the Helpr's notice names the day-before confirm, not
--       "Get to work!") PLUS Q1995's closed-job skip from 20261102071109 (NEW.status NOT IN cancelled/completed). The
--       Helpr line keeps A3-38's v_msg; 20261102071109's "is held safely. Get to work!" is the copy A3-38 replaced.
--
-- MONEY: (2) is the refund close; no amount or fee rule changes here, only the copy branches A3-72 already added.
-- delivery_never_booked takes declutter_record_refund's ELSE (full_platform_absorbs), as in 20261102031000.
-- REPLAY-SAFE: CREATE OR REPLACE with identical signatures; grants restated as each source file gives them.
-- Proof: src/test/pglite/a3StackReconcile.pglite.mjs (all migrations 3x, anon default grant emulated, each hunk
-- asserted in the final bodies, one plant per hunk).

CREATE OR REPLACE FUNCTION public.declutter_handover_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  o public.declutter_orders;
  v_auto integer := 0;
  v_noshow integer := 0;
  v_sd_auto integer := 0;
  v_sd_unbooked integer := 0;
  v_reminders integer := 0;
  v_unanswered integer := 0;
  v_nudged integer := 0;
  v_to_admin integer := 0;
  v_delivery boolean;
  v_closed boolean;
  a record;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_h integer;
BEGIN
  -- Shipping S2: a shipped order is never finished or closed here; it finishes on the USPS
  -- delivered scan + 48 h (S7), and never books a slot (declutter_bookings_not_delivery).
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery', 'ship') AND b.slot_start IS NOT NULL AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
       -- CHANGED (review of 7496d29c8b #3): a porch sale waits 24 hours from the later of the pickup time and the photo.
       AND (o2.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                               WHERE h.order_id = o2.id AND h.set_out_photo_path IS NOT NULL
                                                 AND h.set_out_at + interval '24 hours' <= now()))
       -- CHANGED (owner 10-30): never while the seller's 24 hours to answer run. A door or meeting-spot sale needs the
       -- seller's "Picked up", 24 hours old (declutter_sale_final's 24 hours follow: paid about 48 hours after it). If
       -- neither side says anything the money is held until someone does: no auto-pay, refund, strike or admin problem.
       AND NOT EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o2.id AND h.no_show_reported_at IS NOT NULL)
       AND (o2.handover = 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o2.id
                                              AND h.seller_confirmed_at + interval '24 hours' <= now()))
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery', 'ship')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL
                       AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now())
         AND NOT EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.no_show_reported_at IS NOT NULL)
         AND (o.handover = 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id
                                               AND h.seller_confirmed_at + interval '24 hours' <= now()))
         -- Porch (owner 2026-10-18): no "Left on porch" photo, no auto-pay.
         AND (o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                                WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL
                                                  AND h.set_out_at + interval '24 hours' <= now())) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      LEFT JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery', 'ship') AND o2.paid_at + interval '7 days' <= now()
       AND (b.order_id IS NULL OR b.slot_start IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery', 'ship')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
        PERFORM public.declutter_close_paid_order(o.id, 'buyer_no_show', 'buyer', 'not_picked_up',
          'You did not pick up a paid Declutter item within 7 days. The item price was refunded.');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (b2) CHANGED (A3-72, lead 11-01 5:34 PM + 9:05 PM): a seller-delivered order whose delivery lost its time
  -- (needs_time: the slot went to another buyer at payment) and still has none at book_by (paid + 7 days) is closed
  -- and the buyer's full payment refunded (reason delivery_never_booked: full_platform_absorbs, no seller debt).
  -- No strike for either side (p_strike_side NULL): neither set a time. An open problem holds it, as in (b).
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_seller_deliveries d ON d.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'seller_delivery' AND d.status = 'needs_time'
       AND o2.book_by IS NOT NULL AND o2.book_by <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'seller_delivery' AND o.book_by <= now()
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_seller_deliveries d WHERE d.order_id = o.id AND d.status = 'needs_time') THEN
        PERFORM public.declutter_close_paid_order(o.id, 'delivery_never_booked', NULL, NULL, NULL);
        v_sd_unbooked := v_sd_unbooked + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (c) Seller delivery: 24 h after the seller's "Delivered" (a photo, when left at the
  -- door) or "Handed over", unless a problem is open.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_seller_deliveries d ON d.order_id = o2.id
      JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'seller_delivery' AND d.status = 'booked'
       AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)
       AND d.delivered_at + make_interval(hours => (v_rules ->> 'auto_confirm_hours')::integer) <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'seller_delivery'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_handovers h JOIN public.declutter_seller_deliveries d ON d.order_id = h.order_id
                      WHERE h.order_id = o.id AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)
                        AND d.delivered_at + make_interval(hours => (v_rules ->> 'auto_confirm_hours')::integer) <= now()) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_sd_auto := v_sd_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (d) Reminders before a booked delivery (24 h and 1 h, from the rules). One
  -- per run per order: the nearest one due; any earlier one not sent yet is
  -- marked sent too, so a late booking never gets "tomorrow" after "soon".
  FOR r IN
    SELECT d.order_id, d.buyer_id, d.seller_id, d.slot_start, d.dropoff_area, d.reminded_hours
      FROM public.declutter_seller_deliveries d
      JOIN public.declutter_orders o2 ON o2.id = d.order_id
     WHERE d.status = 'booked' AND o2.status = 'paid' AND d.slot_start > now()
       AND d.slot_start <= now() + make_interval(hours => (SELECT max(x::integer) FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x))
     ORDER BY d.slot_start LIMIT 500
  LOOP
    BEGIN
      -- CHANGED (20261031181404): lock the order first, as every other loop here does. The lock records this order
      -- for the notices below (declutter_notice_about), so "Delivery coming up" names THIS order's item; without it
      -- the setting still held the previous order the sweep locked (another order's item for the same pair, or none).
      -- The booking is re-read under the lock: a reminder another run already sent is not sent twice.
      o := public.declutter_lock_order(r.order_id);
      SELECT d.slot_start, d.reminded_hours INTO r.slot_start, r.reminded_hours
        FROM public.declutter_seller_deliveries d
       WHERE d.order_id = r.order_id AND d.status = 'booked' AND d.slot_start > now();
      IF o.status <> 'paid' OR NOT FOUND THEN
        v_h := NULL;
      ELSE
        SELECT min(x::integer) INTO v_h FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
         WHERE r.slot_start <= now() + make_interval(hours => x::integer)
           AND NOT x::integer = ANY (r.reminded_hours);
      END IF;
      IF v_h IS NOT NULL THEN
        UPDATE public.declutter_seller_deliveries d
           SET reminded_hours = (SELECT array_agg(DISTINCT y ORDER BY y)
                                   FROM unnest(d.reminded_hours || ARRAY(SELECT x::integer FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
                                                                         WHERE x::integer >= v_h)) y),
               updated_at = now()
         WHERE d.order_id = r.order_id;
        -- Q2465: strict, so a reminder that cannot be written rolls this block back (the reminded_hours mark with it)
        -- and the next run retries it.
        PERFORM public.declutter_notify_strict(r.seller_id, 'payment', 'Delivery coming up',
          format('You deliver to %s on %s.', r.dropoff_area, public.declutter_delivery_when(r.slot_start)),
          '/declutter?tab=selling', r.buyer_id);
        PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Delivery coming up',
          format('The seller delivers on %s.', public.declutter_delivery_when(r.slot_start)),
          '/declutter?view=cart', r.seller_id);
        v_reminders := v_reminders + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.order_id::text, SQLERRM);
    END;
  END LOOP;
  -- (e) CHANGED (owner 10-30): the buyer's no-show report, 24 hours on with no answer: refund + strike, as the one tap did.
  -- An open problem (the seller's answer, or either side's report) holds it; a problem taken back lets it run again.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND h.no_show_reported_at IS NOT NULL AND h.no_show_answer_by <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.no_show_answer_by <= now()) THEN
        PERFORM public.declutter_close_paid_order(o.id, 'seller_no_show', 'seller', 'seller_no_show',
          CASE WHEN o.handover = 'seller_delivery'
               THEN 'You did not deliver a booked Declutter order. The buyer got everything back, delivery included; the cost of that refund comes out of your next Declutter payout.'
               ELSE 'You did not show up for a booked Declutter pickup. The buyer got everything back; the cost of that refund comes out of your next Declutter payout.' END);
        v_unanswered := v_unanswered + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (f) CHANGED (lead and owner 10-30): a sale whose time has passed with nobody having said anything. The money stays
  -- held. Both are nudged 24 hours after the time, then weekly; at 60 days it goes to admin to decide, and no money moves.
  FOR r IN
    SELECT o2.id, o2.buyer_id, o2.seller_id, o2.handover, h.held_nudged_at,
           COALESCE(public.declutter_pickup_anchor(b.slot_start, b.pickup_day), d.slot_end) AS held_from
      FROM public.declutter_orders o2
      LEFT JOIN public.declutter_bookings b ON b.order_id = o2.id AND o2.handover IN ('pickup_home', 'meetup', 'porch')
      LEFT JOIN public.declutter_seller_deliveries d ON d.order_id = o2.id AND o2.handover = 'seller_delivery'
                                                     AND d.status = 'booked' AND d.delivered_at IS NULL
      LEFT JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover IN ('pickup_home', 'meetup', 'porch', 'seller_delivery')
       AND COALESCE(public.declutter_pickup_anchor(b.slot_start, b.pickup_day), d.slot_end) + interval '24 hours' <= now()
       AND h.seller_confirmed_at IS NULL AND h.no_show_reported_at IS NULL AND h.set_out_at IS NULL
       AND (h.held_nudged_at IS NULL OR h.held_nudged_at + interval '7 days' <= now()
            OR COALESCE(public.declutter_pickup_anchor(b.slot_start, b.pickup_day), d.slot_end) + interval '60 days' <= now())
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
       -- Owner rule: test data never reaches a member or admin.
       AND o2.is_seed IS NOT TRUE
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (o2.buyer_id, o2.seller_id))
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (o2.buyer_id, o2.seller_id) AND pr.is_seed)
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      CONTINUE WHEN o.status <> 'paid';
      v_delivery := r.handover = 'seller_delivery';
      IF r.held_from + interval '60 days' <= now() THEN
        -- Once: if an admin's problem was ever opened here, someone has already looked.
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.reporter_side = 'system');
        INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
        VALUES (o.id, NULL, 'system', 'other',
                'Nobody has said anything about this handover for 60 days, so the money is still held. Neither side confirmed it or reported a problem. Decide who gets the money.',
                '{}');
        PERFORM public.declutter_notify(o.buyer_id, 'declutter_refunds', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until Louisiana Helpr decides. You can add your side on the order.',
          '/declutter?tab=buying', o.seller_id);
        PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until Louisiana Helpr decides. You can add your side on the order.',
          '/declutter?tab=selling', o.buyer_id);
        -- A cron has no caller for the gate to read, so test data is skipped here too (20261030150104's rule).
        IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
          FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
            PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter sale held 60 days',
              'Nobody has confirmed a paid handover for 60 days. The money is held until you decide it.', '/admin');
          END LOOP;
        END IF;
        v_to_admin := v_to_admin + 1;
      ELSE
        UPDATE public.declutter_handovers SET held_nudged_at = now() WHERE order_id = o.id;
        IF NOT FOUND THEN
          INSERT INTO public.declutter_handovers (order_id, code, held_nudged_at)
          VALUES (o.id, public.declutter_new_handover_code(), now());
        END IF;
        v_closed := public.declutter_held_address_closed(o.id);
        -- The member's own Pickups switch: off means none of this.
        IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = o.buyer_id AND np.declutter_pickups IS FALSE) THEN
          PERFORM public.declutter_pickup_remind(o.buyer_id,
            CASE WHEN v_delivery THEN 'Did your delivery come?' ELSE 'Did you get your item?' END,
            'If you have it, tap "I got it" in Buying. If not, report it there.'
              || CASE WHEN o.paid_with = 'free' THEN '' ELSE ' Your money stays held until one of you says.' END
              || CASE WHEN v_closed THEN ' The pickup address has closed, so ask the seller in your messages.' ELSE '' END,
            '/declutter?tab=buying', o.seller_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = o.seller_id AND np.declutter_pickups IS FALSE) THEN
          PERFORM public.declutter_pickup_remind(o.seller_id,
            CASE WHEN v_delivery THEN 'Did you make this delivery?' ELSE 'Did the buyer get this item?' END,
            CASE WHEN v_delivery THEN 'If you delivered it, mark it delivered in Selling.'
                 WHEN r.handover = 'porch' THEN 'If it''s out, post the porch photo in Selling.'
                 ELSE 'If they have it, tap "Picked up" in Selling.' END
              || CASE WHEN o.paid_with = 'free' THEN '' ELSE ' You aren''t paid until one of you says.' END,
            '/declutter?tab=selling', o.buyer_id);
        END IF;
        v_nudged := v_nudged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_paid', v_auto, 'not_picked_up', v_noshow,
                            'delivery_auto_paid', v_sd_auto, 'delivery_reminders', v_reminders,
                            'no_show_unanswered', v_unanswered, 'held_nudged', v_nudged, 'held_to_admin', v_to_admin,
                            'delivery_never_booked', v_sd_unbooked);
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_close_paid_order(p_order_id uuid, p_reason text, p_strike_side text,
  p_strike_reason text, p_why text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_refund uuid;
  v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out');
  r record;
  v_struck boolean := false;
  v_task public.helpr_tasks;
  v_reserved integer;
  -- Shipping S6 2d: the shipping held back from a buyer-fault refund until the label is voided.
  v_ship integer := 0;
  v_label record;
  -- CHANGED (Q1928 gap 3): the reason the refund is recorded under.
  v_fee_reason text := p_reason;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  -- A free claim (20261027170717) has no payment to refund: it closes, the strike rules still apply.
  IF o.status IS NOT DISTINCT FROM 'paid' AND o.paid_with = 'free' THEN
    UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
    FOR r IN
      UPDATE public.declutter_cart_items c
         SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
       WHERE c.order_id = o.id AND c.status = 'paid'
      RETURNING c.item_id, c.id
    LOOP
      UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
       WHERE id = r.item_id AND status = 'sold';
      IF p_strike_side IS NOT NULL AND NOT v_struck THEN
        -- The callers' words speak of refunds and card fees; a free pickup has neither.
        PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
          p_strike_side, p_strike_reason, r.item_id,
          CASE WHEN p_strike_side = 'seller' THEN 'You did not show up for a booked free Declutter pickup.'
               ELSE 'You missed a booked free Declutter pickup.' END, r.id);
        v_struck := true;
      END IF;
    END LOOP;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Free pickup cancelled',
      'This free pickup was cancelled. Nothing was charged.', '/declutter?view=cart', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Free pickup cancelled',
      CASE WHEN v_seller_fault THEN 'This free pickup was cancelled.'
           ELSE 'This free pickup was cancelled. Your item is back up.' END,
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'cancelled', 'free', true);
  END IF;
  IF o.status IS DISTINCT FROM 'paid' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = o.id) THEN
    RAISE EXCEPTION 'already_paid_out' USING ERRCODE = '55000';
  END IF;
  -- Slice 5: the order's Helpr task.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NOT NULL THEN
    IF v_task.status IN ('picked_up', 'delivered') THEN
      PERFORM public.helpr_task_confirm(v_task.id, 'admin', NULL);
    ELSIF v_task.status IN ('open', 'accepted') THEN
      PERFORM public.helpr_task_close(v_task.id, 'cancelled', p_reason);
    END IF;
  END IF;
  v_reserved := public.declutter_delivery_reserved_cents(o.id);
  -- CHANGED (Q1928 gap 3, lead 11-02): a seller who can no longer sell (declutter_seller_out: banned, suspended, 3
  -- strikes, under 18, flagged business-like) when a paid sale is closed as the buyer's no-show or nobody's fault owes
  -- the card fee, as at payment (owner answer 7): the refund is recorded as seller_out, so the buyer gets every cent
  -- (less a Helpr's delivery reserve) and the fee is the seller's debt. Strikes and the item's status are unchanged.
  IF p_reason IN ('buyer_no_show', 'admin_no_fault') AND public.declutter_seller_out(o.seller_id) THEN
    v_fee_reason := 'seller_out';
  END IF;
  -- CHANGED (Shipping S6 2d, spec 5.3 / section 11 fix 5): a buyer-fault close of a shipped order whose label was bought
  -- refunds everything else now and the SHIPPING only once the label is voided (declutter_ship_refund_after_void). A
  -- seller-fault close still refunds everything now (a rejected void is the seller's debt: 20261102045553).
  IF v_fee_reason IN ('buyer_no_show', 'admin_buyer_fault', 'buyer_cancelled', 'buyer_restarted_checkout') THEN  -- CHANGED (Q1928 gap 3)
    v_ship := COALESCE(public.declutter_shipping_reserved_cents(o.id), 0);
  END IF;
  -- CHANGED (Q1935, restored: 2d was restated from a base before 20261102040952): the card fee prorated to the part
  -- refunded. CHANGED (Q1928 gap 3): recorded under v_fee_reason.
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, v_fee_reason, o.total_cents - v_reserved - v_ship,
    public.declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved));
  UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
     WHERE c.order_id = o.id AND c.status = 'paid'
    RETURNING c.item_id, c.id
  LOOP
    UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
     WHERE id = r.item_id AND status = 'sold';
    -- One strike per order, recorded against its first line.
    IF p_strike_side IS NOT NULL AND NOT v_struck THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
        p_strike_side, p_strike_reason, r.item_id, p_why, r.id);
      v_struck := true;
    END IF;
  END LOOP;
  -- S6 2d: the held-back shipping. A test label not yet handed to the carrier is sent to be voided (the label worker
  -- voids it; the same compare-and-set as requestShipVoid); a live one is paged, never voided by itself. A label
  -- already voided gives the shipping back at once. A rejected void or a parcel already scanned: the buyer keeps no
  -- shipping (spec 5.3).
  IF v_ship > 0 THEN
    SELECT s.id, s.label_state, s.label_mode, s.accepted_at INTO v_label
      FROM public.shipments s WHERE s.declutter_order_id = o.id FOR UPDATE;
    IF v_label.label_state = 'bought' AND v_label.accepted_at IS NULL THEN
      IF v_label.label_mode = 'test' THEN
        UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()
         WHERE id = v_label.id AND label_state = 'bought' AND accepted_at IS NULL;
      ELSE
        PERFORM public.log_cron_defect('declutter_close_paid_order-live-void', o.id::text,
          format('order %s was cancelled on the buyer (%s); its LIVE label must be voided by hand, then the shipping refunded', o.id, p_reason));
      END IF;
    ELSIF v_label.label_state = 'voided' THEN
      PERFORM public.declutter_ship_refund_after_void(o.id);
    END IF;
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN v_seller_fault AND v_reserved > 0
         THEN format('$%s is coming back to your card. What you paid for delivery went to the Helpr who made the trip.',
                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN v_seller_fault
         THEN format('All $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00'))
         -- CHANGED (LEAD-ADMIN-HELPR-FAULT): the Helpr's fault refunds everything, delivery included (the task failed,
         -- so nothing is reserved); it said "The card fee is not refunded".
         WHEN p_reason = 'helpr_fault'
         THEN format('All $%s is coming back to your card, delivery included.', to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         -- S6 2d: the shipping is said apart: it comes back once the label is cancelled.
         -- CHANGED (Q1928 gap 3): an out seller's close gives every cent back (less a Helpr's delivery reserve).
         WHEN v_fee_reason = 'seller_out'
         THEN format('$%s is coming back to your card.', to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') AND v_ship > 0
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card. The $%s for shipping comes back once the shipping label is cancelled.'
                          ELSE 'The item price, $%s, is coming back to your card. The $%s for shipping comes back once the shipping label is cancelled.' END,
                     to_char((o.total_cents - v_reserved - v_ship - o.premium_cents) / 100.0, 'FM999990.00'), to_char(v_ship / 100.0, 'FM999990.00'))
         -- CHANGED (A3-72): a seller delivery nobody set a time for in 7 days: everything back.
         WHEN p_reason = 'delivery_never_booked'
         THEN format('No delivery time was picked within 7 days, so the order is cancelled. All $%s is coming back to your card.',
                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault')
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card.'
                          ELSE 'The item price, $%s, is coming back to your card.' END,
                     to_char((o.total_cents - v_reserved - o.premium_cents) / 100.0, 'FM999990.00'))
         WHEN v_ship > 0
         THEN format('Your refund is on its way. The $%s for shipping comes back once the shipping label is cancelled.', to_char(v_ship / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way.' END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale cancelled',
    CASE WHEN v_seller_fault THEN 'This sale was cancelled and the buyer refunded.'
         -- S6 2d: a shipped sale cancelled before the parcel left: the label is cancelled, so nothing goes in the mail.
         WHEN v_ship > 0 THEN 'This sale was cancelled and the buyer refunded. Don''t ship it: its label is being cancelled. Your item is back on sale.'
         -- CHANGED (A3-72)
         WHEN p_reason = 'delivery_never_booked'
         THEN 'No delivery time was picked within 7 days, so this sale was cancelled and the buyer refunded. Your item is back on sale.'
         ELSE 'This sale was cancelled and the buyer refunded. Your item is back on sale.' END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$
;

REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_on_payment_escrowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_member uuid;
  v_confirm_by timestamptz;
BEGIN
  -- Q1995: a cancelled (or completed) job promoted to escrow by a late bank settlement is refunded within the hour
  -- (void-cancelled-payments Part A); nobody is told their money is held for a job that is over.
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow')
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling'
     AND COALESCE(NEW.status::text, '') NOT IN ('cancelled', 'completed') THEN
    v_title := 'Payment secured';
    v_msg := 'Your payment for "' || NEW.title || '" is safely held and will be released after the job is completed.';

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.customer_id;

    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id, v_title, v_msg, 'financial_alerts', '/posts?job=' || NEW.id::text);
      PERFORM public.log_notification(NEW.customer_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.id);
    END IF;

    -- Also notify helper their job is funded
    IF NEW.helper_id IS NOT NULL THEN
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = NEW.helper_id;
      IF COALESCE(v_pref, true) THEN
        -- A3-38: the Helpr's next step is the day-before confirm, owed until CONFIRM_DEADLINE_HOURS_BEFORE_START
        -- before the start (confirmDeadlineMs; a start with no time is midnight, as the sweep reads it). Not
        -- "Get to work!": the work may be days away. Already confirmed, or that instant passed: no next step.
        IF NEW.date_needed IS NOT NULL THEN
          v_confirm_by := ((NEW.date_needed + COALESCE(NEW.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago')
                          - interval '2 hours';
        END IF;
        v_msg := 'Payment for "' || NEW.title || '" is held.'
          || CASE WHEN NEW.helper_confirmed_at IS NULL AND v_confirm_by > now()
                  THEN ' Next: confirm you''ll be there by '
                       || to_char(v_confirm_by AT TIME ZONE 'America/Chicago', 'Dy, Mon FMDD "at" FMHH12:MI AM') || '.'
                  ELSE '' END;
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.helper_id, 'Job funded', v_msg, 'financial_alerts', '/jobs?job=' || NEW.id::text);
        PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Job funded', NEW.id);
      END IF;
    END IF;
  END IF;

  -- Payout released
  IF NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released' AND NEW.helper_id IS NOT NULL
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN
    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;
    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (NEW.helper_id, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
    END IF;
  END IF;

  -- A crew (Q407): the payout fan-out releases the job once EVERY member is
  -- paid, so every member hears it, each on their own preference.
  IF NEW.is_group_job IS TRUE
     AND NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released'
     AND OLD.payment_status IS DISTINCT FROM 'chargeback'
     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN
    FOR v_member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE g.job_id = NEW.id AND g.helper_id IS NOT NULL
    LOOP
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = v_member;
      IF COALESCE(v_pref, true) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (v_member, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
        PERFORM public.log_notification(v_member, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$
;

REVOKE ALL ON FUNCTION public.notify_on_payment_escrowed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_payment_escrowed() TO service_role;
