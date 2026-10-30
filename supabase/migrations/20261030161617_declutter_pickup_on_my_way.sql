-- D-NEW11 (owner request 2026-10-29), the pickup-day card: "I'm on my way". The buyer tells the seller once, on the day
-- of a booked pickup (at the seller's or at a safe spot). It only sends a notice and notes the time: it moves no money,
-- changes no order status and counts for nothing in a no-show or a dispute.
--
-- buyer_on_way_at: readable by both sides through the existing bookings policy; written only by this function
-- (authenticated holds SELECT on the table and no write grant).
-- Replay-safe: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE; grants by role name.
-- Proof: src/test/pglite/declutterOnMyWay.pglite.mjs. Guard: src/test/declutterOnMyWay.test.ts.

ALTER TABLE public.declutter_bookings ADD COLUMN IF NOT EXISTS buyer_on_way_at timestamptz;

CREATE OR REPLACE FUNCTION public.declutter_on_my_way(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_day date;
  v_title text;
  v_more integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  -- The seller gets the same answer as a stranger: only the buyer is coming.
  IF o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' OR o.handover NOT IN ('pickup_home', 'porch', 'meetup') THEN
    RAISE EXCEPTION 'not_a_pickup' USING ERRCODE = '55000', HINT = 'This order isn''t a pickup that''s waiting.';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  v_day := COALESCE(b.pickup_day, (b.slot_start AT TIME ZONE 'America/Chicago')::date);
  IF v_day IS NULL THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'Book a time first.';
  END IF;
  IF v_day <> v_today THEN
    RAISE EXCEPTION 'not_pickup_day' USING ERRCODE = '55000', HINT = 'You can tell the seller on the day of your pickup.';
  END IF;
  -- Once a day: a second tap says nothing more to the seller.
  IF b.buyer_on_way_at IS NOT NULL AND (b.buyer_on_way_at AT TIME ZONE 'America/Chicago')::date = v_today THEN
    RETURN 'already';
  END IF;
  UPDATE public.declutter_bookings SET buyer_on_way_at = now(), updated_at = now() WHERE order_id = o.id;
  SELECT min(i.title), count(*) - 1 INTO v_title, v_more
    FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.order_id = o.id;
  PERFORM public.declutter_notify(o.seller_id, 'work_status', 'Your buyer is on the way',
    CASE WHEN v_title IS NULL THEN 'They''re coming for their pickup.'
         WHEN v_more > 0 THEN format('They''re coming for %s and %s more.', v_title, v_more)
         ELSE format('They''re coming for %s.', v_title) END,
    '/declutter?view=selling', o.buyer_id);
  RETURN 'on_way';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_on_my_way(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_on_my_way(uuid) TO authenticated, service_role;
