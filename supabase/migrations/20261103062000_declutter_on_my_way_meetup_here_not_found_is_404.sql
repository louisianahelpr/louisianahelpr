-- Q2390 packet 14 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for Declutter's declutter_on_my_way (the buyer says "on my way" to a
-- pickup) and declutter_meetup_here (buyer or seller checks in at a meetup).
-- Both write handover state (declutter_bookings.buyer_on_way_at;
-- declutter_order_meetups.buyer_here_at / seller_here_at) exactly as before;
-- the not-found raise fires before any write. Neither moves money, creates an
-- order or calls pg_net; no edge function calls them. EXECUTE to authenticated
-- and service_role, as on prod.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_on_my_way                    20261030161617 e5c507d6c48c3d76015cff5500f33318
--   declutter_meetup_here                  20261027204500 3f7bf66c02b080d7e5c1c5df6aa2a0e9
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (2 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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
  PERFORM public.declutter_notify(o.seller_id, 'declutter_pickups', 'Your buyer is on the way',
    CASE WHEN v_title IS NULL THEN 'They''re coming for their pickup.'
         WHEN v_more > 0 THEN format('They''re coming for %s and %s more.', v_title, v_more)
         ELSE format('They''re coming for %s.', v_title) END,
    '/declutter?tab=selling', o.buyer_id);
  RETURN 'on_way';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_on_my_way(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_on_my_way(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_meetup_here(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  m public.declutter_order_meetups%ROWTYPE;
  v_slot timestamptz;
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'meetup' THEN
    RAISE EXCEPTION 'not_a_meetup' USING ERRCODE = '55000', HINT = 'This order isn''t a meetup that''s waiting.';
  END IF;
  SELECT b.slot_start INTO v_slot FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL;
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'Book a time to meet first.';
  END IF;
  IF now() < v_slot - make_interval(mins => (public.declutter_meetup_rules() ->> 'here_from_minutes_before')::integer) THEN
    RAISE EXCEPTION 'too_early_to_check_in' USING ERRCODE = '55000', HINT = 'You can check in from an hour before the meeting time.';
  END IF;
  SELECT * INTO m FROM public.declutter_order_meetups WHERE order_id = o.id FOR UPDATE;
  IF m.order_id IS NULL THEN
    RAISE EXCEPTION 'not_a_meetup' USING ERRCODE = '55000';
  END IF;
  IF (v_side = 'buyer' AND m.buyer_here_at IS NOT NULL) OR (v_side = 'seller' AND m.seller_here_at IS NOT NULL) THEN
    RETURN 'already_here';
  END IF;
  IF v_side = 'buyer' THEN
    UPDATE public.declutter_order_meetups SET buyer_here_at = now() WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.seller_id, 'work_status', 'Your buyer is at the meeting spot',
      format('They checked in at %s.', m.spot_name), '/declutter?view=selling', o.buyer_id);
  ELSE
    UPDATE public.declutter_order_meetups SET seller_here_at = now() WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'work_status', 'The seller is at the meeting spot',
      format('They checked in at %s.', m.spot_name), '/declutter?view=bought', o.seller_id);
  END IF;
  RETURN 'here';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_meetup_here(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_meetup_here(uuid) TO authenticated, service_role;

