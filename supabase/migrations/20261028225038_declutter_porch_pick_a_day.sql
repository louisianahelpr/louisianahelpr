-- Declutter porch pickup is a DAY, not a time (owner 2026-10-28: "make porch just pick a day but they
-- also need to know once it's on the porch so they don't show up and it's not there").
--
-- The buyer of a porch order picks one of the seller's pickup DAYS (a weekday with a pickup window, from
-- today until the 7-day pickup deadline). The item is out all that day once the seller posts the "on the
-- porch" photo; that photo's notice ("It's on the porch: pick it up today") is the buyer's signal, and the
-- buyer does not go before it.
--
-- Layers changed here (each named, the rest untouched):
--   1. declutter_bookings.pickup_day (new, nullable): the porch DAY. A day booking keeps the table's own slot
--      shape (slot_start = 00:00 Louisiana that day, slot_end = +30 min: declutter_bookings_slot is not
--      loosened) with porch_mode 'all_day'.
--   2. trg_declutter_bookings_day_follows_slot: any other write that moves or clears the slot (an installed
--      app build still moves a porch pickup by TIME through declutter_book_pickup; a buyer no-show clears it)
--      clears pickup_day, so a day never outlives its slot.
--   3. declutter_pickup_anchor(slot_start, pickup_day): when a booked pickup is "over" for the money rules:
--      the END of a porch day, else the slot start (unchanged for every booked time).
--   4. declutter_porch_days(order) (new; the buyer or seller of a paid porch order): the days that may be
--      picked. declutter_book_porch_day(order, day) (new): books or moves the day with declutter_book_pickup's
--      own rules (the buyer books, moves once, rebooks once after a missed pickup; the seller moves once after
--      it is booked), and never once the item is out. A day is marked reminded at booking: the 1-hour reminder
--      is for a TIME, and the porch photo's notice is the day's signal.
--   5. declutter_report_no_show: the buyer's "the seller never put it out" opens when the porch DAY is over
--      (was slot start + 15 min, which for a day would be 00:15). A booked time is unchanged.
--   6. declutter_handover_sweep: the porch / pickup auto-pay (row 99) is 24 h after declutter_pickup_anchor:
--      for a porch day, 24 h after the day ends (still only with the porch photo in and no open problem).
--   7. declutter_porch_photo: the buyer's "it's out" notice reads "It's on the porch: pick it up today",
--      the Declutter Pickups switch, opens Buying. Its checks and money path are verbatim.
--   8. declutter_paid_next_step (#26): a paid porch order says "Next: choose your pickup day in Buying."
-- declutter_book_pickup, declutter_set_porch_time and the reminder sweep are NOT changed. Money: the auto-pay
-- timer (6) moves later for a day, never earlier.
--
-- Rebuilt by builder 1 from the stopped builder's wip/b1-porch-check (492f4fc064, migration 20261028175725):
-- 1-4 are its new objects verbatim; 5-8 are restated from their EFFECTIVE definitions (the WIP had restated
-- raw text, which would have undone 20261027172503's no-fee-words rewrite and #37's ?tab= links):
--   declutter_report_no_show from 20261015042253_declutter_slice4_handover_payout.sql as rewritten by 20261027172503_declutter_notices_name_no_fee.sql
--   declutter_handover_sweep from 20261028223036_declutter_notice_links_open_the_right_tab.sql
--   declutter_porch_photo from 20261017055502_declutter_handover_private_bucket.sql
--   declutter_paid_next_step from 20261028204431_declutter_paid_notice_next_step.sql
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS, DROP TRIGGER IF EXISTS, CREATE OR REPLACE.
-- Proof: src/test/pglite/declutterPorchPickADay.pglite.mjs (applied 3x). Guard: src/test/declutterPorchPickADay.test.ts.

-- 1. The day.
ALTER TABLE public.declutter_bookings ADD COLUMN IF NOT EXISTS pickup_day date;
COMMENT ON COLUMN public.declutter_bookings.pickup_day IS
  'Porch pickup DAY (owner 2026-10-28): set by declutter_book_porch_day; slot_start is 00:00 Louisiana that day. NULL for a booked time.';

-- 2. A day never outlives its slot.
CREATE OR REPLACE FUNCTION public.declutter_bookings_day_follows_slot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.slot_start IS DISTINCT FROM OLD.slot_start AND NEW.pickup_day IS NOT DISTINCT FROM OLD.pickup_day THEN
    NEW.pickup_day := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_bookings_day_follows_slot() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_bookings_day_follows_slot ON public.declutter_bookings;
CREATE TRIGGER trg_declutter_bookings_day_follows_slot
  BEFORE UPDATE ON public.declutter_bookings
  FOR EACH ROW EXECUTE FUNCTION public.declutter_bookings_day_follows_slot();

-- 3. When a booked pickup is over, for the money rules.
CREATE OR REPLACE FUNCTION public.declutter_pickup_anchor(p_slot_start timestamptz, p_pickup_day date)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_pickup_day IS NOT NULL
              THEN ((p_pickup_day + 1)::timestamp AT TIME ZONE 'America/Chicago')
              ELSE p_slot_start END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pickup_anchor(timestamptz, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pickup_anchor(timestamptz, date) TO service_role;

-- 4a. The days the buyer may pick: today (Louisiana) until the 7-day pickup deadline, on the seller's
--     pickup weekdays. Only the order's buyer; only a paid porch order.
CREATE OR REPLACE FUNCTION public.declutter_porch_days(p_order_id uuid)
RETURNS SETOF date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL OR public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT d::date
      FROM generate_series(v_today, v_today + 7, interval '1 day') d
     WHERE (d::date::timestamp AT TIME ZONE 'America/Chicago') < o.paid_at + interval '7 days'
       AND EXISTS (SELECT 1 FROM public.declutter_pickup_windows w
                    WHERE w.seller_id = o.seller_id AND w.weekday = extract(dow FROM d::date)::smallint)
     ORDER BY 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_porch_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_days(uuid) TO authenticated, service_role;

-- 4b. Book or move the porch day.
CREATE OR REPLACE FUNCTION public.declutter_book_porch_day(p_order_id uuid, p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  v_side text;
  v_kind text;
  v_start timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_day IS NULL OR p_day < (now() AT TIME ZONE 'America/Chicago')::date
     OR (p_day::timestamp AT TIME ZONE 'America/Chicago') >= o.paid_at + interval '7 days' THEN
    RAISE EXCEPTION 'invalid_day' USING ERRCODE = '22023',
      HINT = 'Pick a day from today until the 7-day pickup deadline.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_pickup_windows w
                  WHERE w.seller_id = o.seller_id AND w.weekday = extract(dow FROM p_day)::smallint) THEN
    RAISE EXCEPTION 'invalid_day' USING ERRCODE = '22023', HINT = 'Pick one of the seller''s pickup days.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'seller_set_out' USING ERRCODE = '55000', HINT = 'The item is already out on the porch.';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  -- declutter_book_pickup's own rules, for a day.
  IF v_side = 'buyer' THEN
    IF b.order_id IS NULL THEN
      v_kind := 'booked';
    ELSIF b.slot_start IS NULL THEN
      IF b.buyer_rebooked THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000';
      END IF;
      v_kind := 'rebooked';
    ELSE
      IF b.buyer_reschedules >= 1 THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
      END IF;
      v_kind := 'rescheduled';
    END IF;
  ELSE
    IF b.order_id IS NULL OR b.slot_start IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'The buyer picks the day first.';
    END IF;
    IF b.seller_reschedules >= 1 THEN
      RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
    END IF;
    v_kind := 'seller_rescheduled';
  END IF;
  v_start := p_day::timestamp AT TIME ZONE 'America/Chicago';
  IF b.order_id IS NULL THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end, porch_mode, pickup_day, reminded_slot_start)
    VALUES (o.id, o.buyer_id, o.seller_id, v_start, v_start + interval '30 minutes', 'all_day', p_day, v_start);
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
  ELSE
    UPDATE public.declutter_bookings
       SET slot_start = v_start, slot_end = v_start + interval '30 minutes', pickup_day = p_day,
           porch_mode = 'all_day', porch_until = NULL, reminded_slot_start = v_start, updated_at = now(),
           buyer_reschedules = buyer_reschedules + CASE WHEN v_kind = 'rescheduled' THEN 1 ELSE 0 END,
           seller_reschedules = seller_reschedules + CASE WHEN v_kind = 'seller_rescheduled' THEN 1 ELSE 0 END,
           buyer_rebooked = buyer_rebooked OR v_kind = 'rebooked'
     WHERE order_id = o.id;
  END IF;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'declutter_pickups',
    CASE v_kind WHEN 'booked' THEN 'Porch pickup day booked' ELSE 'Porch pickup day changed' END,
    CASE WHEN v_side = 'buyer'
         THEN format('The buyer picks it up from your porch on %s. Put it out that day and post the porch photo.', to_char(p_day, 'FMDay, Mon FMDD'))
         ELSE format('Your porch pickup is now on %s. We''ll tell you when it''s out.', to_char(p_day, 'FMDay, Mon FMDD')) END,
    CASE WHEN v_side = 'buyer' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END,
    v_uid);
  RETURN jsonb_build_object('result', v_kind, 'pickup_day', p_day);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_book_porch_day(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_book_porch_day(uuid, date) TO authenticated, service_role;

-- 5. The buyer's "the seller never put it out" waits for the end of a porch day.
CREATE OR REPLACE FUNCTION public.declutter_report_no_show(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  h public.declutter_handovers;
  v_side text;
  v_from timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  IF b.order_id IS NULL OR b.slot_start IS NULL THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  -- A porch DAY (20261028225038): the seller has all day to put it out, so the buyer's report opens when the day
  -- ends (declutter_pickup_anchor); a booked time keeps its 15 minutes.
  v_from := CASE WHEN b.pickup_day IS NOT NULL THEN public.declutter_pickup_anchor(b.slot_start, b.pickup_day)
                 ELSE b.slot_start + interval '15 minutes' END;
  IF o.handover = 'porch' AND v_side = 'seller' THEN
    IF h.picked_up_at IS NOT NULL THEN
      RAISE EXCEPTION 'already_picked_up' USING ERRCODE = '55000';
    END IF;
    v_from := COALESCE(b.porch_until,
      ((b.slot_start AT TIME ZONE 'America/Chicago')::date + 1)::timestamp AT TIME ZONE 'America/Chicago');
  ELSIF o.handover = 'porch' AND v_side = 'buyer' AND h.set_out_at IS NOT NULL THEN
    RAISE EXCEPTION 'seller_set_out' USING ERRCODE = '55000',
      HINT = 'The seller set the item out. If it is not there, report a problem.';
  END IF;
  IF now() < v_from THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000',
      HINT = CASE WHEN b.pickup_day IS NOT NULL THEN 'Wait until the pickup day is over.' ELSE 'Wait 15 minutes after the booked time.' END;
  END IF;
  IF v_side = 'buyer' THEN
    RETURN public.declutter_close_paid_order(o.id, 'seller_no_show', 'seller', 'seller_no_show',
      'You did not show up for a booked Declutter pickup. The buyer got everything back; the cost of that refund comes out of your next Declutter payout.');
  END IF;
  IF b.buyer_missed_at IS NULL AND now() + interval '30 minutes' <= o.paid_at + interval '7 days' THEN
    UPDATE public.declutter_bookings
       SET buyer_missed_at = now(), slot_start = NULL, slot_end = NULL, porch_mode = NULL, porch_until = NULL, updated_at = now()
     WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'warning', 'You missed your pickup',
      'The seller says you did not show up. You can book one new time before your 7-day pickup deadline. Miss again and the sale is cancelled with a strike.',
      '/declutter?view=cart', o.seller_id);
    RETURN jsonb_build_object('result', 'buyer_may_rebook');
  END IF;
  RETURN public.declutter_close_paid_order(o.id, 'buyer_no_show', 'buyer', 'not_picked_up',
    'You missed a booked Declutter pickup again. The item price was refunded.');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_report_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_report_no_show(uuid) TO authenticated, service_role;

-- 6. The porch / pickup auto-pay is 24 h after a porch day ends.
CREATE OR REPLACE FUNCTION public.declutter_handover_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  o public.declutter_orders;
  v_auto integer := 0;
  v_noshow integer := 0;
  v_sd_auto integer := 0;
  v_reminders integer := 0;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_h integer;
BEGIN
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery') AND b.slot_start IS NOT NULL AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
       AND (o2.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                               WHERE h.order_id = o2.id AND h.set_out_photo_path IS NOT NULL))
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL
                       AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now())
         -- Porch (owner 2026-10-18): no "Left on porch" photo, no auto-pay.
         AND (o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                                WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL)) THEN
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
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery') AND o2.paid_at + interval '7 days' <= now()
       AND (b.order_id IS NULL OR b.slot_start IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery')
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
      SELECT min(x::integer) INTO v_h FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
       WHERE r.slot_start <= now() + make_interval(hours => x::integer)
         AND NOT x::integer = ANY (r.reminded_hours);
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
  RETURN jsonb_build_object('auto_paid', v_auto, 'not_picked_up', v_noshow,
                            'delivery_auto_paid', v_sd_auto, 'delivery_reminders', v_reminders);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO service_role;

-- 7. The "it's out" notice is the day's signal.
CREATE OR REPLACE FUNCTION public.declutter_porch_photo(p_order_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_m integer;
  v_done jsonb;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' AND o.handover = 'porch' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  IF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF v_side = 'seller' THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now() WHERE order_id = o.id;
    -- The buyer's signal to go (20261028225038): its own title, the Pickups switch, Buying.
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'It''s on the porch: pick it up today',
      'The seller put your item out. Take a photo when you pick it up.', '/declutter?tab=buying', o.seller_id);
    RETURN jsonb_build_object('result', 'set_out');
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  -- Haversine, metres, to the NEAREST pickup point of ANY item in the order
  -- (authz review 2.7: the exact address is per item, so a multi-item order
  -- may have more than one; the first item alone refused a buyer standing at
  -- another item's address).
  SELECT min(round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat - p.pickup_lat) / 2)), 2)
           + cos(radians(p.pickup_lat)) * cos(radians(p_lat)) * power(sin(radians((p_lng - p.pickup_lng) / 2)), 2)))))::integer)
    INTO v_m
    FROM public.declutter_cart_items c
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.order_id = o.id AND p.pickup_lat IS NOT NULL AND p.pickup_lng IS NOT NULL;
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  UPDATE public.declutter_handovers
     SET picked_up_photo_path = p_photo_path, picked_up_at = now(), picked_up_distance_m = v_m
   WHERE order_id = o.id;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Your item was picked up',
      'The buyer picked up the item from your porch. A problem report is open, so Louisiana Helpr decides before anyone is paid.',
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', false);
  END IF;
  v_done := public.declutter_complete_handover(o.id, 'porch');
  RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', true, 'payout_id', v_done->'payout_id');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) TO authenticated, service_role;

-- 8. The paid notice says a porch pickup is a day.
CREATE OR REPLACE FUNCTION public.declutter_paid_next_step(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN o.handover = 'delivery' THEN
      'Next: we''re finding a Helpr to bring it to your door. We''ll tell you when one takes it.'
    WHEN o.handover = 'seller_delivery' THEN
      CASE WHEN EXISTS (SELECT 1 FROM public.declutter_seller_deliveries d
                         WHERE d.order_id = o.id AND d.status = 'booked' AND d.slot_start IS NOT NULL)
           THEN 'Next: the seller delivers at the time you chose.'
           ELSE 'Next: pick a new delivery time in Buying.' END
    WHEN EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
      'Next: pick up your items at the time you chose.'
    WHEN o.handover = 'porch' THEN 'Next: choose your pickup day in Buying.'
    ELSE 'Next: choose your pickup time in Buying.'
  END
  FROM public.declutter_orders o
  WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_paid_next_step(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_paid_next_step(uuid) TO service_role;
