-- Declutter handover money (owner 10-30, buying audit finding 24). Replaces the instant refund on one tap.
--   A buyer's no-show report ("They didn't show", "It wasn't delivered"): the seller is told at once and has 24 hours to
--     answer. No answer: refund + strike, by the sweep. An answer: a problem for Louisiana Helpr, money held, no strike
--     until it is decided.
--   Neither side says anything (door, meeting spot): the money is held until someone does (owner's ruling, 10-30).
--   The buyer's "I got it" alone finishes the order, as before (owner's ruling, 10-30).
--   While held: both are nudged 24 hours after the time, then weekly (lead 10-30). The seller's address closes to the buyer
--     7 days after the time; chat stays open (lead 10-30). Held 60 days: a problem for admin to decide, no money moves
--     (owner 10-30). Test data is left out of all three.
--   The seller's "Picked up" (door, meeting spot): recorded, not finished. Buyer silent: the handover finishes 24 hours
--     later and declutter_sale_final's own 24 hours follow, so the seller is paid about 48 hours after confirming. This is
--     the same 48 hours a seller's "Delivered" and a porch photo already had.
-- Restated from prod's effective definitions (md5 at read, 10-30): declutter_report_no_show 83452724,
-- declutter_report_not_delivered 94e0eda0, declutter_seller_picked_up 7e28cf20, declutter_handover_sweep 2f42cd41,
-- declutter_my_handover 3cf383ba, declutter_address_access (read 10-30), declutter_item_address 613df764,
-- declutter_order_place e70188a2, declutter_confirm_handover (read 10-30), declutter_withdraw_problem (20261030134109).
-- Only the marked parts change.

ALTER TABLE public.declutter_handovers
  ADD COLUMN IF NOT EXISTS seller_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_answer_by timestamptz,
  ADD COLUMN IF NOT EXISTS held_nudged_at timestamptz;

-- The 60-day problem is nobody's report, so no person is named as having made it.
ALTER TABLE public.declutter_problems DROP CONSTRAINT IF EXISTS declutter_problems_reporter_side_check;
ALTER TABLE public.declutter_problems ADD CONSTRAINT declutter_problems_reporter_side_check
  CHECK (reporter_side = ANY (ARRAY['buyer'::text, 'seller'::text, 'helpr'::text, 'system'::text]));

CREATE OR REPLACE FUNCTION public.declutter_confirm_handover(p_order_id uuid, p_method text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_slot timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_method IS NULL OR p_method <> 'buyer' THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'buyer' THEN
    -- the seller cannot tap "I got it" for the buyer
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- A seller delivery (20261028202844, #7): only once the seller marked it delivered, or from the delivery
  -- day on the Louisiana calendar. No time booked and not delivered: not yet.
  IF o.handover = 'seller_delivery' AND NOT EXISTS (
       SELECT 1 FROM public.declutter_seller_deliveries d
        WHERE d.order_id = o.id
          AND (d.delivered_at IS NOT NULL
               OR (d.status = 'booked' AND d.slot_start IS NOT NULL
                   AND (now() AT TIME ZONE 'America/Chicago')::date >= (d.slot_start AT TIME ZONE 'America/Chicago')::date))) THEN
    RAISE EXCEPTION 'not_delivered_yet' USING ERRCODE = '55000',
      HINT = 'You can confirm you got it from the delivery day, or once the seller marks it delivered.';
  END IF;
  -- A safe meeting spot or a door pickup (audit 1030 DB-3): only with a time booked, and from the hour before it
  -- that "I'm here" opens (declutter_meetup_rules().here_from_minutes_before).
  IF o.handover IN ('meetup', 'pickup_home') THEN
    SELECT b.slot_start INTO v_slot FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL;
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'Book a time first.';
    END IF;
    IF now() < v_slot - make_interval(mins => (public.declutter_meetup_rules() ->> 'here_from_minutes_before')::integer) THEN
      RAISE EXCEPTION 'got_it_too_early' USING ERRCODE = '55000',
        HINT = 'You can tap I got it from an hour before the booked time.';
    END IF;
  END IF;
  -- Shipping S2 (review fix 10): a shipped order only after the USPS delivered scan.
  IF o.handover = 'ship' AND NOT EXISTS (
       SELECT 1 FROM public.shipments s
        WHERE s.declutter_order_id = o.id AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_delivered_yet' USING ERRCODE = '55000',
      HINT = 'You can confirm you got it once the post office scans it as delivered.';
  END IF;
  -- CHANGED (owner 10-30): the buyer's tap is enough, even on a sale held 60 days: that problem is nobody's report, and
  -- the buyer has just spoken. Any other open problem still holds it (declutter_complete_handover refuses).
  UPDATE public.declutter_problems SET status = 'withdrawn', withdrawn_at = now()
   WHERE order_id = o.id AND status = 'open' AND reporter_side = 'system';
  RETURN public.declutter_complete_handover(o.id, p_method);
END;
$function$;

-- Starts the seller's 24 hours. Called only by the two report functions, with the order locked. A second tap answers the same.
CREATE OR REPLACE FUNCTION public.declutter_start_no_show_answer(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.declutter_orders;
  h public.declutter_handovers;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  -- B100's rule: a member who took back a report on this sale, of any reason, cannot report it again.
  IF EXISTS (SELECT 1 FROM public.declutter_problems p
              WHERE p.order_id = o.id AND p.reporter_id = o.buyer_id AND p.status = 'withdrawn') THEN
    RAISE EXCEPTION 'problem_taken_back' USING ERRCODE = '55000',
      HINT = 'You took back your report on this sale, so it can''t be reported again.';
  END IF;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  IF h.no_show_reported_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'seller_told', 'answer_by', h.no_show_answer_by);
  END IF;
  UPDATE public.declutter_handovers
     SET no_show_reported_at = now(), no_show_answer_by = now() + interval '24 hours'
   WHERE order_id = o.id
  RETURNING * INTO h;
  PERFORM public.declutter_notify(o.seller_id, 'declutter_pickups',
    CASE WHEN o.handover = 'seller_delivery' THEN 'The buyer says it wasn''t delivered' ELSE 'The buyer says you didn''t show' END,
    format('About %s. Answer within 24 hours in Selling. If you don''t, the buyer is refunded and you get a strike.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=selling', o.buyer_id);
  RETURN jsonb_build_object('result', 'seller_told', 'answer_by', h.no_show_answer_by);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_start_no_show_answer(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declutter_report_no_show(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- CHANGED (owner 10-30): one side's word against the other's goes to Louisiana Helpr. The seller said it was handed
  -- over: the buyer reports a problem. The buyer reported the seller: the seller answers that, and can't report back.
  IF v_side = 'buyer' AND h.seller_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'seller_confirmed' USING ERRCODE = '55000',
      HINT = 'The seller says it was handed over. If you don''t have it, report a problem.';
  END IF;
  IF v_side = 'seller' AND h.seller_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_confirmed' USING ERRCODE = '55000',
      HINT = 'You said it was handed over. If that''s wrong, report a problem.';
  END IF;
  IF v_side = 'seller' AND h.no_show_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'no_show_reported' USING ERRCODE = '55000',
      HINT = 'The buyer says you didn''t show. Answer that report on this order.';
  END IF;
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
    -- CHANGED (owner 10-30): no refund and no strike on one tap. The sweep closes it if the seller doesn't answer.
    RETURN public.declutter_start_no_show_answer(o.id);
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
$function$;

CREATE OR REPLACE FUNCTION public.declutter_report_not_delivered(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
  v_side text;
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
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'buyer' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.status IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  IF now() < d.slot_end + make_interval(mins => (public.declutter_seller_delivery_rules() ->> 'not_delivered_after_minutes')::integer) THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000', HINT = 'Wait 15 minutes after the delivery time ends.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'seller_delivered' USING ERRCODE = '55000',
      HINT = 'The seller marked it delivered. If you don''t have it, report a problem.';
  END IF;
  -- CHANGED (owner 10-30): no refund and no strike on one tap. The sweep closes it if the seller doesn't answer.
  RETURN public.declutter_start_no_show_answer(o.id);
END;
$function$;

-- The seller's answer: "I was there". The money stays held and no one gets a strike until Louisiana Helpr decides.
CREATE OR REPLACE FUNCTION public.declutter_answer_no_show(p_order_id uuid, p_note text, p_photo_paths text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  h public.declutter_handovers;
  v_side text;
  v_open public.declutter_problems;
  v_id uuid;
  v_path text;
  a record;
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
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  IF h.no_show_reported_at IS NULL THEN
    RAISE EXCEPTION 'no_show_not_reported' USING ERRCODE = '55000';
  END IF;
  IF now() >= h.no_show_answer_by THEN
    RAISE EXCEPTION 'no_show_answer_late' USING ERRCODE = '55000',
      HINT = 'The 24 hours to answer are over.';
  END IF;
  -- CHANGED (T9, 10-30): the report is the buyer's; the seller is answering it. So the problem names the buyer as its
  -- reporter and carries the seller's words as the other side. Going through declutter_report_problem recorded the seller
  -- as the reporter: their card said "reported by you", the buyer could not take it back, and a false-report decision
  -- would have gone against the wrong person.
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  IF cardinality(COALESCE(p_photo_paths, '{}')) > 3 THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023';
  END IF;
  FOREACH v_path IN ARRAY COALESCE(p_photo_paths, '{}') LOOP
    IF v_path IS NULL
       OR split_part(v_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(v_path, '/', 3) IS DISTINCT FROM 'problem'
       OR split_part(v_path, '/', 4) IS DISTINCT FROM o.id::text
       OR split_part(v_path, '/', 5) = ''
       OR split_part(v_path, '/', 6) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = v_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT p.* INTO v_open FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open';
  IF FOUND THEN
    -- The same answer sent again (a double tap) answers the same.
    IF v_open.reporter_side = 'buyer' AND v_open.other_side_note = btrim(p_note) THEN
      RETURN v_open.id;
    END IF;
    -- Review of 7496d29c8b #1: the buyer's OTHER open problem: this answer is the seller's side of it, never refused into
    -- a dead end. Anything else (their own report, or a side already sent) goes through "Add your side".
    IF v_open.reporter_side = 'buyer' AND v_open.other_side_note IS NULL THEN
      UPDATE public.declutter_problems
         SET other_side_note = btrim(p_note), other_side_photo_paths = COALESCE(p_photo_paths, '{}'), other_side_at = now()
       WHERE id = v_open.id;
      PERFORM public.declutter_notify(o.buyer_id, 'declutter_refunds', 'The seller answered your report',
        format('About %s. Louisiana Helpr looks at both sides and tells you what it decides. The money stays held until then.',
               public.declutter_order_items_named(o.id)),
        '/declutter?tab=buying', v_uid);
      -- Owner rule: test data never reaches an admin.
      IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
        FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
          PERFORM public.declutter_notify(a.user_id, 'info', 'Declutter problem: the other side answered',
            'The other side of a reported Declutter problem added their side. It is in the problem case.', '/admin');
        END LOOP;
      END IF;
      RETURN v_open.id;
    END IF;
    RAISE EXCEPTION 'problem_already_open' USING ERRCODE = '55000',
      HINT = 'A problem is already open on this sale. Add your side to it, with photos, and Louisiana Helpr reads both.';
  END IF;
  INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths,
                                         other_side_note, other_side_photo_paths, other_side_at)
  VALUES (o.id, o.buyer_id, 'buyer', 'no_show',
          CASE WHEN o.handover = 'seller_delivery' THEN 'It wasn''t delivered at the delivery time.' ELSE 'The seller didn''t show at the pickup time.' END,
          '{}', btrim(p_note), COALESCE(p_photo_paths, '{}'), now())
  RETURNING id INTO v_id;
  PERFORM public.declutter_notify(o.buyer_id, 'declutter_refunds', 'The seller answered your report',
    format('About %s. Louisiana Helpr looks at both sides and tells you what it decides. The money stays held until then.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=buying', v_uid);
  IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
        'A buyer reported that the seller didn''t show, and the seller answered. The money is held until you decide it.', '/admin');
    END LOOP;
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_answer_no_show(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_no_show(uuid, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_picked_up(p_order_id uuid, p_photo_path text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_out jsonb;
  v_m integer;
  h public.declutter_handovers;
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
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- Q2425: handing it over at a safe meeting spot is the same act as at the door.
  IF o.handover NOT IN ('pickup_home', 'meetup') THEN
    RAISE EXCEPTION 'not_a_door_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  -- Not before the booked time (lh-money-escrow review #1): the seller cannot
  -- mark it picked up, and be paid, before the buyer could have come.
  IF EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start > now()) THEN
    RAISE EXCEPTION 'before_pickup_time' USING ERRCODE = '55000',
      HINT = 'You can mark it picked up from the booked pickup time.';
  END IF;
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF p_photo_path IS NOT NULL THEN
    IF split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
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
    -- A photo is taken where the handover is (20261028235709): the meeting spot frozen on the order, or the
    -- nearest item pickup point of a door pickup.
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    IF o.handover = 'meetup' THEN
      SELECT public.helpr_task_distance_m(p_lat, p_lng, m.spot_lat, m.spot_lng) INTO v_m
        FROM public.declutter_order_meetups m WHERE m.order_id = o.id;
      IF v_m IS NULL OR v_m > 200 THEN
        RAISE EXCEPTION 'not_at_meetup' USING ERRCODE = '22023', HINT = 'Take the photo at the meeting spot.';
      END IF;
    ELSE
      SELECT min(public.helpr_task_distance_m(p_lat, p_lng, p.pickup_lat, p.pickup_lng)) INTO v_m
        FROM public.declutter_cart_items c
        JOIN public.declutter_item_private p ON p.item_id = c.item_id
       WHERE c.order_id = o.id;
      IF v_m IS NULL OR v_m > 200 THEN
        RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
      END IF;
    END IF;
  END IF;
  -- CHANGED (owner 10-30): a paid sale waits for the buyer. A free claim moves no money, so it finishes as before.
  IF o.paid_with = 'free' THEN
    -- complete_handover first (it refuses an open problem); then the photo is kept with the handover.
    v_out := public.declutter_complete_handover(o.id, 'seller');
    IF p_photo_path IS NOT NULL THEN
      UPDATE public.declutter_handovers SET picked_up_photo_path = p_photo_path, picked_up_at = now(), picked_up_distance_m = v_m
       WHERE order_id = o.id AND picked_up_photo_path IS NULL;
    END IF;
    RETURN v_out;
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
  END IF;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  IF h.no_show_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'no_show_reported' USING ERRCODE = '55000',
      HINT = 'The buyer says you didn''t show. Answer that report on this order.';
  END IF;
  IF h.seller_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'seller_confirmed');
  END IF;
  UPDATE public.declutter_handovers
     SET seller_confirmed_at = now(),
         picked_up_photo_path = COALESCE(picked_up_photo_path, p_photo_path),
         picked_up_at = CASE WHEN picked_up_photo_path IS NULL AND p_photo_path IS NOT NULL THEN now() ELSE picked_up_at END,
         picked_up_distance_m = CASE WHEN picked_up_photo_path IS NULL AND p_photo_path IS NOT NULL THEN v_m ELSE picked_up_distance_m END
   WHERE order_id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'The seller says you have it',
    format('About %s. Tap "I got it" in Buying. If you don''t have it, report a problem there. If we don''t hear from you, the seller is paid in 48 hours.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=buying', o.seller_id);
  RETURN jsonb_build_object('result', 'seller_confirmed');
END;
$function$;

-- A seller who hasn't answered can't get round the report: the porch photo and "Delivered" are refused too.
CREATE OR REPLACE FUNCTION public.declutter_refuse_given_during_no_show()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = NEW.order_id AND h.no_show_reported_at IS NOT NULL) THEN
    RAISE EXCEPTION 'no_show_reported' USING ERRCODE = '55000',
      HINT = 'The buyer says you didn''t show. Answer that report on this order.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_refuse_given_during_no_show() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS declutter_set_out_waits_for_no_show_answer ON public.declutter_handovers;
CREATE TRIGGER declutter_set_out_waits_for_no_show_answer
  BEFORE UPDATE OF set_out_at ON public.declutter_handovers
  FOR EACH ROW WHEN (NEW.set_out_at IS DISTINCT FROM OLD.set_out_at AND NEW.set_out_at IS NOT NULL)
  EXECUTE FUNCTION public.declutter_refuse_given_during_no_show();
DROP TRIGGER IF EXISTS declutter_delivered_waits_for_no_show_answer ON public.declutter_seller_deliveries;
CREATE TRIGGER declutter_delivered_waits_for_no_show_answer
  BEFORE UPDATE OF delivered_at ON public.declutter_seller_deliveries
  FOR EACH ROW WHEN (NEW.delivered_at IS DISTINCT FROM OLD.delivered_at AND NEW.delivered_at IS NOT NULL)
  EXECUTE FUNCTION public.declutter_refuse_given_during_no_show();

-- The seller's 24 hours: the pickup time stands while the report waits, so nobody moves it out from under the report.
CREATE OR REPLACE FUNCTION public.declutter_refuse_move_during_no_show()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = NEW.order_id AND h.no_show_reported_at IS NOT NULL) THEN
    RAISE EXCEPTION 'no_show_waiting' USING ERRCODE = '55000',
      HINT = 'A no-show report on this order is waiting for an answer, so the time can''t move.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_refuse_move_during_no_show() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS declutter_booking_waits_for_no_show_answer ON public.declutter_bookings;
CREATE TRIGGER declutter_booking_waits_for_no_show_answer
  BEFORE UPDATE OF slot_start, pickup_day ON public.declutter_bookings
  FOR EACH ROW WHEN (NEW.slot_start IS DISTINCT FROM OLD.slot_start OR NEW.pickup_day IS DISTINCT FROM OLD.pickup_day)
  EXECUTE FUNCTION public.declutter_refuse_move_during_no_show();
-- Review of 7496d29c8b #2: a seller delivery's time stands the same way, as the pickup path's does. Asking or accepting
-- waits; turning a request down still works (proposed_start goes to NULL).
DROP TRIGGER IF EXISTS declutter_delivery_time_waits_for_no_show_answer ON public.declutter_seller_deliveries;
CREATE TRIGGER declutter_delivery_time_waits_for_no_show_answer
  BEFORE UPDATE OF slot_start, proposed_start ON public.declutter_seller_deliveries
  FOR EACH ROW WHEN (NEW.slot_start IS DISTINCT FROM OLD.slot_start
                     OR (NEW.proposed_start IS NOT NULL AND NEW.proposed_start IS DISTINCT FROM OLD.proposed_start))
  EXECUTE FUNCTION public.declutter_refuse_move_during_no_show();

-- Restated from 20261030134109 (take back a problem report); only the marked lines change.
CREATE OR REPLACE FUNCTION public.declutter_withdraw_problem(p_problem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  p public.declutter_problems;
  v_side text;
  v_withdrawn integer := 0;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Lock order: the order first, then the problem, as the decision does.
  o := public.declutter_lock_order(v_order);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  -- Only the member who reported it, still that side of the sale; anyone else is not told it exists.
  IF v_side IS NULL OR v_side NOT IN ('buyer', 'seller')
     OR p.reporter_id IS DISTINCT FROM v_uid OR p.reporter_side IS DISTINCT FROM v_side THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p.status = 'withdrawn' THEN
    RETURN jsonb_build_object('result', 'already', 'problem_id', p.id);
  END IF;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  -- A refund request that went to Louisiana Helpr with this report.
  IF EXISTS (SELECT 1 FROM public.declutter_refund_requests r
              WHERE r.problem_id = p.id AND r.status = 'to_admin' AND r.return_agreed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_has_return' USING ERRCODE = '55000',
      HINT = 'A return was agreed on this sale, so Louisiana Helpr decides it.';
  END IF;
  IF v_side = 'seller' AND EXISTS (SELECT 1 FROM public.declutter_refund_requests r
                                    WHERE r.problem_id = p.id AND r.status = 'to_admin') THEN
    RAISE EXCEPTION 'problem_has_refund_request' USING ERRCODE = '55000',
      HINT = 'The buyer''s refund request went to Louisiana Helpr with your report, so it stays with them.';
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'withdrawn'
   WHERE problem_id = p.id AND status = 'to_admin' AND v_side = 'buyer';
  GET DIAGNOSTICS v_withdrawn = ROW_COUNT;
  UPDATE public.declutter_problems SET status = 'withdrawn', withdrawn_at = now() WHERE id = p.id;
  -- CHANGED (T9, review of 7496d29c8b #1): whatever problem the buyer takes back, the no-show clock ends with it: the seller
  -- may have answered on it. Left set, the sweep would read the passed 24 hours as no answer and refund, with a strike, a
  -- seller who did answer, and the buyer could force that past Louisiana Helpr. The seller taking back their OWN response
  -- doesn't touch the buyer's report: the clock runs on.
  IF v_side = 'buyer' THEN
    UPDATE public.declutter_handovers SET no_show_reported_at = NULL, no_show_answer_by = NULL WHERE order_id = o.id;
  END IF;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'declutter_refunds',
    'Problem report taken back',
    format('The %s took back their problem report on %s. Nothing is held for it any more.',
           v_side, public.declutter_order_items_named(o.id)),
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'cart' END, v_uid);
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'info', 'Declutter problem taken back',
      'A member took back a Declutter problem they reported. It has left the problems queue.', '/admin');
  END LOOP;
  RETURN jsonb_build_object('result', 'withdrawn', 'problem_id', p.id, 'refund_requests_withdrawn', v_withdrawn);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_withdraw_problem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_problem(uuid) TO authenticated, service_role;

-- 7 days after the booked time with nothing having happened, the buyer stops seeing the seller's address. A new time
-- can't be booked by then (declutter_book_pickup: not past paid_at + 7 days), so no rebook needs it.
CREATE OR REPLACE FUNCTION public.declutter_held_address_closed(p_order_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.declutter_orders o
      JOIN public.declutter_bookings b ON b.order_id = o.id
     WHERE o.id = p_order_id AND o.status = 'paid' AND b.slot_start IS NOT NULL
       AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '7 days' <= now()
       -- Review of 7496d29c8b #4: what was already going on when it closed keeps it open. A problem or no-show report filed
       -- after the close, and the 60-day problem (nobody's report), don't reopen the seller's home to the buyer.
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open'
                        AND p.created_at < public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '7 days')
       AND NOT EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id
                        AND (h.seller_confirmed_at IS NOT NULL OR h.set_out_at IS NOT NULL
                             OR h.no_show_reported_at < public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '7 days')));
$function$;
REVOKE ALL ON FUNCTION public.declutter_held_address_closed(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declutter_address_access(p_item_id uuid, p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
           WHEN i.seller_id = p_user_id THEN 'seller'
           -- CHANGED (lead 10-30): a held sale's address closes 7 days after the time. Its own answer, so the buyer's
           -- order card reads "no address", never a "not found" error.
           WHEN EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_orders o ON o.id = c.order_id
                         WHERE c.item_id = i.id AND c.status = 'paid'
                           AND o.status = 'paid' AND o.buyer_id = p_user_id
                           AND o.handover IN ('pickup_home', 'porch')
                           AND public.declutter_held_address_closed(o.id)) THEN 'held_closed'
           WHEN EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_orders o ON o.id = c.order_id
                         WHERE c.item_id = i.id AND c.status = 'paid'
                           AND o.status = 'paid' AND o.buyer_id = p_user_id
                           -- Q2425: a safe-spot meetup never shares the seller's home address.
                           -- Shipping S2: nor does a shipped order (the buyer never comes to the door).
                           AND o.handover NOT IN ('seller_delivery', 'meetup', 'ship')) THEN 'paid_buyer'
         END
    FROM public.declutter_items i
   WHERE i.id = p_item_id
     AND p_user_id IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.declutter_address_access(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declutter_item_address(p_item_id uuid)
 RETURNS TABLE(pickup_address text, pickup_lat numeric, pickup_lng numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_access text := public.declutter_address_access(p_item_id, (SELECT auth.uid()));
  v_pp public.declutter_order_porch_places%ROWTYPE;
BEGIN
  -- CHANGED (lead 10-30): closed on a held sale: no rows.
  IF v_access = 'held_closed' THEN
    RETURN;
  END IF;
  IF v_access IS DISTINCT FROM 'paid_buyer' AND NOT public.declutter_in_agreed_sale(p_item_id, (SELECT auth.uid())) THEN
    PERFORM public.require_feature('declutter');
  END IF;
  IF v_access IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- D-NEW14 (20261030164712): the paid buyer of an order with a frozen porch place gets THAT place only, never the
  -- item's own address or the seller's other places.
  IF v_access = 'paid_buyer' THEN
    SELECT pp.* INTO v_pp
      FROM public.declutter_cart_items c
      JOIN public.declutter_orders o ON o.id = c.order_id
      JOIN public.declutter_order_porch_places pp ON pp.order_id = o.id
     WHERE c.item_id = p_item_id AND c.status = 'paid' AND o.status = 'paid' AND o.buyer_id = (SELECT auth.uid())
     ORDER BY o.paid_at DESC NULLS LAST LIMIT 1;
    IF v_pp.order_id IS NOT NULL THEN
      RETURN QUERY SELECT v_pp.address, v_pp.lat, v_pp.lng;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY
    SELECT p.pickup_address, p.pickup_lat, p.pickup_lng
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.declutter_order_place(p_order_id uuid)
 RETURNS TABLE(label text, area text, address text, lat numeric, lng numeric, weekdays smallint[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_open boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF o.id IS NULL OR v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- CHANGED (lead 10-30): closed on a held sale, for the buyer.
  v_open := v_side = 'seller' OR o.status IN ('paid', 'handed_over');
  v_open := v_open AND (v_side = 'seller' OR NOT public.declutter_held_address_closed(o.id));
  RETURN QUERY
    SELECT pp.label, pp.area,
           CASE WHEN v_open THEN pp.address END,
           CASE WHEN v_open THEN pp.lat::numeric END,
           CASE WHEN v_open THEN pp.lng::numeric END,
           pp.weekdays
      FROM public.declutter_order_porch_places pp
     WHERE pp.order_id = o.id;
END;
$function$;

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
                            'no_show_unanswered', v_unanswered, 'held_nudged', v_nudged, 'held_to_admin', v_to_admin);
END;
$function$;

CREATE OR REPLACE FUNCTION public.declutter_my_handover(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  h public.declutter_handovers;
  v_side text;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL OR o.status NOT IN ('paid', 'handed_over') THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  -- No code and no QR reach either side (owner 2026-10-18: porch pickup only).
  RETURN jsonb_build_object(
    'order_id', o.id, 'status', o.status, 'side', v_side,
    'confirmed_by', h.confirmed_by, 'confirmed_at', h.confirmed_at,
    'set_out_at', h.set_out_at, 'set_out_photo_path', h.set_out_photo_path,
    'set_out_note', h.set_out_note,
    'picked_up_at', h.picked_up_at, 'picked_up_photo_path', h.picked_up_photo_path,
    'seller_confirmed_at', h.seller_confirmed_at,
    'no_show_reported_at', h.no_show_reported_at, 'no_show_answer_by', h.no_show_answer_by);
END;
$function$;
