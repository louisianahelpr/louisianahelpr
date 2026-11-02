-- A3-72 (audit 11-01; lead decisions 11-01 5:34 PM and 9:05 PM): a seller-delivered order that lost its time
-- ("needs a time": the slot went to another buyer when the payment landed) had no deadline. Every sweep branch
-- joined only d.status = 'booked', so the order could sit paid forever with nobody told.
-- WHAT THIS DOES (the pickup orders' 7-day rule, B117's 20261101230519, extended):
--   1. declutter_refunds.reason allows 'delivery_never_booked' (the reason -> policy CHECK restated unchanged beside it). declutter_record_refund's ELSE branch gives it
--      'full_platform_absorbs': the buyer's full payment back (item, delivery, buyer fee, tax). The platform absorbs the
--      card fee: no seller debt.
--   2. declutter_orders_set_book_by also sets book_by = paid_at + 7 days on a seller-delivered order. Backfill: open
--      paid seller-delivered orders; one that already has no time gets at least 48 hours from this migration.
--   3. declutter_paid_next_step: "Next: pick a new delivery time in Buying, by <book_by>."
--   4. declutter_book_by_reminder_sweep: a needs_time seller delivery reminds BOTH sides, 24 h and 2 h before book_by,
--      saying the order is cancelled and the full payment refunded at the mark. Pickups are unchanged (buyer only).
--   5. declutter_close_paid_order: the two notices for 'delivery_never_booked' say why (money path verbatim).
--   6. declutter_handover_sweep: new loop (b2) closes a needs_time seller delivery at book_by through
--      declutter_close_paid_order(order, 'delivery_never_booked', NULL strike side); the order's refund turns the
--      delivery row 'cancelled' (declutter_seller_delivery_on_order). An open problem holds it. Every other loop is byte-for-byte as in 20261031181404.
-- MONEY: one new refund reason on the existing refund path (amount = total_cents - reserved, as every close). AUTHZ: no
-- new member-callable function; every restated function keeps its grants (service_role only).
-- REPLAY-SAFE: the CHECK is dropped and re-added in one DO block; CREATE OR REPLACE; the backfill touches only NULLs.
-- Proof: src/test/pglite/declutterSellerDeliveryBookBy.pglite.mjs.

DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_reason_check
  -- ACK-REASON: re-added on the next line with every reason it allowed (newest: 20261031231150) plus 'delivery_never_booked'; the column is never unchecked once this block commits.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten, and every existing row's reason is still in the new list.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_reason_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_reason_check CHECK (reason IN (
    'superseded', 'order_closed', 'amount_mismatch', 'duplicate_payment', 'order_missing', 'sold_elsewhere',
    'seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described',
    'buyer_cancelled', 'buyer_restarted_checkout',
    'buyer_no_show', 'admin_buyer_fault', 'admin_no_fault',
    'delivery_damage', 'refund_request_full', 'refund_request_part',
    'helpr_fault',
    'delivery_never_booked'));   -- A3-72: everything back; the platform absorbs the card fee
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_policy
  -- ACK-REASON: re-added on the next line with the same mapping as 20261031231150; 'delivery_never_booked' is in no list, so it takes the ELSE (full_platform_absorbs), as declutter_record_refund's own CASE gives it.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten, and no existing row has reason 'delivery_never_booked', so every row still validates.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_policy;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_policy CHECK (
    fee_policy = CASE WHEN reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault') THEN 'full_seller_pays_fee'
                      WHEN reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'refund_request_full') THEN 'keep_card_fee'
                      WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                      WHEN reason = 'refund_request_part' THEN 'agreed_part'
                      ELSE 'full_platform_absorbs' END);
END;
$do$;

-- 1. (the CHECK above)

-- 2. Restated from 20261101230519_declutter_book_by.sql (its newest definition).
CREATE OR REPLACE FUNCTION public.declutter_orders_set_book_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status = 'paid' AND NEW.handover IN ('porch', 'pickup_home', 'meetup', 'seller_delivery')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') AND NEW.book_by IS NULL THEN
    -- The same expression as the handover sweep's no-show cutoff (o2.paid_at + interval '7 days'), so they never drift.
    -- CHANGED (A3-72, lead 11-01 5:34 PM): a seller-delivered order gets the same mark; the sweep closes it at book_by
    -- only while its delivery has no time (needs_time).
    NEW.book_by := COALESCE(NEW.paid_at, now()) + interval '7 days';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_set_book_by() FROM PUBLIC, anon, authenticated;

-- Backfill: paid seller-delivered orders still open. One whose delivery has no time today is given at least 48 hours
-- from this migration (so both reminders can go out before the sweep closes it); the rest get paid + 7 days.
UPDATE public.declutter_orders o
   SET book_by = CASE WHEN EXISTS (SELECT 1 FROM public.declutter_seller_deliveries d WHERE d.order_id = o.id AND d.status = 'needs_time')
                      THEN greatest(o.paid_at + interval '7 days', now() + interval '48 hours')
                      ELSE o.paid_at + interval '7 days' END
 WHERE o.book_by IS NULL AND o.status = 'paid' AND o.paid_at IS NOT NULL AND o.handover = 'seller_delivery';

-- 3. Restated from 20261101230519_declutter_book_by.sql (its newest definition).
CREATE OR REPLACE FUNCTION public.declutter_paid_next_step(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN o.handover = 'delivery' THEN
      'Next: we''re finding a Helpr to bring it to your door. We''ll tell you when one takes it.'
    WHEN o.handover = 'ship' THEN
      'Next: the seller ships it. We''ll tell you when it''s on the way.'
    WHEN o.handover = 'seller_delivery' THEN
      CASE WHEN EXISTS (SELECT 1 FROM public.declutter_seller_deliveries d
                         WHERE d.order_id = o.id AND d.status = 'booked' AND d.slot_start IS NOT NULL)
           THEN 'Next: the seller delivers at the time you chose.'
           -- CHANGED (A3-72): no time yet says by when, as a pickup does.
           ELSE 'Next: pick a new delivery time in Buying'
             || COALESCE(', by ' || to_char(o.book_by AT TIME ZONE 'America/Chicago', 'Dy FMMM/FMDD, FMHH12:MI AM'), '') || '.' END
    WHEN EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
      CASE WHEN o.pickup_slot_start IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.declutter_bookings b
                             WHERE b.order_id = o.id AND b.slot_start = o.pickup_slot_start) THEN
             CASE o.handover
               WHEN 'porch' THEN 'Pickup ' || public.declutter_pickup_when(o.id) || ' · porch.'
               WHEN 'meetup' THEN 'Meet ' || public.declutter_pickup_when(o.id)
                 || COALESCE(' at ' || (SELECT m.spot_name FROM public.declutter_order_meetups m WHERE m.order_id = o.id), '') || '.'
               ELSE 'Pickup ' || public.declutter_pickup_when(o.id) || ' · at the door.' END
           ELSE 'Next: pick up your items at the time you chose.' END
    ELSE 'Next: choose your pickup time in Buying'
      || COALESCE(', by ' || to_char(o.book_by AT TIME ZONE 'America/Chicago', 'Dy FMMM/FMDD, FMHH12:MI AM'), '') || '.'
  END
  FROM public.declutter_orders o
  WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_paid_next_step(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_paid_next_step(uuid) TO service_role;

-- 4. Restated from 20261101230519_declutter_book_by.sql (its newest definition).
CREATE OR REPLACE FUNCTION public.declutter_book_by_reminder_sweep(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_sent integer := 0;
  v_last boolean;
  v_what text;
  v_more integer;
  v_by text;
  v_step text;
BEGIN
  -- Quiet hours (9 PM-8 AM Central): nothing is sent; a 24-hour reminder still due at 8 AM goes then.
  IF extract(hour FROM (p_now AT TIME ZONE 'America/Chicago')) >= 21
     OR extract(hour FROM (p_now AT TIME ZONE 'America/Chicago')) < 8 THEN
    RETURN 0;
  END IF;
  FOR r IN
    SELECT o.id, o.buyer_id, o.seller_id, o.handover, o.book_by
      FROM public.declutter_orders o
     WHERE o.status = 'paid'
       -- CHANGED (A3-72): a seller-delivered order whose delivery has no time (needs_time) is reminded too.
       AND (   (o.handover IN ('porch', 'pickup_home', 'meetup')
                AND NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL))
            OR (o.handover = 'seller_delivery'
                AND EXISTS (SELECT 1 FROM public.declutter_seller_deliveries d WHERE d.order_id = o.id AND d.status = 'needs_time')))
       AND o.book_by IS NOT NULL
       AND o.book_by > p_now
       AND o.book_by <= p_now + interval '24 hours'
       AND ((o.book_by > p_now + interval '2 hours' AND o.book_by_reminded_24_at IS NULL)
            OR (o.book_by <= p_now + interval '2 hours' AND o.book_by_reminded_2_at IS NULL))
     ORDER BY o.book_by
       FOR UPDATE OF o SKIP LOCKED
  LOOP
   BEGIN
    v_last := r.book_by <= p_now + interval '2 hours';
    -- Claim first: one reminder per edge, even if two sweeps overlap. Inside the 2-hour edge both marks are set,
    -- so a 24-hour reminder missed in quiet hours is never sent after the 2-hour one.
    IF v_last THEN
      UPDATE public.declutter_orders SET book_by_reminded_2_at = p_now, book_by_reminded_24_at = COALESCE(book_by_reminded_24_at, p_now)
       WHERE id = r.id AND book_by_reminded_2_at IS NULL;
    ELSE
      UPDATE public.declutter_orders SET book_by_reminded_24_at = p_now
       WHERE id = r.id AND book_by_reminded_24_at IS NULL;
    END IF;
    CONTINUE WHEN NOT FOUND;

    SELECT (array_agg(i.title ORDER BY c.created_at, c.id))[1], count(*) - 1
      INTO v_what, v_more
      FROM public.declutter_cart_items c
      JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.order_id = r.id;
    v_what := COALESCE(NULLIF(btrim(v_what), ''), 'your Declutter item')
              || CASE WHEN COALESCE(v_more, 0) > 0 THEN format(' and %s more', v_more) ELSE '' END;
    v_by := to_char(r.book_by AT TIME ZONE 'America/Chicago', 'Dy FMMM/FMDD, FMHH12:MI AM');
    IF r.handover = 'seller_delivery' THEN
      -- CHANGED (A3-72, lead 11-01 5:34 PM + 9:05 PM): BOTH sides, and what happens at the mark: the handover sweep
      -- closes the order and refunds the buyer's full payment (item, delivery, fee and tax). Nobody gets a strike.
      PERFORM public.declutter_pickup_remind(r.buyer_id,
        CASE WHEN v_last THEN 'Pick a delivery time: 2 hours left'
             ELSE 'Pick a delivery time by ' || to_char(r.book_by AT TIME ZONE 'America/Chicago', 'Dy FMHH12:MI AM') END,
        format('Pick a delivery time for %s by %s, or the order is cancelled and your full payment is refunded. Open your order in Buying.',
               v_what, v_by),
        '/declutter?tab=buying', r.seller_id);
      PERFORM public.declutter_pickup_remind(r.seller_id,
        CASE WHEN v_last THEN 'No delivery time yet: 2 hours left' ELSE 'The buyer hasn''t picked a delivery time' END,
        format('The buyer has until %s to pick a delivery time for %s, or the order is cancelled and their full payment is refunded. Message them from the order in Selling.',
               v_by, v_what),
        '/declutter?tab=selling', r.buyer_id);
    ELSE
      v_step := CASE r.handover WHEN 'meetup' THEN 'book a time to meet' WHEN 'porch' THEN 'pick a pickup time'
                                ELSE 'book a pickup time' END;
      PERFORM public.declutter_pickup_remind(r.buyer_id,
        CASE WHEN v_last THEN 'Pick a pickup time: 2 hours left'
             ELSE 'Pick a pickup time by ' || to_char(r.book_by AT TIME ZONE 'America/Chicago', 'Dy FMHH12:MI AM') END,
        -- Lead 11-01 5:31 PM: the deadline is honest. At paid + 7 days the handover sweep closes an unbooked order as a
        -- buyer no-show and refunds the item price (20261031181404 loop (b)), so the reminder says so.
        format('%s for %s by %s, or the order is cancelled and the item price refunded. Open your order in Buying.',
               upper(left(v_step, 1)) || substr(v_step, 2), v_what, v_by),
        '/declutter?tab=buying', r.seller_id);
    END IF;
    v_sent := v_sent + 1;
   EXCEPTION WHEN OTHERS THEN
    -- This order's claim rolls back with the block's savepoint, so the next run tries it again; the others go on.
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'declutter book-by reminder failed for one order',
            jsonb_build_object('source', 'declutter_book_by_reminder_sweep', 'order_id', r.id::text),
            jsonb_build_object('error', SQLERRM));
   END;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_book_by_reminder_sweep(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_book_by_reminder_sweep(timestamptz) TO service_role;

-- 5. Restated from 20261101000817_declutter_admin_helpr_fault.sql (its newest definition).
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
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents - v_reserved, o.card_fee_cents);
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
         -- CHANGED (A3-72): a seller delivery nobody set a time for in 7 days: everything back.
         WHEN p_reason = 'delivery_never_booked'
         THEN format('No delivery time was picked within 7 days, so the order is cancelled. All $%s is coming back to your card.',
                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault')
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card.'
                          ELSE 'The item price, $%s, is coming back to your card.' END,
                     to_char((o.total_cents - v_reserved - o.premium_cents) / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way.' END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale cancelled',
    CASE WHEN v_seller_fault THEN 'This sale was cancelled and the buyer refunded.'
         -- CHANGED (A3-72)
         WHEN p_reason = 'delivery_never_booked'
         THEN 'No delivery time was picked within 7 days, so this sale was cancelled and the buyer refunded. Your item is back on sale.'
         ELSE 'This sale was cancelled and the buyer refunded. Your item is back on sale.' END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) TO service_role;

-- 6. Restated from 20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql (its newest definition).
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
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Delivery coming up',
          format('You deliver to %s on %s.', r.dropoff_area, public.declutter_delivery_when(r.slot_start)),
          '/declutter?tab=selling', r.buyer_id);
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Delivery coming up',
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
$function$;
REVOKE ALL ON FUNCTION public.declutter_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO service_role;
