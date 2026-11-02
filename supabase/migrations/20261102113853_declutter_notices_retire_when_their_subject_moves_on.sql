-- Q2659 (account audit 1102d row 19; lead verdict 11-02 5:45 AM, column approach): a Declutter notice that asks the
-- member to act ("Reserved for you: check out within 24 hours ... or you get a strike", "Sold: waiting for the buyer
-- to pay", "Porch pickup day booked", "It's on the porch: pick it up today", "New offer", "New counteroffer") stayed
-- unread and actionable after the cart line, order or offer it named had moved on (paid, cancelled, expired,
-- answered, deleted). Measured 11-02: public.notifications had no column naming what a notice is about (only
-- job_id), declutter_notify wrote title/message/link only, and nothing ever retired a Declutter notice.
--
-- 1. notifications.declutter_ref uuid NULL: the cart line, order or offer an ACTIONABLE notice is about. Partial
--    index (only stamped rows). No FK: the three tables differ, and a row's subject can be deleted.
-- 2. declutter_notice_ref(p_ref) (new, service_role only): names what the NEXT notice is about, in the
--    transaction-local setting declutter.notice_ref. A line before the call instead of a 7th argument on
--    declutter_notify: a defaulted argument makes a second overload (any branch that later restates the 6-argument
--    declutter_notify would bring the old one back and every call would fail as ambiguous), and the calls stay the
--    shape every notice guard parses.
-- 3. declutter_notify_strict, restated VERBATIM from its newest CREATE (20261031111949_declutter_notices_open_the_order;
--    the newest on origin/main and on every open wip/ready branch, checked 11-02 with git over the 80 most recent
--    origin branches): it clears the setting first (one notice only) and stores it (a well-formed uuid only) in
--    declutter_ref. declutter_notify, restated VERBATIM from 20261028162048_declutter_notice_kinds, clears it again
--    after its sub-block, because a failed notice rolls back the strict writer's clear.
-- 4. The callers of the actionable notices, each restated VERBATIM from its newest CREATE; the only change is one
--    "PERFORM public.declutter_notice_ref(<id>); -- Q2659" line before each named call:
--      declutter_take_item      (20261101191500) cart line v_line: "It's yours: pick a pickup within 48 hours",
--                               "Reserved for you: check out within 30 minutes / 24 hours", "Sold: waiting for the
--                               buyer to pay" (x2);
--      declutter_book_porch_day (20261030164712) order p_order_id: "Porch pickup day booked / changed";
--      declutter_porch_photo    (20261030164712) order p_order_id: "It's on the porch: pick it up today";
--      declutter_make_offer     (20261029162620) offer v_id: "New offer", the automatic "New counteroffer";
--      declutter_respond_offer  (20261029162620) offer p_offer_id: "New counteroffer".
--    src/test/declutterNoticeRefCallersVerbatim.test.ts proves each body equals its previous one without those lines.
-- 5. declutter_retire_ref_notices() (trigger, SECURITY DEFINER, nobody's to call): when a cart line's or order's
--    status changes, or an offer's status or whose turn it is (awaiting) changes, its UNREAD notices written BEFORE
--    this transaction are marked read (a notice the same transaction writes, such as the counter's own "New
--    counteroffer", stays). When the row is DELETED (test cleanup, account deletion) its notices are deleted (lead
--    11-02: "make test cleanup delete the orders' notices too").
-- Older notices have no ref and simply stay. export_my_data already exports whole notifications rows (to_jsonb).
--
-- MONEY: none. AUTHZ: no member-callable function added; declutter_notice_ref, declutter_notify(_strict) and the trigger
-- function are service_role only; the restated callers keep their grants. The trigger writes only notifications rows
-- whose declutter_ref is the changed row's id. REPLAY-SAFE: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
-- Proof: src/test/pglite/declutterNoticesRetire.pglite.mjs (3x; plants red).

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS declutter_ref uuid;
CREATE INDEX IF NOT EXISTS notifications_declutter_ref_idx ON public.notifications (declutter_ref)
  WHERE declutter_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.declutter_notice_ref(p_ref uuid)
RETURNS void
LANGUAGE sql
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT set_config('declutter.notice_ref', COALESCE(p_ref::text, ''), true);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notice_ref(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notice_ref(uuid) TO service_role;

-- declutter_notify_strict: restated VERBATIM from 20261031111949_declutter_notices_open_the_order.sql; the changes are marked Q2659.
CREATE OR REPLACE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  -- DC-17: one link format for the seller's and buyer's notices (?tab=selling / ?tab=buying).
  -- BUY-30: and the order it is about, when it is this member's order with this counterpart.
  v_link text := public.declutter_notice_order_link(p_user, p_other, public.declutter_notice_link(p_link));
  -- Q2659: set by declutter_notice_ref for the one notice that follows it; cleared below.
  v_ref text := NULLIF(current_setting('declutter.notice_ref', true), '');
BEGIN
  PERFORM set_config('declutter.notice_ref', '', true); -- Q2659: one notice only, whatever happens below
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- Q137: a seed (test) counterpart never notifies a real member.
  IF p_other IS NOT NULL
     AND COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = p_other), false)
     AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = p_user), false) THEN
    RETURN;
  END IF;
  -- Prices read the way the app shows them (src/lib/declutter/distance.ts
  -- formatPrice): whole dollars drop ".00", so "$30.00" is "$30" and "$30.50"
  -- stays. Every Declutter notice passes here, so callers that still format
  -- with to_char(..., 'FM999990.00') read right without being restated.
  -- The item is named first (20261028191646), so two orders' notices differ.
  -- Q2659: the cart line, order or offer an actionable notice asks the member to act on (declutter_notice_ref), so
  -- the notice stops counting as unread once that thing moves on (declutter_retire_ref_notices).
  INSERT INTO public.notifications (user_id, type, title, declutter_ref, message, link)
  VALUES (p_user, public.declutter_notice_type(p_type, p_title, v_link), p_title,
          CASE WHEN v_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_ref::uuid END,
          public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, v_link, p_message)), v_link);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) TO service_role;

-- declutter_notify: restated VERBATIM from 20261028162048_declutter_notice_kinds.sql; the change is marked Q2659.
CREATE OR REPLACE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  BEGIN
    PERFORM public.declutter_notify_strict(p_user, p_type, p_title, p_message, p_link, p_other);
  EXCEPTION WHEN OTHERS THEN
    -- The sale, offer or refund this notice reports has already happened in
    -- this transaction; it must not roll back because the bell row could not
    -- be written. Logged where ops reads (error_logs via log_cron_defect).
    RAISE WARNING 'declutter_notify: notice to % not written (%): %', p_user, p_title, SQLERRM;
    -- The ref names the notice, not only the member: log_cron_defect keeps one
    -- row per (function, ref) an hour, and two different lost notices to one
    -- member must both be on record (lh-silent-failure review, finding 1).
    PERFORM public.log_cron_defect('declutter_notify',
      COALESCE(p_user::text, '-') || ':' || COALESCE(p_title, '') || ':' || COALESCE(p_link, ''), SQLERRM,
      jsonb_build_object('user_id', p_user, 'title', p_title, 'message', p_message, 'type', p_type, 'link', p_link));
  END;
  -- Q2659: a failed notice rolls back the strict writer's clear; never let its ref reach the next notice.
  PERFORM set_config('declutter.notice_ref', '', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) TO service_role;

-- declutter_take_item: restated VERBATIM from its newest CREATE (20261101191500_declutter_checkout_pickup_time.sql); 5 Q2659 line(s) added.
CREATE OR REPLACE FUNCTION public.declutter_take_item(p_item_id uuid, p_buyer uuid, p_price integer, p_source text, p_offer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_seller uuid;
  v_title text;
  v_line uuid;
  v_price text := public.declutter_price_text(p_price);
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.declutter_items WHERE id = p_item_id AND is_seed)
     AND public.seed_hidden_for(p_buyer) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.declutter_items
     SET status = 'reserved', updated_at = now()
   WHERE id = p_item_id AND status = 'live'
  RETURNING seller_id, title INTO v_seller, v_title;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_available'
      USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;

  IF p_offer_id IS NOT NULL THEN
    UPDATE public.declutter_offers
       SET status = 'accepted', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND item_id = p_item_id AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'offer_not_open' USING ERRCODE = '55000';
    END IF;
  END IF;

  -- BUY-1 (owner 10-31): Buy now holds 30 minutes, an accepted offer 24 hours to pay; a free claim keeps its 48 hours.
  -- The line is made BEFORE the other offers are voided, so each voided offer records the hold that voided it.
  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, offer_id, checkout_by)
  VALUES (p_item_id, p_buyer, v_seller, p_price, p_source, p_offer_id, now() + public.declutter_hold_length(p_price, p_source))
  RETURNING id INTO v_line;

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now(), voided_by_line = v_line
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    -- BUY-1: if this hold runs out unpaid the offer opens again (declutter_reopen_voided_offers).
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Item on hold for another buyer',
      format('"%s" is on hold for another buyer, so your offer is closed for now. If they don''t pay in time, it opens again. Nothing was charged.', v_title),
      '/declutter/item/' || p_item_id::text, v_seller);
  END LOOP;

  IF p_price = 0 THEN
    -- A free claim (20261027170717): the same 48 hours, nothing to pay.
    -- DA-12: no strike for letting the 48 hours run out on a free item; it just goes back up.
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: pick a pickup within 48 hours',
      format('"%s" is free and held for you. Choose how you''ll pick it up within 48 hours or it goes back up. Nothing is charged.',
             v_title),
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notify(v_seller, 'new_offers', 'Someone claimed your free item',
      format('"%s" was claimed. The buyer has 48 hours to choose a pickup.', v_title),
      '/declutter?view=selling', p_buyer);
  ELSIF p_source = 'buy' THEN
    -- DB-5 (owner 2026-10-30): Buy now goes straight to checkout; not paying is no strike, the item just goes back up.
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved for you: check out within 30 minutes',
      format('"%s" is held for you at checkout for %s. Pay within 30 minutes or it goes back up for sale. Your card is not charged until you pay.',
             v_title, v_price),
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
      format('"%s" sold for %s. The buyer has 30 minutes to check out and pay.', v_title, v_price),
      '/declutter?view=selling', p_buyer);
  ELSE
  -- Owner's wording (2026-10-28, via the lead): reserved, not paid yet.
  -- B110 (owner 11-01, lead copy): an accepted offer says who accepted it and what to do next.
  PERFORM public.declutter_notice_ref(v_line); -- Q2659
  PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved for you: check out within 24 hours',
    CASE WHEN p_offer_id IS NOT NULL THEN
      format('%s accepted your %s offer for "%s". Check out within 24 hours: choose pickup or delivery, pick a day and time, and pay, or it goes back up for sale and you get a strike. Your card is not charged until you check out.',
             COALESCE((SELECT public.member_display_name(p.full_name, 'The seller') FROM public.profiles p WHERE p.user_id = v_seller), 'The seller'),
             v_price, v_title)
    ELSE
    format('"%s" is in your cart for %s. Check out within 24 hours or you get a strike and it goes back up for sale. Your card is not charged until you check out.',
           v_title, v_price) END,
    '/declutter?view=cart', v_seller);
  PERFORM public.declutter_notice_ref(v_line); -- Q2659
  PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
    format('"%s" sold for %s. The buyer has 24 hours to check out and pay.', v_title, v_price),
    '/declutter?view=selling', p_buyer);
  END IF;
  RETURN v_line;
END;
$function$;

-- declutter_book_porch_day: restated VERBATIM from its newest CREATE (20261030164712_declutter_porch_places.sql); 1 Q2659 line(s) added.
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
  IF NOT public.declutter_order_is_porch_day(o.id, extract(dow FROM p_day)::smallint) THEN
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
  PERFORM public.declutter_notice_ref(p_order_id); -- Q2659
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

-- declutter_porch_photo: restated VERBATIM from its newest CREATE (20261030164712_declutter_porch_places.sql); 1 Q2659 line(s) added.
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
  v_day date;
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
  -- Audit 1a #4 (20261029201542): the seller puts it out ON the buyer's booked day, never before, so the buyer is
  -- not told to come early and the payout clock does not start early. The day is the booking's porch day, else the
  -- Louisiana date of an older timed booking's slot.
  IF v_side = 'seller' THEN
    SELECT COALESCE(b.pickup_day, (b.slot_start AT TIME ZONE 'America/Chicago')::date) INTO v_day
      FROM public.declutter_bookings b WHERE b.order_id = o.id;
    -- Fail closed: no day read (not_booked_yet above should make that impossible) is refused too, never waved through.
    IF v_day IS NULL OR (now() AT TIME ZONE 'America/Chicago')::date < v_day THEN
      RAISE EXCEPTION 'porch_day_not_yet' USING ERRCODE = '55000',
        HINT = format('Put it out on %s, the day the buyer picked.', to_char(v_day, 'FMDay, Mon FMDD'));
    END IF;
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
  -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
  IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
    RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
      HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
  END IF;
  -- Both sides' photos are taken at the address (20261028235709): the seller's "Left on porch" as the buyer's
  -- "Picked up".
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  -- Haversine, metres, to the NEAREST pickup point of the ORDER (D-NEW14, 20261030164712): the porch place frozen
  -- on it at checkout, else (an order with no place) every item's own point, as before (authz review 2.7).
  SELECT min(round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat - pt.lat) / 2)), 2)
           + cos(radians(pt.lat)) * cos(radians(p_lat)) * power(sin(radians((p_lng - pt.lng) / 2)), 2)))))::integer)
    INTO v_m
    FROM public.declutter_order_pickup_points(o.id) pt;
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  IF v_side = 'seller' THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now(), set_out_distance_m = v_m
     WHERE order_id = o.id;
    -- The buyer's signal to go (20261028225038): its own title, the Pickups switch, Buying.
    PERFORM public.declutter_notice_ref(p_order_id); -- Q2659
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'It''s on the porch: pick it up today',
      'The seller put your item out. Take a photo when you pick it up.', '/declutter?tab=buying', o.seller_id);
    RETURN jsonb_build_object('result', 'set_out', 'distance_m', v_m);
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

-- declutter_make_offer: restated VERBATIM from its newest CREATE (20261029162620_declutter_smart_offers.sql); 2 Q2659 line(s) added.
CREATE OR REPLACE FUNCTION public.declutter_make_offer(p_item_id uuid, p_amount_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item record;
  v_id uuid;
  v_rules record;
  v_charge integer;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO v_item FROM public.declutter_lock_buyable_item(p_item_id, v_uid);
  -- Smart offers (owner 2026-10-29): offers off = Buy only.
  -- IS NOT TRUE, not NOT (...): a NULL accepts_offers must refuse, never skip the RAISE.
  IF (SELECT i.accepts_offers FROM public.declutter_items i WHERE i.id = p_item_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'offers_off' USING ERRCODE = '55000', HINT = 'This seller is not taking offers. You can still buy it.';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents >= v_item.o_price_cents THEN
    RAISE EXCEPTION 'invalid_offer_amount'
      USING ERRCODE = '22023', HINT = 'Offer less than the price. To pay the price, use Buy.';
  END IF;
  IF p_amount_cents * 2 < v_item.o_price_cents THEN
    RAISE EXCEPTION 'offer_too_low'
      USING ERRCODE = '22023', HINT = 'Offers must be at least half the current price.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_offers o
              WHERE o.item_id = p_item_id AND o.buyer_id = v_uid AND o.status = 'open') THEN
    RAISE EXCEPTION 'offer_already_open'
      USING ERRCODE = '55000', HINT = 'You already have an offer on this item. Change it from your offers.';
  END IF;
  -- B27: at most 3 threads per buyer per item per 24 h.
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.item_id = p_item_id AND o.buyer_id = v_uid
         AND o.created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'offer_rate_limited'
      USING ERRCODE = '54000', HINT = 'You can make 3 offers a day on one item.';
  END IF;

  INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by)
  VALUES (p_item_id, v_uid, v_item.o_seller_id, p_amount_cents, 'seller', now() + interval '48 hours')
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (v_id, 'buyer', 'offer', p_amount_cents);

  -- Smart offers: the seller's automatic answer, only with auto on and the lowest price below today's price
  -- (the item row is locked by declutter_lock_buyable_item).
  SELECT p.auto_offers, p.floor_price_cents INTO v_rules FROM public.declutter_item_private p WHERE p.item_id = p_item_id;
  IF COALESCE(v_rules.auto_offers, false) AND v_rules.floor_price_cents < v_item.o_price_cents THEN
    IF p_amount_cents >= v_rules.floor_price_cents THEN
      -- At or above the lowest price: accepted at once, exactly as the seller tapping Accept (declutter_respond_offer):
      -- the buyer's card and 18+ (the lock checked the card, strikes and blocks), the accept event, declutter_take_item
      -- with its notices, charged least(amount, price): never above today's price.
      IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = v_uid) THEN
        RAISE EXCEPTION 'card_required' USING ERRCODE = '42501',
          HINT = 'The buyer needs a saved card. It is never charged until checkout.';
      END IF;
      IF public.member_under_18(v_uid) THEN
        RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
      END IF;
      v_charge := least(p_amount_cents, v_item.o_price_cents);
      INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
      VALUES (v_id, 'seller', 'accept', v_charge);
      PERFORM public.declutter_take_item(p_item_id, v_uid, v_charge, 'offer', v_id);
      PERFORM public.declutter_notify(v_item.o_seller_id, 'new_offers', 'Offer accepted automatically',
        format('Accepted automatically at or above your lowest price: $%s for "%s".',
               to_char(v_charge / 100.0, 'FM999990.00'), v_item.o_title),
        '/declutter?tab=selling', v_uid);
      RETURN v_id;
    END IF;
    -- Below it: the seller counters at the lowest price (48 hours, as a seller's counter).
    UPDATE public.declutter_offers
       SET amount_cents = v_rules.floor_price_cents, awaiting = 'buyer', respond_by = now() + interval '48 hours',
           counter_count = counter_count + 1, updated_at = now()
     WHERE id = v_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
    VALUES (v_id, 'seller', 'counter', v_rules.floor_price_cents);
    PERFORM public.declutter_notice_ref(v_id); -- Q2659
    PERFORM public.declutter_notify(v_uid, 'new_offers', 'New counteroffer',
      format('You got a $%s counteroffer on "%s". Accept, decline or counter within 48 hours.',
             to_char(v_rules.floor_price_cents / 100.0, 'FM999990.00'), v_item.o_title),
      '/declutter?tab=buying', v_item.o_seller_id);
    PERFORM public.declutter_notify(v_item.o_seller_id, 'new_offers', 'Offer answered automatically',
      format('You got a $%s offer on "%s" and answered it automatically with your lowest price, $%s.',
             to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.o_title,
             to_char(v_rules.floor_price_cents / 100.0, 'FM999990.00')),
      '/declutter?tab=selling', v_uid);
    RETURN v_id;
  END IF;

  PERFORM public.declutter_notice_ref(v_id); -- Q2659
  PERFORM public.declutter_notify(v_item.o_seller_id, 'new_offers', 'New offer',
    format('You got a $%s offer on "%s". Accept, decline or counter within 48 hours.',
           to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.o_title),
    '/declutter?tab=selling', v_uid);
  RETURN v_id;
END;
$fn$;

-- declutter_respond_offer: restated VERBATIM from its newest CREATE (20261029162620_declutter_smart_offers.sql); 1 Q2659 line(s) added.
CREATE OR REPLACE FUNCTION public.declutter_respond_offer(p_offer_id uuid, p_action text, p_amount_cents integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item_id uuid;
  v_side text;
  o record;
  v_item record;
  v_other uuid;
  v_rules record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_action IS NULL OR p_action NOT IN ('accept', 'decline', 'counter', 'withdraw') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  -- Learn the item, then lock ITEM before the thread (lock order item ->
  -- offer): two answers on one item serialize on the item row.
  SELECT f.item_id INTO v_item_id FROM public.declutter_offers f
   WHERE f.id = p_offer_id AND (f.buyer_id = v_uid OR f.seller_id = v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT i.id, i.status, i.title, i.current_price_cents, i.accepts_offers INTO v_item
    FROM public.declutter_items i WHERE i.id = v_item_id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_offers f WHERE f.id = p_offer_id FOR UPDATE;
  IF o.status <> 'open' THEN
    RAISE EXCEPTION 'offer_not_open' USING ERRCODE = '55000', HINT = 'This offer is already closed.';
  END IF;
  v_side := CASE WHEN o.buyer_id = v_uid THEN 'buyer' ELSE 'seller' END;
  v_other := CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END;

  IF p_action = 'withdraw' THEN
    IF v_side <> 'buyer' THEN
      RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
    END IF;
    UPDATE public.declutter_offers SET status = 'withdrawn', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (p_offer_id, 'buyer', 'withdraw');
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'Offer withdrawn',
      format('The buyer took back their offer on "%s".', v_item.title), '/declutter?tab=selling', o.buyer_id);
    RETURN 'withdrawn';
  END IF;

  IF o.awaiting <> v_side THEN
    RAISE EXCEPTION 'not_your_turn' USING ERRCODE = '55000', HINT = 'Waiting for the other side to answer.';
  END IF;
  IF o.respond_by <= now() THEN
    RAISE EXCEPTION 'offer_expired' USING ERRCODE = '55000', HINT = 'This offer ran out of time.';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.declutter_offers SET status = 'declined', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (p_offer_id, v_side, 'decline');
    -- One wording for every decline (B26): never says why.
    PERFORM public.declutter_notify(v_other, 'new_offers', 'Offer declined',
      format('Your offer on "%s" was declined. Nothing was charged.', v_item.title),
      CASE WHEN v_side = 'seller' THEN '/declutter/item/' || o.item_id::text ELSE '/declutter?tab=selling' END, v_uid);
    RETURN 'declined';
  END IF;

  -- accept / counter: the item must still be for sale, both sides still in.
  IF v_item.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'This item is no longer for sale.';
  END IF;
  IF public.declutter_seller_out(o.seller_id) OR public.are_users_blocked(o.seller_id, o.buyer_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.declutter_member_out(v_other) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;

  IF p_action = 'counter' THEN
    -- Smart offers (owner 2026-10-29): with offers off the seller takes Buy only; a buyer's counter is refused,
    -- open threads stay and the seller may still answer them.
    IF v_side = 'buyer' AND NOT v_item.accepts_offers THEN
      RAISE EXCEPTION 'offers_off' USING ERRCODE = '55000', HINT = 'This seller is not taking offers. You can still buy it.';
    END IF;
    IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents > v_item.current_price_cents THEN
      RAISE EXCEPTION 'invalid_offer_amount' USING ERRCODE = '22023';
    END IF;
    IF v_side = 'buyer' AND p_amount_cents * 2 < v_item.current_price_cents THEN
      RAISE EXCEPTION 'offer_too_low' USING ERRCODE = '22023', HINT = 'Offers must be at least half the current price.';
    END IF;
    IF p_amount_cents = o.amount_cents THEN
      RAISE EXCEPTION 'counter_same_amount' USING ERRCODE = '22023', HINT = 'To agree to this amount, accept it.';
    END IF;
    -- Smart offers: the seller's automatic answer. A buyer's counter at or above the seller's lowest price, with
    -- auto on and that price below today's, is accepted at once below, exactly as the seller tapping Accept.
    IF v_side = 'buyer' THEN
      SELECT p.auto_offers, p.floor_price_cents INTO v_rules FROM public.declutter_item_private p WHERE p.item_id = o.item_id;
      IF COALESCE(v_rules.auto_offers, false) AND v_rules.floor_price_cents < v_item.current_price_cents
         AND p_amount_cents >= v_rules.floor_price_cents THEN
        UPDATE public.declutter_offers SET amount_cents = p_amount_cents, updated_at = now()
         WHERE id = p_offer_id AND status = 'open';
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
        VALUES (p_offer_id, 'buyer', 'counter', p_amount_cents);
        o.amount_cents := p_amount_cents;
        v_side := 'seller';
        p_action := 'accept';
      END IF;
    END IF;
  END IF;

  IF p_action = 'counter' THEN
    UPDATE public.declutter_offers
       SET amount_cents = p_amount_cents,
           awaiting = CASE WHEN v_side = 'buyer' THEN 'seller' ELSE 'buyer' END,
           respond_by = now() + interval '48 hours',
           counter_count = counter_count + 1,
           updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
    VALUES (p_offer_id, v_side, 'counter', p_amount_cents);
    PERFORM public.declutter_notice_ref(p_offer_id); -- Q2659
    PERFORM public.declutter_notify(v_other, 'new_offers', 'New counteroffer',
      format('You got a $%s counteroffer on "%s". Accept, decline or counter within 48 hours.',
             to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.title),
      '/declutter?tab=' || CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'buying' END, v_uid);
    RETURN 'countered';
  END IF;

  -- accept. The buyer pays, so the buyer needs a card on file and to be 18+
  -- (row 53) even when it is the seller who accepts.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = o.buyer_id) THEN
    RAISE EXCEPTION 'card_required' USING ERRCODE = '42501',
      HINT = 'The buyer needs a saved card. It is never charged until checkout.';
  END IF;
  IF public.member_under_18(o.buyer_id) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;
  -- B28: an agreed amount above today's price (the price dropped since the
  -- counter) is charged at today's price: accepting never costs more than Buy.
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (p_offer_id, v_side, 'accept', least(o.amount_cents, v_item.current_price_cents));
  PERFORM public.declutter_take_item(o.item_id, o.buyer_id, least(o.amount_cents, v_item.current_price_cents), 'offer', p_offer_id);
  IF v_side = 'seller' AND v_uid = o.buyer_id THEN
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'Offer accepted automatically',
      format('Accepted automatically at or above your lowest price: $%s for "%s".',
             to_char(least(o.amount_cents, v_item.current_price_cents) / 100.0, 'FM999990.00'), v_item.title),
      '/declutter?tab=selling', o.buyer_id);
  END IF;
  RETURN 'accepted';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.declutter_book_porch_day(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_book_porch_day(uuid, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_make_offer(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_make_offer(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_respond_offer(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_respond_offer(uuid, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_retire_ref_notices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.notifications WHERE declutter_ref = OLD.id;
    RETURN OLD;
  END IF;
  -- Written before this transaction only: now() is the transaction's start, and a notice this same transaction
  -- writes (the counter's own "New counteroffer") is about the new state.
  UPDATE public.notifications
     SET read = true
   WHERE declutter_ref = NEW.id
     AND read = false
     AND created_at < now();
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_retire_ref_notices() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_declutter_cart_items_retire_notices ON public.declutter_cart_items;
CREATE TRIGGER trg_declutter_cart_items_retire_notices
  AFTER UPDATE OF status ON public.declutter_cart_items
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.declutter_retire_ref_notices();
DROP TRIGGER IF EXISTS trg_declutter_cart_items_drop_notices ON public.declutter_cart_items;
CREATE TRIGGER trg_declutter_cart_items_drop_notices
  AFTER DELETE ON public.declutter_cart_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_retire_ref_notices();

DROP TRIGGER IF EXISTS trg_declutter_orders_retire_notices ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_retire_notices
  AFTER UPDATE OF status ON public.declutter_orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.declutter_retire_ref_notices();
DROP TRIGGER IF EXISTS trg_declutter_orders_drop_notices ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_drop_notices
  AFTER DELETE ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_retire_ref_notices();

DROP TRIGGER IF EXISTS trg_declutter_offers_retire_notices ON public.declutter_offers;
CREATE TRIGGER trg_declutter_offers_retire_notices
  AFTER UPDATE OF status, awaiting ON public.declutter_offers
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.awaiting IS DISTINCT FROM NEW.awaiting)
  EXECUTE FUNCTION public.declutter_retire_ref_notices();
DROP TRIGGER IF EXISTS trg_declutter_offers_drop_notices ON public.declutter_offers;
CREATE TRIGGER trg_declutter_offers_drop_notices
  AFTER DELETE ON public.declutter_offers
  FOR EACH ROW EXECUTE FUNCTION public.declutter_retire_ref_notices();
