-- Q2390 packet 37 (REGULAR packet: lead review): "not found" answers HTTP 404, not 500, for six Jobs and Declutter
-- functions that still raised P0002 (owner rule 11-03: Jobs and Declutter first; no testers-only features). Each raise
-- comes at the function's first existence check or locked read, BEFORE any write:
--   declutter_helpr_answer_no_show (not the task's Helpr, or not a delivery task), declutter_take_item (service_role
--   helper; a test listing hidden from this buyer), declutter_report_problem (not a side), declutter_answer_no_show
--   (not a side), admin_rule_helpr_fault (admin; the job read), report_message_party_and_copy (BEFORE INSERT trigger on
--   reports, 5: the reported review, question/answer, wanted post or message is missing or hidden from the reporter).
-- The app and create-payment (admin_rule_helpr_fault) map by message; no SQL caller catches P0002 (no handler for
-- no_data_found/P0002 in any migration). No edge map changes, no deploy. PostgREST maps P0002 to 500; RAISE ... USING
-- ERRCODE = 'PT404' answers 404.
--
-- Each is restated VERBATIM from its newest migration copy, whose md5(prosrc) and md5(pg_get_functiondef) equal prod
-- (read 2026-11-03 by Builder 75; 1 overload each; grants as prod: authenticated + service_role, or service_role only
-- for declutter_take_item and report_message_party_and_copy). The ONLY change: ERRCODE 'P0002' -> 'PT404'.
--   declutter_helpr_answer_no_show  20261031134217 7069d5e32fb6be670295b6b58144667c
--   declutter_take_item             20261102113853 5a5dedb19fbb0f7c39df9aae82a5e4e6
--   declutter_report_problem        20261031100935 577fde1d952bbc91169742e3ac9d7b55
--   declutter_answer_no_show        20261031004529 7b66ce767924fb8e12052db83cd27f44
--   admin_rule_helpr_fault          20261019015301 99883228290797a09fe84d90fd660a1e
--   report_message_party_and_copy   20261102040000 b528dcf772025387bf1beea3294c8f36

-- declutter_helpr_answer_no_show: restated from 20261031134217_helpr_delivery_seller_reports_no_show.sql.
CREATE OR REPLACE FUNCTION public.declutter_helpr_answer_no_show(p_task_id uuid, p_note text, p_photo_path text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  o public.declutter_orders;
  v_open public.declutter_problems;
  v_id uuid;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid OR t.source_kind IS DISTINCT FROM 'declutter_delivery' THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.seller_no_show_reported_at IS NULL OR t.seller_no_show_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'no_show_not_reported' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  -- The same answer sent again (a double tap) answers the same.
  IF t.seller_no_show_answered_at IS NOT NULL THEN
    SELECT p.* INTO v_open FROM public.declutter_problems p
     WHERE p.order_id = o.id AND p.status = 'open' AND p.reporter_id = v_uid AND p.note = btrim(p_note);
    IF FOUND THEN
      RETURN v_open.id;
    END IF;
    RAISE EXCEPTION 'already_answered' USING ERRCODE = '55000',
      HINT = 'You already answered. Louisiana Helpr looks at both sides and tells you what it decides.';
  END IF;
  IF now() >= t.seller_no_show_answer_by THEN
    RAISE EXCEPTION 'no_show_answer_late' USING ERRCODE = '55000', HINT = 'The 24 hours to answer are over.';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  -- The proof photo: one from the Helpr's own task folder (the helpr-tasks bucket, as every task photo), any age.
  IF p_photo_path IS NOT NULL AND NOT (split_part(p_photo_path, '/', 1) = v_uid::text
       AND split_part(p_photo_path, '/', 2) = 'task'
       AND split_part(p_photo_path, '/', 3) = t.id::text
       AND split_part(p_photo_path, '/', 4) <> ''
       AND split_part(p_photo_path, '/', 5) = ''
       AND EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'helpr-tasks' AND so.name = p_photo_path)) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- Review #4: a problem already open on the sale (opened after the report) has the money; the answer is still
  -- recorded, so the Helpr who answered in time gets no strike for it, and the admin is told below.
  SELECT p.* INTO v_open FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open';
  IF FOUND THEN
    v_id := v_open.id;
  ELSE
    -- Review #1: the problem is the HELPR's word that the seller wasn't there, the same shape as the Helpr's own
    -- "The seller wasn't there" (declutter_delivery_on_task_event 'pickup_no_show': reporter_side 'helpr'), so the
    -- admin's "Pay the seller" is refused for it (declutter_admin_decide_problem, B77: the item never left the seller).
    -- The seller's report is the other side.
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths,
                                           other_side_note, other_side_photo_paths, other_side_at, is_seed)
    VALUES (o.id, v_uid, 'helpr', 'no_show', btrim(p_note),
            CASE WHEN p_photo_path IS NULL THEN '{}'::text[] ELSE ARRAY[p_photo_path] END,
            format('The seller says the Helpr didn''t come for the pickup at %s.',
                   to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD FMHH12:MI AM')),
            '{}', t.seller_no_show_reported_at, o.is_seed)
    RETURNING id INTO v_id;
  END IF;
  UPDATE public.helpr_tasks SET seller_no_show_answered_at = now(), updated_at = now() WHERE id = t.id;
  PERFORM public.helpr_task_log(t.id, 'seller_no_show_answer', v_uid, left(btrim(p_note), 200));
  PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'The Helpr answered your report',
    format('About %s. Louisiana Helpr looks at both sides and tells you what it decides. The money stays held until then.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=selling', NULL);
  -- Owner rule: test data never reaches an admin.
  IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id) OR public.is_test_subject(v_uid)) THEN
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
        'A seller reported that the Helpr didn''t come, and the Helpr answered. The money is held until you decide it.', '/admin');
    END LOOP;
  END IF;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_helpr_answer_no_show(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_helpr_answer_no_show(uuid, text, text) TO authenticated, service_role;

-- declutter_take_item: restated from 20261102113853_declutter_notices_retire_when_their_subject_moves_on.sql.
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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

REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) TO service_role;

-- declutter_report_problem: restated from 20261031100935_declutter_problem_notices_name_the_item.sql.
CREATE OR REPLACE FUNCTION public.declutter_report_problem(p_order_id uuid, p_reason text, p_note text, p_photo_paths text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'handed_over' THEN
    -- 141d: the BUYER may still report a problem in the 24 hours after the handover (owner 2026-10-22 #2),
    -- while a refund request waits, and for 24 hours after the seller says no (#3). The payout waits.
    PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
    IF v_side <> 'buyer' OR NOT public.declutter_problem_window_open(o.id) THEN
      RAISE EXCEPTION 'sale_final' USING ERRCODE = '55000', HINT = 'The time to report a problem is over, so this sale is final.';
    END IF;
  ELSIF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  -- D2-3 (audit 1b #3): a second report on a sale with an open problem was answered with the first report's id and
  -- its reason, note and photos were thrown away. Now: the same report sent again (a double tap) still answers the
  -- open problem's id; anything else is refused with words that say where to add it (declutter_problem_add_side for
  -- the other side; the reporter's own report is already with Louisiana Helpr).
  SELECT p.id INTO v_id FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open';
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.declutter_problems p
                WHERE p.id = v_id AND p.reporter_id = v_uid AND p.reason = p_reason AND p.note = btrim(p_note)) THEN
      RETURN v_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.id = v_id AND p.reporter_id = v_uid) THEN
      RAISE EXCEPTION 'problem_already_reported' USING ERRCODE = '55000',
        HINT = 'You already reported a problem on this sale. Louisiana Helpr is looking at it and will tell you both what it decides.';
    END IF;
    RAISE EXCEPTION 'problem_already_open' USING ERRCODE = '55000',
      HINT = 'A problem is already open on this sale. Add your side to it, with photos, and Louisiana Helpr reads both.';
  END IF;
  -- B100 (20261030134109): a member who took back their report on this sale cannot report it again.
  IF EXISTS (SELECT 1 FROM public.declutter_problems p
              WHERE p.order_id = o.id AND p.reporter_id = v_uid AND p.status = 'withdrawn') THEN
    RAISE EXCEPTION 'problem_taken_back' USING ERRCODE = '55000',
      HINT = 'You took back your report on this sale, so it can''t be reported again.';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('not_as_described', 'damaged', 'not_received', 'no_show', 'safety', 'other') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  IF cardinality(COALESCE(p_photo_paths, '{}')) > 6 THEN
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
  INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
  VALUES (o.id, v_uid, v_side, p_reason, btrim(p_note), COALESCE(p_photo_paths, '{}'))
  RETURNING id INTO v_id;
  -- 141d: a refund request still waiting (or one the seller said no to) now goes to the admin with this report.
  UPDATE public.declutter_refund_requests SET status = 'to_admin', problem_id = v_id
   WHERE order_id = o.id AND status IN ('open', 'offered', 'returning', 'declined');
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'warning',
    'A problem was reported on your sale',
    -- BUY-30: the notice names the item and opens the recipient's own tab (the retired ?view= links went).
    format('A problem was reported on %s. The money stays held until Louisiana Helpr looks at it. We may ask you for photos.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=' || CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'buying' END, v_uid);
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
      'A buyer or seller reported a problem on a paid sale. The money is held until you decide it.', '/admin');
  END LOOP;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_report_problem(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_report_problem(uuid, text, text, text[]) TO authenticated, service_role;

-- declutter_answer_no_show: restated from 20261031004529_declutter_handover_both_confirm.sql.
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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

-- admin_rule_helpr_fault: restated from 20261019015301_helpr_fault_ruling.sql.
CREATE OR REPLACE FUNCTION public.admin_rule_helpr_fault(
  p_job_id uuid,
  p_helper_id uuid,
  p_kind text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_job record;
  v_existing record;
  v_ruling uuid;
  v_strike_added boolean := false;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('no_show', 'backout') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  -- A ruling charges a person money: the next admin reading the log needs why.
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023';
  END IF;
  IF p_helper_id IS NULL THEN
    RAISE EXCEPTION 'helper_required' USING ERRCODE = '22023';
  END IF;

  -- One ruling per job, decided under the job's row lock.
  SELECT j.id, j.title, j.helper_id, j.payment_status, j.is_seed
    INTO v_job FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404';
  END IF;

  SELECT r.id, r.helper_id INTO v_existing
    FROM public.job_helpr_fault_rulings r WHERE r.job_id = p_job_id;
  IF v_existing.id IS NOT NULL THEN
    -- The same Helpr again (a retry), or the ruled Helpr's account is gone
    -- (helper_id set null): the ruling stands; the refund then keeps the card
    -- fee since nobody can be billed it (owner 2026-10-18 ~22:30Z).
    IF v_existing.helper_id IS NULL OR v_existing.helper_id = p_helper_id THEN
      RETURN jsonb_build_object('outcome', 'already_ruled', 'ruling_id', v_existing.id);
    END IF;
    RAISE EXCEPTION 'already_ruled_other_helper' USING ERRCODE = '23505';
  END IF;

  -- Only a paid job has money to give back in full.
  IF v_job.payment_status IS NULL OR v_job.payment_status IN ('unpaid', 'failed') THEN
    RAISE EXCEPTION 'job_not_paid' USING ERRCODE = '22023';
  END IF;

  -- The Helpr was booked here: still the job's Helpr, or the no-show report
  -- (which unassigns them) or their backout left a strike on this job.
  IF v_job.helper_id IS DISTINCT FROM p_helper_id AND NOT EXISTS (
       SELECT 1 FROM public.user_violations v
        WHERE v.user_id = p_helper_id AND v.job_id = p_job_id
          AND v.violation_type IN ('no_show', 'job_denial')) THEN
    RAISE EXCEPTION 'helper_not_booked' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.job_helpr_fault_rulings (job_id, helper_id, admin_id, kind, note, is_seed)
  VALUES (p_job_id, p_helper_id, v_admin, p_kind, btrim(p_note), COALESCE(v_job.is_seed, false))
  RETURNING id INTO v_ruling;

  -- Exactly one strike for this job: the report or the backout usually wrote it.
  IF NOT EXISTS (
       SELECT 1 FROM public.user_violations v
        WHERE v.user_id = p_helper_id AND v.job_id = p_job_id
          AND v.violation_type IN ('no_show', 'job_denial')) THEN
    PERFORM set_config('app.trusted_ladder_write', 'on', true);
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken, reported_by)
    VALUES (p_helper_id,
            CASE p_kind WHEN 'no_show' THEN 'no_show' ELSE 'job_denial' END,
            'Helpr at fault (admin ruling): ' || COALESCE(v_job.title, 'job'),
            p_job_id, 'warning', v_admin);
    v_strike_added := true;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_admin, 'helpr_fault_ruling', 'job', p_job_id::text,
          jsonb_build_object('ruling_id', v_ruling, 'helper_id', p_helper_id, 'kind', p_kind,
                             'note', btrim(p_note), 'strike_added', v_strike_added,
                             'payment_status', v_job.payment_status));

  RETURN jsonb_build_object('outcome', 'ruled', 'ruling_id', v_ruling, 'strike_added', v_strike_added);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_rule_helpr_fault(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rule_helpr_fault(uuid, uuid, text, text) TO authenticated, service_role;

-- report_message_party_and_copy: restated from 20261102040000_declutter_review_report.sql.
CREATE OR REPLACE FUNCTION public.report_message_party_and_copy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  m public.messages%ROWTYPE;
  w public.declutter_wanted%ROWTYPE;
  q public.declutter_questions%ROWTYPE;
  it public.declutter_items%ROWTYPE;
  dr public.declutter_reviews%ROWTYPE;
  dro public.declutter_orders%ROWTYPE;
BEGIN
  -- CHANGED (A3-75): a Declutter review. A member reports only a review they could be shown, by declutter_visible_reviews'
  -- rule (20261021023530, restated in this file): not removed, and the order was handed over 14+ days ago or both sides
  -- have reviewed (the blind rule: until then even its subject can't read it); a test account's review stays hidden
  -- from others under the seed switch. Anything else reads as not found (this runs as the definer, and the copy is
  -- readable by its reporter). Never your own words: the reviewer can't report their own review.
  IF NEW.reported_type = 'declutter_review' THEN
    SELECT * INTO dr FROM public.declutter_reviews WHERE id = NEW.reported_id;
    IF FOUND THEN
      SELECT * INTO dro FROM public.declutter_orders WHERE id = dr.order_id;
    END IF;
    IF dr.id IS NULL OR dro.id IS NULL
       OR (NOT public.is_server_context()
           AND (dr.removed_at IS NOT NULL
                OR NOT (dr.reviewer_id IS NOT DISTINCT FROM NEW.reporter_id
                        OR dro.handed_over_at <= now() - interval '14 days'
                        OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = dr.order_id) = 2)
                OR NOT (dr.reviewee_id IS NOT DISTINCT FROM NEW.reporter_id OR dr.is_seed IS NOT TRUE
                        OR NOT (SELECT public.seed_hidden_from_caller())))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM dr.reviewer_id THEN
      RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
    END IF;
    NEW.reported_content := left(concat_ws(': ', dr.stars || CASE WHEN dr.stars = 1 THEN ' star' ELSE ' stars' END,
                                           NULLIF(btrim(COALESCE(dr.comment, '')), '')), 4000);
    RETURN NEW;
  END IF;
  -- CHANGED (B48): a Declutter question or its answer. A member reports only one they could be shown (not removed, on
  -- an item they can read: the seller's own, a live or reserved one, or one they bought), restated from the questions
  -- row policy and the items read policy (20261030080020), since this runs as the definer. Anything else reads as not
  -- found: the copy is readable by its reporter and would otherwise read out a removed question. An answer report
  -- needs an answer. Never your own words: the asker can't report the question, the seller can't report the answer.
  IF NEW.reported_type IN ('declutter_question', 'declutter_answer') THEN
    SELECT * INTO q FROM public.declutter_questions WHERE id = NEW.reported_id;
    IF FOUND THEN
      SELECT * INTO it FROM public.declutter_items WHERE id = q.item_id;
    END IF;
    IF q.id IS NULL OR it.id IS NULL
       OR (NOT public.is_server_context()
           AND (q.removed_at IS NOT NULL
                OR NOT (it.seller_id = NEW.reporter_id
                        OR (it.status IN ('live', 'reserved') AND NOT it.seller_hidden
                            AND (NOT it.is_seed OR NOT (SELECT public.seed_hidden_in_discovery())))
                        OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                                    WHERE c.item_id = it.id AND c.buyer_id = NEW.reporter_id AND c.status = 'paid')))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NEW.reported_type = 'declutter_answer' AND q.answer IS NULL THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NOT public.is_server_context()
       AND ((NEW.reported_type = 'declutter_question' AND NEW.reporter_id IS NOT DISTINCT FROM q.asker_id)
            OR (NEW.reported_type = 'declutter_answer' AND NEW.reporter_id IS NOT DISTINCT FROM it.seller_id)) THEN
      RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
    END IF;
    NEW.reported_content := left(concat_ws(E'\n', 'Question: ' || q.question, 'Answer: ' || q.answer), 4000);
    RETURN NEW;
  END IF;
  IF NEW.reported_type = 'declutter_wanted' THEN
    SELECT * INTO w FROM public.declutter_wanted WHERE id = NEW.reported_id;
    IF NOT FOUND
       OR (NOT public.is_server_context()
           AND (NOT w.public OR w.removed_at IS NOT NULL OR w.user_id = NEW.reporter_id
                OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    NEW.reported_content := left(w.what, 4000);
    RETURN NEW;
  END IF;
  IF NEW.reported_type IS DISTINCT FROM 'message' THEN
    NEW.reported_content := NULL;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM public.messages WHERE id = NEW.reported_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- L6: only someone in the conversation reports its message.
  IF NOT public.is_server_context()
     AND NEW.reporter_id IS DISTINCT FROM m.sender_id
     AND NEW.reporter_id IS DISTINCT FROM m.receiver_id THEN
    RAISE EXCEPTION 'report_not_allowed' USING ERRCODE = '42501';
  END IF;
  NEW.reported_content := left(concat_ws(E'\n',
    NULLIF(m.content, ''),
    CASE WHEN m.attachment_url IS NOT NULL THEN 'Attachment: ' || m.attachment_url END), 4000);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.report_message_party_and_copy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_message_party_and_copy() TO service_role;
