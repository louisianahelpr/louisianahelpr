-- B117 (lead decision 11-01 5:01 PM, A3-18 / A3-19; A3-50 correction): a paid Declutter pickup says WHEN.
--   * Time chosen at checkout (B110, declutter_orders.pickup_slot_start/end) and booked: cards and the "Payment
--     received" notice show it ("Pickup Sat 11/2, 3–5 PM · porch"), with no "by".
--   * No time yet (the old path, or a checkout time already past when the payment landed): the order carries
--     book_by, the cards say "· by <book_by>", and the buyer is reminded 24 hours and 2 hours before it.
--   * NOTHING is cancelled at book_by (owner Q2477: paid orders are never cancelled). This migration only stores a
--     date, words and reminders.
-- The ONE number (A3-50): a paid order's pickup must be booked within 7 days of paying. It is the rule already in
-- force in declutter_book_pickup / declutter_order_pickup_windows (20261031145652: slot end <= paid_at + 7 days) and
-- in the help centre ("within 7 days of paying"). 48 hours is only the FREE claim's hold before checkout
-- (20261101030040), which is not a paid order and is not touched here.
--
-- 1. declutter_orders.book_by (+ book_by_reminded_24_at / book_by_reminded_2_at): set by a BEFORE trigger on the
--    row that turns status to 'paid' (declutter_mark_order_paid's UPDATE, a free pick's INSERT), for the pickup
--    kinds only (porch, pickup_home, meetup): paid_at + 7 days. Set for every such order, booked or not: the
--    screens show it only while nothing is booked. Backfilled for paid pickup orders still open.
--    Read by the two sides through a column grant (the table's SELECT is per column since 20261027170717).
-- 2. declutter_pickup_when (service_role): "Sat 11/2, 3–5 PM" for a porch window, "Sat 11/2, 3:30 PM" otherwise.
-- 3. declutter_paid_next_step, restated from its newest CREATE (20261031163021_declutter_porch_next_step_is_a_time):
--    booked at the checkout time -> "Pickup <when> · porch." / "Meet <when> at <spot>."; not booked -> the old
--    words plus ", by <book_by>"; a SHIP order now says the seller ships it (it fell through to "choose your pickup
--    time", b114 handoff). Every other branch verbatim.
-- 4. declutter_book_by_reminder_sweep (service_role) + cron 'declutter-book-by-reminders' every 10 minutes: an
--    unbooked paid pickup order gets one reminder in [book_by - 24 h, book_by - 2 h) and one in [book_by - 2 h,
--    book_by), each claimed on the row before it is sent; none between 9 PM and 8 AM Central (the owner's quiet
--    hours for reminders, 11-01 12:19 PM). Bell + push + email through declutter_pickup_remind.
--
-- MONEY: none (no amount, fee, refund, status or payout changes; mark_order_paid is not restated). AUTHZ: no new
-- member-callable function; three new columns readable by the order's own two sides (the existing row policy).
-- REPLAY-SAFE: IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS, cron.schedule by name, idempotent backfill.
-- Proof: src/test/pglite/declutterBookBy.pglite.mjs.

ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS book_by timestamptz;
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS book_by_reminded_24_at timestamptz;
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS book_by_reminded_2_at timestamptz;
COMMENT ON COLUMN public.declutter_orders.book_by IS
  'B117 (A3-18/19/50): the time by which a paid pickup order should be booked: paid_at + 7 days, the rule declutter_book_pickup enforces. Shown while nothing is booked; reminders 24 h and 2 h before. Nothing is cancelled at it (Q2477).';

GRANT SELECT (book_by, pickup_slot_start, pickup_slot_end) ON TABLE public.declutter_orders TO authenticated;

CREATE OR REPLACE FUNCTION public.declutter_orders_set_book_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status = 'paid' AND NEW.handover IN ('porch', 'pickup_home', 'meetup')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') AND NEW.book_by IS NULL THEN
    NEW.book_by := COALESCE(NEW.paid_at, now()) + interval '7 days';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_set_book_by() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS declutter_orders_set_book_by ON public.declutter_orders;
CREATE TRIGGER declutter_orders_set_book_by
  BEFORE INSERT OR UPDATE OF status ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_orders_set_book_by();

-- Backfill: paid pickup orders still open. Idempotent (only rows with no book_by).
UPDATE public.declutter_orders
   SET book_by = paid_at + interval '7 days'
 WHERE book_by IS NULL AND status = 'paid' AND paid_at IS NOT NULL
   AND handover IN ('porch', 'pickup_home', 'meetup');

CREATE OR REPLACE FUNCTION public.declutter_pickup_when(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  a timestamp;
  b timestamp;
  v_a text;
  v_b text;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL OR o.pickup_slot_start IS NULL THEN
    RETURN NULL;
  END IF;
  a := o.pickup_slot_start AT TIME ZONE 'America/Chicago';
  b := o.pickup_slot_end AT TIME ZONE 'America/Chicago';
  IF o.handover <> 'porch' THEN
    RETURN to_char(a, 'Dy FMMM/FMDD') || ', ' || to_char(a, 'FMHH12:MI AM');
  END IF;
  v_a := to_char(a, 'FMHH12') || CASE WHEN extract(minute FROM a) <> 0 THEN to_char(a, ':MI') ELSE '' END;
  v_b := to_char(b, 'FMHH12') || CASE WHEN extract(minute FROM b) <> 0 THEN to_char(b, ':MI') ELSE '' END;
  RETURN to_char(a, 'Dy FMMM/FMDD') || ', '
    || CASE WHEN to_char(a, 'AM') = to_char(b, 'AM') THEN v_a || '–' || v_b || ' ' || to_char(b, 'AM')
            ELSE v_a || ' ' || to_char(a, 'AM') || '–' || v_b || ' ' || to_char(b, 'AM') END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pickup_when(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pickup_when(uuid) TO service_role;

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
           ELSE 'Next: pick a new delivery time in Buying.' END
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
       AND o.handover IN ('porch', 'pickup_home', 'meetup')
       AND o.book_by IS NOT NULL
       AND o.book_by > p_now
       AND o.book_by <= p_now + interval '24 hours'
       AND ((o.book_by > p_now + interval '2 hours' AND o.book_by_reminded_24_at IS NULL)
            OR (o.book_by <= p_now + interval '2 hours' AND o.book_by_reminded_2_at IS NULL))
       AND NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL)
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
    v_step := CASE r.handover WHEN 'meetup' THEN 'book a time to meet' WHEN 'porch' THEN 'pick a pickup time'
                              ELSE 'book a pickup time' END;
    PERFORM public.declutter_pickup_remind(r.buyer_id,
      CASE WHEN v_last THEN 'Pick a pickup time: 2 hours left'
           ELSE 'Pick a pickup time by ' || to_char(r.book_by AT TIME ZONE 'America/Chicago', 'Dy FMHH12:MI AM') END,
      format('You paid for %s. Next: %s, by %s. Open your order in Buying.', v_what, v_step, v_by),
      '/declutter?view=cart', r.seller_id);
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

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-book-by-reminders', interval '30 minutes',
            'B117 (lead 11-01, A3-18/19): a paid Declutter pickup with no time booked reminds the buyer 24 h and 2 h before book_by (paid + 7 days). Nothing is cancelled.',
            'exempt', 'Most runs find no unbooked order at a reminder edge: nothing to send is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-book-by-reminders', '2-59/10 * * * *',
      $c$SELECT public.cron_record_work('declutter-book-by-reminders', to_jsonb(public.declutter_book_by_reminder_sweep()));$c$);
  END IF;
END
$do$;
