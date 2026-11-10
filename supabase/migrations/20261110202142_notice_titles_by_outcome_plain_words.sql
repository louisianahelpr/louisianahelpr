-- Whole-app audit 11-10 (Worker 6), WORDING ONLY: no logic, amount, status or link changes.
--   F478 notify_poster_on_status_change: "or Helpr support steps in" now says what happens: "If you don't, our team
--        reviews it and tells you what happens next."
--   F480 declutter_make_offer / declutter_respond_offer / declutter_wanted_reply: "counter" -> "send a different price".
--   F505 apply_job_denial_consequence: "Your Elite shield absorbed this one" -> "Elite protection covered this strike".
--   F503 declutter_admin_decide_problem / declutter_admin_decide_delivery_damage: one title per outcome instead of
--        "Louisiana Helpr decided" on four ("Sale is final", "Refund on your Declutter order", "Part refund on your
--        Declutter order", "Free pickup cancelled by our team", "The free handover stands", "We reviewed your delivery
--        problem", "Sale cancelled after delivery problem"); declutter_admin_decide_stuck_delivery too.
--        declutter_notice_type lists the new titles beside the old, so they keep the declutter_refunds type.
-- Each body is the newest repo definition (effectiveDefs) with ONLY those strings changed; generated, then checked by
-- src/test/noticeTitlesByOutcome.test.ts. Replay-safe: CREATE OR REPLACE keeps each function's grants.

-- notify_poster_on_status_change: from 20261108160000_continue_day_resumes_checks_in_and_new_photos.sql
CREATE OR REPLACE FUNCTION public.notify_poster_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_helper_name text;
  v_category text;
  v_title text;
  v_msg text;
  v_link text;
  v_after int;
  v_approve_by text;
  v_moved_day date;
BEGIN
  IF NEW.helper_id IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The poster's active job lives in the "Scheduled" bucket of My Posts
  -- (postedActivityBucket: in_progress → scheduled). The old
  -- '/posts?job=<id>' used a param the page never reads and landed on the
  -- default "Needs you" list, which hides in-progress jobs.
  v_link := '/posts?job=' || NEW.id::text;
  SELECT public.member_display_name(full_name, 'Your Helpr') INTO v_helper_name
  FROM public.profiles WHERE user_id = NEW.helper_id;
  -- No profiles row: SELECT INTO leaves NULL (member_display_name never runs), every sentence would be NULL, and
  -- notifications.title/message are NOT NULL, so the INSERT would roll back the Helpr's own jobs UPDATE (mark done
  -- included). Same words as member_display_name's fallback. (code-review on this migration, 2026-10-23.)
  v_helper_name := COALESCE(v_helper_name, 'Your Helpr');

  -- Helper on the way
  IF NEW.helper_on_the_way_at IS DISTINCT FROM OLD.helper_on_the_way_at AND NEW.helper_on_the_way_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' is on the way';
    -- A3-36: says whether the poster has anything to do.
    v_msg := v_helper_name || ' is heading to your job: "' || NEW.title || '". Next: nothing for you to do until they arrive.';

  -- Helper arrived
  ELSIF NEW.helper_arrived_at IS DISTINCT FROM OLD.helper_arrived_at AND NEW.helper_arrived_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' has arrived';
    v_msg := v_helper_name || ' has arrived for "' || NEW.title || '". Next: nothing for you to do; they mark it done when they finish.';

  -- Helper started working (status -> in_progress)
  ELSIF NEW.status = 'in_progress'::job_status AND OLD.status IS DISTINCT FROM 'in_progress'::job_status THEN
    v_category := 'work_status';
    -- CHANGED 20261029160717 (audit 2026-10-29 A2-B12): auto_start_due_jobs
    -- sets in_progress at the start time whether or not the Helpr came. With
    -- no arrival recorded (theirs or the poster's word) the notice says so,
    -- never that work started.
    -- CHANGED 20261102235342 (Q2640): a job with no start time is started at the Central midnight that ENDS its day
    -- (20261102100421), so it has no start time to have passed; the notice says its day is over.
    IF NEW.helper_arrived_at IS NULL AND NEW.poster_confirmed_arrival_at IS NULL THEN
      IF NEW.start_time IS NULL THEN
        v_title := 'Job day ended';
        v_msg := v_helper_name || ' hasn''t checked in for "' || NEW.title || '", and its day is over. Open the job to message them or report a no-show.';
      ELSE
        v_title := 'Start time passed';
        v_msg := v_helper_name || ' hasn''t checked in for "' || NEW.title || '". Open the job to message them or report a no-show.';
      END IF;
    ELSE
      v_title := 'Work has started';
      v_msg := v_helper_name || ' has started working on "' || NEW.title || '"';
    END IF;

  -- Helper marked completed
  ELSIF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL THEN
    v_category := 'work_status';
    v_title := v_helper_name || ' marked the job complete';
    -- A3-36: the approval deadline the job page counts down (autoCompleteAt: helper_completed_at +
    -- APPROVAL_WINDOW_HOURS), in Louisiana time.
    v_approve_by := to_char((NEW.helper_completed_at + interval '24 hours') AT TIME ZONE 'America/Chicago',
                            'Dy, Mon FMDD "at" FMHH12:MI AM');
    -- Q2361: the photos waiting for the poster, counted from the row the completion wrote. Blank or NULL entries
    -- are not photos (cardinality() would count them).
    v_after := (SELECT count(*) FROM unnest(COALESCE(NEW.proof_after_urls, '{}'::text[])) AS p(path) WHERE COALESCE(btrim(p.path), '') <> '');
    IF v_after > 0 THEN
      v_msg := v_helper_name || ' finished "' || NEW.title || '" and added ' || v_after::text
        || CASE WHEN v_after = 1 THEN ' after photo' ELSE ' after photos' END
        || '. Next: review them and approve by ' || v_approve_by || '. If you don''t, our team reviews it and tells you what happens next.';
    ELSE
      v_msg := v_helper_name || ' has finished "' || NEW.title || '". Next: check the work and approve by '
        || v_approve_by || '. If you don''t, our team reviews it and tells you what happens next.';
    END IF;
    -- CHANGED 20261108160000 (lead 11-08): a done on a continue day without a new after photo says so first.
    SELECT c.new_date INTO v_moved_day
      FROM public.job_continue_days c
     WHERE c.job_id = NEW.id AND c.done_without_new_photo_at = NEW.helper_completed_at
     ORDER BY c.created_at DESC LIMIT 1;
    IF v_moved_day IS NOT NULL THEN
      v_msg := 'No new photos from ' || to_char(v_moved_day, 'FMDy FMMM/FMDD') || ' — check the work before approving. ' || v_msg;
    END IF;
    -- A completed claim IS the poster's move — send them where the confirm
    -- action lives.
    v_link := '/posts?job=' || NEW.id::text;

  ELSE
    RETURN NEW;
  END IF;

  -- CHANGED 20261108160000 (owner 11-08, F5): the in-app row is ALWAYS written. The poster's switch for the category
  -- ("Helpr on the way" = transit_updates, "Work status" = work_status) gates the PUSH only, which
  -- fan_out_push_on_notification already does through notification_type_pref_map. Before, a switch that was off
  -- skipped the row itself, so the notifications list had no record that the Helpr set out or arrived.
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);
  PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'sent', v_title, NEW.id);

  -- CHANGED 20261108160000 (F5/F6): on the way and arrived email under "Helpr on the way" (email_transit_updates),
  -- marked complete under "Work status" (email_work_status). send-notification-email reads the switch for the type,
  -- the email master switch, and refuses test and seed recipients; "Work has started" keeps its own path.
  IF v_category = 'transit_updates'
     OR (NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL) THEN
    PERFORM public.send_notice_email(NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

-- declutter_make_offer: from 20261102113853_declutter_notices_retire_when_their_subject_moves_on.sql
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
      format('You got a $%s counteroffer on "%s". Accept, decline or send a different price within 48 hours.',
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
    format('You got a $%s offer on "%s". Accept, decline or send a different price within 48 hours.',
           to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.o_title),
    '/declutter?tab=selling', v_uid);
  RETURN v_id;
END;
$fn$;

-- declutter_respond_offer: from 20261103224137_q2390_edit_manage_offer_draft_wanted_reply_not_found_is_404.sql
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
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'PT404';
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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
      format('You got a $%s counteroffer on "%s". Accept, decline or send a different price within 48 hours.',
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

-- declutter_wanted_reply: from 20261103224137_q2390_edit_manage_offer_draft_wanted_reply_not_found_is_404.sql
CREATE OR REPLACE FUNCTION public.declutter_wanted_reply(p_wanted_id uuid, p_item_id uuid, p_amount_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  w public.declutter_wanted;
  i record;
  v_id uuid;
  v_message text;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF public.declutter_seller_out(v_uid) THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Item first, then the post (the offer paths lock item -> offer; nothing else locks a post then an item).
  SELECT it.id, it.seller_id, it.status, it.sale_mode, it.current_price_cents, it.title, it.is_seed,
         it.area_lat, it.area_lng INTO i
    FROM public.declutter_items it WHERE it.id = p_item_id AND it.seller_id = v_uid FOR UPDATE;
  IF i.id IS NULL OR i.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  -- One answer for every post you may not reply to: no oracle for private, blocked or hidden posts.
  IF w.id IS NULL OR NOT w.public OR w.status <> 'open' OR w.expires_at <= now() OR w.user_id = v_uid
     OR public.are_users_blocked(v_uid, w.user_id)
     OR public.declutter_member_out(w.user_id)
     OR public.member_under_18(w.user_id)
     OR public.declutter_seller_hidden(w.user_id)
     OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())) THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF i.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Only a listing that is for sale now can answer.';
  END IF;
  IF i.is_seed IS TRUE AND public.seed_hidden_for(w.user_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- W6: inside the post's distance, measured listing to post (as the match alerts do). IS NOT TRUE: a NULL distance
  -- refuses, never skips the RAISE.
  IF (public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles) IS NOT TRUE THEN
    RAISE EXCEPTION 'listing_too_far' USING ERRCODE = '22023',
      HINT = 'This listing is farther away than the buyer will travel.';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents > least(w.max_price_cents, i.current_price_cents) THEN
    RAISE EXCEPTION 'invalid_reply_amount' USING ERRCODE = '22023',
      HINT = 'Your price is at most their Wanted price and at most your listing''s price.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.wanted_id = w.id AND o.seller_id = v_uid) THEN
    RAISE EXCEPTION 'already_replied' USING ERRCODE = '23505', HINT = 'You already answered this Wanted post.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_reply:' || v_uid::text));
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.seller_id = v_uid AND o.wanted_id IS NOT NULL AND o.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'reply_rate_limited' USING ERRCODE = '54000', HINT = 'You can answer 10 Wanted posts a day.';
  END IF;
  -- Only a listing with no open offer can answer: the answer then depends on the seller's own listing only, never on
  -- WHO the poster is (an "already open between you two" refusal named the poster: review #2).
  IF EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.item_id = i.id AND o.status = 'open') THEN
    RAISE EXCEPTION 'listing_has_open_offer' USING ERRCODE = '55000', HINT = 'This listing has an open offer. Answer with another listing, or after it closes.';
  END IF;
  -- At most 5 answers a day per POST (lead ruling on review N1, 10-21): a per-poster refusal would tell a seller that
  -- two posts share one poster. With at most 10 open posts a poster, that still bounds every later notice the offer
  -- paths send (expiry, voided, closed); the per-poster bound is the silent alert cap below.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_post_answers:' || w.id::text));
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.wanted_id = w.id AND o.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'wanted_busy' USING ERRCODE = '54000', HINT = 'This post has enough answers for today. Try tomorrow.';
  END IF;
  -- The Wanted post is the poster's opening ask; the answer is the seller's counter to it (counter_count 1, a
  -- 'counter' event), so the existing offer wording ("You did not answer the counteroffer within 48 hours",
  -- "The buyer did not answer your counteroffer") is true for it.
  INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, counter_count, wanted_id)
  VALUES (i.id, w.user_id, v_uid, p_amount_cents, 'buyer', now() + interval '48 hours', 1, w.id)
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (v_id, 'seller', 'counter', p_amount_cents);
  -- At most 5 "match" alerts a day per poster (this one included), silently: later answers still arrive as offers,
  -- and nothing the seller sees depends on it.
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.buyer_id = w.user_id AND o.wanted_id IS NOT NULL AND o.created_at > now() - interval '24 hours') <= 5 THEN
    v_message := format('A seller near you has "%s" for $%s, at or under your Wanted price. Accept, decline or send a different price within 48 hours.',
             i.title, to_char(p_amount_cents / 100.0, 'FM999990.00'));
    -- Q2489: the poster is the buyer on this offer, so the notice opens Buying.
    PERFORM public.declutter_notify(w.user_id, 'new_offers', 'A seller has a match', v_message, '/declutter?tab=buying', v_uid);
    -- D4-11: the same words by email, under the Wanted email switch. Same rule as the writer: a test seller never
    -- reaches a real member.
    IF NOT (COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = v_uid), false)
            AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = w.user_id), false)) THEN
      PERFORM public.declutter_wanted_email(w.user_id, 'A seller has a match', v_message, '/declutter?tab=buying');
    END IF;
  END IF;
  RETURN v_id;
END;
$function$;

-- apply_job_denial_consequence: from 20261021062609_memberships_off_paid_perks.sql
CREATE OR REPLACE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prior_count int;
  v_is_elite boolean;
  v_shield_available boolean := false;
BEGIN
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Shielded strikes don't count toward escalation.
  SELECT count(*) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = p_helper
     AND violation_type = 'job_denial'
     AND COALESCE(action_taken, '') <> 'forgiven_elite_shield';

  -- Active Elite + no shield used in the rolling window?
  SELECT (p.subscription_tier = 'elite'
          AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now())
          -- Q1848 (1): no Elite shield while memberships are off for this member.
          AND public.feature_enabled_for_user('memberships', p_helper))
    INTO v_is_elite
    FROM public.profiles p WHERE p.user_id = p_helper;

  IF COALESCE(v_is_elite, false) THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.user_violations
       WHERE user_id = p_helper
         AND action_taken = 'forgiven_elite_shield'
         AND created_at > now() - interval '180 days'
    ) INTO v_shield_available;
  END IF;

  IF v_shield_available THEN
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (p_helper, 'job_denial', p_description, p_job, 'forgiven_elite_shield');
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (p_helper, 'Elite protection covered this strike',
            'Elite members get one reliability strike forgiven every 6 months. This one is forgiven; the next one counts.',
            'info', '/profile?tab=warnings', p_job);
    RETURN jsonb_build_object('action', 'shielded', 'prior_count', v_prior_count);
  END IF;

  RETURN public.apply_consequence_ladder(
    p_user                      => p_helper,
    p_violation_type            => 'job_denial',
    p_description               => p_description,
    p_job_id                    => p_job,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['none', 'warning', 'temp_ban', 'pending_ban_review'],
    p_effects                   => ARRAY['record', 'final_warning', 'suspend', 'permanent'],
    p_copy                      => jsonb_build_array(
      -- Rung 1 is recorded SILENTLY: no notification. Cast is required —
      -- jsonb_build_array is VARIADIC "any" and cannot resolve a bare NULL.
      null::jsonb,
      jsonb_build_object(
        'title', 'Final warning',
        'message', 'This is your second reliability strike. One more — backing out of a job you accepted — and your account is suspended for 7 days.'),
      jsonb_build_object(
        'title', 'Account suspended for 7 days',
        'message', 'Third reliability strike — your account is suspended for 7 days. A fourth strike restricts your account again while an admin decides whether to ban it permanently.'),
      jsonb_build_object(
        'title', 'Account restricted for 7 days',
        'message', 'Fourth reliability strike — your account is restricted for 7 days and an admin is reviewing it for a permanent ban. If you think this is wrong, email admin@louisianahelpr.com.')
    ),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => false,
    p_admin_message_format      => '%s has %s reliability strikes on file (backed out of jobs they accepted) and is restricted for 7 days pending your decision.',
    -- Unused while p_permanent_requires_review is true; kept so the direct-ban
    -- path stays fully specified if that policy is ever revisited.
    p_ban_reason                => 'Fourth reliability strike (backed out of jobs they accepted)'
  );
END;
$function$
;

-- declutter_admin_decide_problem: from 20261109224952_notices_card_fee_and_our_team.sql
CREATE OR REPLACE FUNCTION public.declutter_admin_decide_problem(p_problem_id uuid, p_decision text, p_fault text,
  p_strike boolean, p_note text, p_false_report boolean DEFAULT false, p_part_cents integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
  o public.declutter_orders;
  v_order uuid;
  v_out jsonb;
  v_task public.helpr_tasks;
  -- CHANGED (B45): the Helpr a 'helpr' fault falls on: the task's Helpr, or, once released, the one released.
  v_fault_helpr uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- D2-14 (owner 2026-10-29: allow partial): 'refund_part' gives back exactly p_part_cents of the item price.
  IF p_decision IS NULL OR p_decision NOT IN ('refund_buyer', 'pay_seller', 'refund_part')
     OR (p_decision = 'refund_part') <> (p_part_cents IS NOT NULL)
     -- CHANGED (LEAD-ADMIN-HELPR-FAULT): 'helpr', the Helpr's fault in a delivery they never brought (checked below).
     OR p_fault IS NULL OR p_fault NOT IN ('seller', 'buyer', 'none', 'helpr')
     OR p_strike IS NULL OR (p_strike AND p_fault = 'none')
     -- AL-5: a false report is its own explicit choice, never NULL; its strike is the false-report strike, not a
     -- second one on top.
     OR p_false_report IS NULL OR (p_false_report AND p_strike) THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    -- Another admin decides a sale you are part of (both reviews, 2026-10-15).
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  -- Slice 5: the order's Helpr task, if any.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id;
  v_fault_helpr := COALESCE(v_task.helpr_id, v_task.released_helpr_id);
  -- CHANGED (B45): nor a delivery you were released from.
  IF v_task.id IS NOT NULL AND (v_uid IS NOT DISTINCT FROM v_task.helpr_id OR v_uid IS NOT DISTINCT FROM v_task.released_helpr_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  -- AL-5 (anti-lying #5, owner 2026-10-28): "The report was false" goes against the person who reported it. Only
  -- a buyer's or a seller's report (a Helpr's report is a delivery matter, struck on the Helpr's own record); the
  -- reporter's side is at fault; and the decision goes the other way: a buyer's false report pays the seller, a
  -- seller's false report refunds the buyer.
  IF p_false_report AND (p.reporter_side NOT IN ('buyer', 'seller') OR p.reporter_id IS NULL
                         OR p_fault IS DISTINCT FROM p.reporter_side
                         OR p_decision IS DISTINCT FROM CASE p.reporter_side WHEN 'buyer' THEN 'pay_seller' ELSE 'refund_buyer' END) THEN
    RAISE EXCEPTION 'false_report_mismatch' USING ERRCODE = '22023',
      HINT = 'A false report goes against whoever reported it: their side is at fault, and the decision goes the other way.';
  END IF;
  -- Slice 5 (lh-money-escrow review #1): refunding the buyer on a delivery the
  -- Helpr already has pays the Helpr for the trip (B69). For an item reported
  -- damaged or not received that would pay the Helpr who may have caused it,
  -- so the admin decides it explicitly instead: "Damaged in delivery" (row 43,
  -- declutter_admin_decide_delivery_damage: the Helpr is not paid) or
  -- "Pay the seller".
  -- B77: after a Helpr's "the seller wasn't there" the item never left the
  -- seller, so "Pay the seller" would close a sale the buyer never received
  -- (lh-money-escrow re-review #2). The admin refunds the buyer instead (whose
  -- fault decides the card fee); the item stays with the seller.
  IF p_decision = 'pay_seller' AND p.reporter_side = 'helpr' THEN
    -- CHANGED (BUY-36): those words are only true before the Helpr picked it up.
    IF v_task.status IN ('picked_up', 'delivered') THEN
      RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
        HINT = 'The Helpr has this item. Decide it as nobody''s fault, the Helpr''s fault, or damaged in delivery.';
    END IF;
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The item never left the seller. Refund the buyer, and say whose fault it was.';
  END IF;
  -- CHANGED (BUY-36): a delivery reported as can't finish is decided by fault too: a plain refund would pay the Helpr.
  IF p_decision IN ('refund_buyer', 'refund_part') AND v_task.status = 'picked_up' AND v_task.stuck_at IS NOT NULL THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The Helpr has this item. Decide it as nobody''s fault, the Helpr''s fault, or damaged in delivery.';
  END IF;
  IF p_decision IN ('refund_buyer', 'refund_part') AND p.reason IN ('damaged', 'not_received')
     AND v_task.status IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The Helpr has this item. Decide it as damaged in delivery, or pay the seller.';
  END IF;
  -- CHANGED (LEAD-ADMIN-HELPR-FAULT, owner rule 10-30 "Helpr's fault, Helpr bears it"): a disputed "the Helpr didn't
  -- come" is decided as the Helpr's fault only as a full refund before the handover, on a delivery a Helpr took and
  -- never picked up. The buyer gets everything back, delivery included; the card fee is a debt on that Helpr, taken
  -- from their next payout (declutter_record_refund 'helpr_fault'); they are not paid; the strike is theirs. After a
  -- pickup the delivery is decided as can't finish (declutter_admin_decide_stuck_delivery) or as damaged.
  IF p_fault = 'helpr' AND (p_decision <> 'refund_buyer' OR o.status <> 'paid' OR p_false_report
                            OR v_task.id IS NULL OR v_fault_helpr IS NULL
                            -- CHANGED (B45, lead 10-31): or released after the Helpr didn't come and not taken again (back up
                            -- for another Helpr, helpr_id NULL): the released Helpr's id decides it.
                            OR NOT (v_task.status = 'accepted' OR (v_task.status = 'open' AND v_task.helpr_id IS NULL))) THEN
    RAISE EXCEPTION 'helpr_fault_not_possible' USING ERRCODE = '22023',
      HINT = 'The Helpr''s fault is a full refund, before the handover, on a delivery a Helpr took and never picked up.';
  END IF;
  -- D2-14: a part refund exists only after the handover (the buyer keeps the item; before it, the order is refunded
  -- in full or the sale goes ahead), above $0 and below the item price (declutter_refund_after_handover checks again).
  IF p_decision = 'refund_part' AND o.status <> 'handed_over' THEN
    RAISE EXCEPTION 'part_refund_after_handover_only' USING ERRCODE = '55000',
      HINT = 'A part refund is for an item the buyer keeps. Before the handover, refund in full or pay the seller.';
  END IF;
  IF p_decision = 'refund_part' AND (p_part_cents <= 0 OR p_part_cents >= o.items_cents) THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023',
      HINT = 'A part refund is above $0 and below the item price. To give it all back, choose Refund the buyer.';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = p_decision, fault = p_fault, strike_given = p_strike,
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  IF o.status = 'handed_over' THEN
    -- 141d: a problem reported in the window after the handover. The payout is still held (never sent).
    IF p_decision = 'refund_part' THEN
      -- D2-14: exactly the amount decided, the buyer keeps the item; the rest of the payout still goes to the seller.
      v_out := public.declutter_refund_after_handover(o.id, 'refund_request_part', p_part_cents);
    ELSIF p_decision = 'pay_seller' THEN
      v_out := jsonb_build_object('result', 'seller_keeps', 'order_id', o.id);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Sale is final',
        'We looked at both sides. The seller keeps the payment, and the sale is final.', '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale is final',
        'We looked at both sides. You keep the payment; we send it to your payout account.', '/declutter?view=selling', o.buyer_id);
    ELSE
      v_out := public.declutter_refund_after_handover(o.id,
        CASE p_fault WHEN 'seller' THEN 'not_as_described' WHEN 'buyer' THEN 'admin_buyer_fault' ELSE 'admin_no_fault' END, NULL);
    END IF;
    IF p_strike THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_fault = 'seller' THEN o.seller_id ELSE o.buyer_id END, p_fault,
        CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
        (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
        'Our team decided a reported problem on a Declutter sale against you.',
        (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1));
    END IF;
  ELSIF p_decision = 'pay_seller' THEN
    v_out := public.declutter_complete_handover(o.id, 'admin');
    IF p_strike THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_fault = 'seller' THEN o.seller_id ELSE o.buyer_id END, p_fault,
        CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
        (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
        'Our team decided a reported problem on a Declutter sale against you.', NULL);
    END IF;
  ELSIF p_fault = 'helpr' THEN
    -- CHANGED (LEAD-ADMIN-HELPR-FAULT): the task fails first (it keeps its Helpr, so the refund's debt finds them, and
    -- declutter_close_paid_order neither pays nor reopens it), then the full refund.
    -- CHANGED (B45): a released task gets its released Helpr back first, so the refund's debt (declutter_record_refund
    -- reads the task's Helpr) falls on them and the task stops being offered to other Helprs.
    UPDATE public.helpr_tasks SET status = 'failed', helpr_id = v_fault_helpr, closed_at = now(), close_note = 'Decided as the Helpr''s fault', updated_at = now()
     WHERE id = v_task.id;
    PERFORM public.helpr_task_log(v_task.id, 'failed', v_uid, 'decided: helpr fault');
    IF p_strike THEN
      PERFORM public.helpr_task_give_job_strike(v_fault_helpr, 'delivery_no_show', v_task.id, 'Our team decided you did not come for a Helpr delivery');
    END IF;
    v_out := public.declutter_close_paid_order(o.id, 'helpr_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(v_fault_helpr, 'warning', 'Delivery decided',
      format('Our team decided "%s" wasn''t delivered because of you. You are not paid for this delivery, and the buyer''s card cost comes out of your next payout.', v_task.title),
      '/declutter?tab=deliver', NULL);
  ELSE
    v_out := public.declutter_close_paid_order(o.id,
      CASE p_fault WHEN 'seller' THEN 'not_as_described' WHEN 'buyer' THEN 'admin_buyer_fault' ELSE 'admin_no_fault' END,
      CASE WHEN p_strike THEN p_fault END,
      CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
      'Our team decided a reported problem on a Declutter sale against you.');
  END IF;
  -- D2-5 (audit 1b #5): a refund request that came to the admin with this problem ends with the decision, so
  -- neither refund panel keeps saying "Louisiana Helpr is looking". A refund closes it as agreed (with the
  -- refund), paying the seller closes it as declined. Only on a handed-over sale: a request exists only there.
  IF o.status = 'handed_over' THEN
    UPDATE public.declutter_refund_requests
       SET status = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN 'agreed' ELSE 'declined' END,
           refund_id = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN (v_out->>'refund_id')::uuid ELSE refund_id END,
           settled_at = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN now() ELSE settled_at END,
           declined_at = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN declined_at ELSE now() END
     WHERE order_id = o.id AND problem_id = p.id AND status = 'to_admin';
  END IF;
  -- A2-14 (20261028223738): both sides are told the decision. The one path that already said it (a sale already
  -- handed over, "Pay the seller", above) is left as it is; every other path only sent the handover or refund
  -- notice, which never said Louisiana Helpr had decided. A refund's amount stays in its own notice.
  IF NOT (o.status = 'handed_over' AND p_decision = 'pay_seller') THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment',
      CASE WHEN o.paid_with = 'free' AND p_decision = 'pay_seller' THEN 'The free handover stands'
              WHEN o.paid_with = 'free' THEN 'Free pickup cancelled by our team'
              WHEN p_decision = 'pay_seller' THEN 'Sale is final'
              WHEN p_decision = 'refund_part' THEN 'Part refund on your Declutter order'
              ELSE 'Refund on your Declutter order' END,
      format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
        CASE WHEN o.paid_with = 'free' AND p_decision = 'pay_seller' THEN 'The handover stands.'
             WHEN o.paid_with = 'free' THEN 'This free pickup is cancelled.'
             WHEN p_decision = 'pay_seller' THEN 'The seller keeps the payment, and the sale is final.'
             WHEN p_decision = 'refund_part' THEN 'We are refunding you part of the price, and you keep the item. A separate notice says how much.'
             WHEN p_fault = 'helpr' THEN 'It was the Helpr''s fault, so all of your money is coming back, delivery included.'
             ELSE 'We are refunding you. A separate notice says how much.' END),
      '/declutter?tab=buying', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment',
      CASE WHEN o.paid_with = 'free' AND p_decision = 'pay_seller' THEN 'The free handover stands'
              WHEN o.paid_with = 'free' THEN 'Free pickup cancelled by our team'
              WHEN p_decision = 'pay_seller' THEN 'Sale is final'
              WHEN p_decision = 'refund_part' THEN 'Part refund on your Declutter order'
              ELSE 'Refund on your Declutter order' END,
      format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
        CASE WHEN o.paid_with = 'free' AND p_decision = 'pay_seller' THEN 'The handover stands.'
             WHEN o.paid_with = 'free' THEN 'This free pickup is cancelled.'
             WHEN p_decision = 'pay_seller' THEN 'You keep the payment.'
             WHEN p_decision = 'refund_part' THEN 'We are refunding the buyer part of the price; it comes out of your payout for this sale, and the buyer keeps the item.'
             ELSE 'We are refunding the buyer, so this sale is cancelled.' END),
      '/declutter?tab=selling', o.buyer_id);
  END IF;
  -- AL-5: the reporter's Declutter strike for a proven false report (3 active strikes = locked out of Declutter,
  -- declutter_assert_member). Given after the decision, so a refusal above gives none; recorded on the problem
  -- (strike_given) and in the audit row.
  IF p_false_report THEN
    UPDATE public.declutter_problems SET strike_given = true WHERE id = p.id;
    PERFORM public.declutter_give_strike(p.reporter_id, p.reporter_side, 'false_report',
      (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
      'Louisiana Helpr looked at the problem you reported on a Declutter sale and found it was not true.', NULL);
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', p_decision, 'fault', p_fault, 'strike', p_strike,
                             'false_report', p_false_report, 'part_cents', p_part_cents, 'result', v_out));
  RETURN v_out;
END;
$function$
;

-- declutter_admin_decide_delivery_damage: from 20261103230126_q2390_refund_answers_admin_decisions_payout_arrival_ban_not_found_is_404.sql
CREATE OR REPLACE FUNCTION public.declutter_admin_decide_delivery_damage(p_problem_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
  o public.declutter_orders;
  v_order uuid;
  v_task public.helpr_tasks;
  v_hand jsonb;
  v_refund uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'not_a_delivery_in_transit' USING ERRCODE = '55000',
      HINT = 'Only a delivery the Helpr picked up can be decided as damaged in delivery.';
  END IF;
  IF v_uid = v_task.helpr_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'delivery' OR v_task.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'not_a_delivery_in_transit' USING ERRCODE = '55000',
      HINT = 'Only a delivery the Helpr picked up can be decided as damaged in delivery.';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = 'delivery_damage', fault = 'none', strike_given = false,
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  -- The Helpr: not paid, a delivery strike (row 43).
  UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'Damaged in delivery', updated_at = now()
   WHERE id = v_task.id;
  PERFORM public.helpr_task_log(v_task.id, 'failed', v_uid, 'damaged in delivery');
  PERFORM public.helpr_task_give_job_strike(v_task.helpr_id, 'delivery_damage', v_task.id,
    'An item was damaged during a Helpr delivery you made');
  -- AUD31-34: the Helpr is told which item.
  PERFORM public.declutter_notify(v_task.helpr_id, 'warning', 'Delivery decided: damaged',
    format('Louisiana Helpr decided %s was damaged during your delivery. You are not paid for this delivery.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=deliver', NULL);
  -- The seller: paid (the handover completes as an admin decision; the task is
  -- already 'failed', so no Helpr payout is written).
  -- 20261028232338: the buyer is refunded in full, so the handover's "Enjoy your item ... the sale is final" is not sent
  -- (transaction-local: set_config(..., true); PostgREST gives a member no way to call set_config).
  PERFORM set_config('declutter.no_enjoy_notice', o.id::text, true);
  v_hand := public.declutter_complete_handover(o.id, 'admin');
  PERFORM set_config('declutter.no_enjoy_notice', '', true);
  -- The buyer: everything back (full_platform_absorbs). Held until the
  -- seller's payout has gone (declutter_refunds_due).
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, 'delivery_damage', o.total_cents, o.card_fee_cents);
  -- AUD31-34: the buyer is told which item, with the seller as counterpart, on their own tab.
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    format('We''re refunding %s: it was damaged in delivery. All $%s is coming back to your card.',
           public.declutter_order_items_named(o.id), to_char(o.total_cents / 100.0, 'FM999990.00')),
    '/declutter?tab=buying', o.seller_id);  -- AUD31-34: the seller is the counterpart.
  -- A2-14 (20261028223738): both sides are told the decision (before, the seller heard only "Handover done").
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'We reviewed your delivery problem',
    format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
      'It was damaged in delivery, so all of your money is coming back.'),
    '/declutter?tab=buying', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'We reviewed your delivery problem',
    format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
      'It was damaged in delivery, which is not on you: you keep the payment.'),
    '/declutter?tab=selling', o.buyer_id);
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', 'delivery_damage', 'task_id', v_task.id,
                             'handover', v_hand, 'refund_id', v_refund));
  RETURN jsonb_build_object('result', 'delivery_damage', 'refund_id', v_refund, 'payout_id', v_hand->'payout_id');
END;
$fn$;

-- declutter_admin_decide_stuck_delivery: from 20261109224952_notices_card_fee_and_our_team.sql
CREATE OR REPLACE FUNCTION public.declutter_admin_decide_stuck_delivery(p_problem_id uuid, p_fault text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
  o public.declutter_orders;
  v_order uuid;
  v_task public.helpr_tasks;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_fault IS NULL OR p_fault NOT IN ('none', 'helpr') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NULL OR v_task.status <> 'picked_up' OR o.status <> 'paid' THEN
    RAISE EXCEPTION 'not_a_delivery_in_transit' USING ERRCODE = '55000', HINT = 'Only a delivery a Helpr has picked up can be decided here.';
  END IF;
  IF v_uid = v_task.helpr_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = 'refund_buyer', fault = 'none', strike_given = (p_fault = 'helpr'),
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  IF p_fault = 'none' THEN
    v_out := public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on your Declutter order',
      format('We looked at the problem with %s. It was nobody''s fault, so the sale is cancelled. You get back what you paid, less what the delivery cost, which paid the Helpr for the trip, and less the card cost.',
             public.declutter_order_items_named(o.id)), '/declutter?tab=buying', o.seller_id);
  ELSE
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'Decided as the Helpr''s fault', updated_at = now() WHERE id = v_task.id;
    PERFORM public.helpr_task_log(v_task.id, 'failed', v_uid, 'decided: helpr fault');
    PERFORM public.helpr_task_give_job_strike(v_task.helpr_id, 'delivery_backed_out', v_task.id, 'Could not finish a Helpr delivery after picking it up');
    v_out := public.declutter_close_paid_order(o.id, 'helpr_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(v_task.helpr_id, 'warning', 'Delivery decided',
      format('Our team decided "%s" wasn''t finished because of you. You are not paid for this delivery.', v_task.title), '/declutter?tab=deliver', NULL);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on your Declutter order',
      format('We looked at the problem with %s. All of your money is coming back, delivery included.', public.declutter_order_items_named(o.id)),
      '/declutter?tab=buying', o.seller_id);
  END IF;
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale cancelled after delivery problem',
    format('We looked at the problem with %s. The sale is cancelled and the buyer refunded.', public.declutter_order_items_named(o.id)),
    '/declutter?tab=selling', o.buyer_id);
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', 'stuck_delivery', 'fault', p_fault, 'task_id', v_task.id, 'result', v_out));
  RETURN v_out;
END;
$function$
;

-- declutter_notice_type: from 20261104123305_bundle_request_export_and_notice_kinds.sql
CREATE OR REPLACE FUNCTION public.declutter_notice_type(p_type text, p_title text, p_link text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    -- The caller already chose a Declutter kind.
    WHEN p_type IN ('declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups',
                    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted', 'declutter_questions') THEN p_type
    -- Not a Declutter screen: Shops orders, setup jobs, admin alerts, earnings.
    WHEN p_link IS NULL OR p_link NOT LIKE '/declutter%' THEN p_type
    -- A Helpr's delivery work is work, not their own buying or selling.
    WHEN p_link LIKE '/declutter?view=deliver%' OR p_link LIKE '/declutter?tab=deliver%' THEN p_type
    -- Saved-search matches have their own per-search switches.
    WHEN p_type = 'job_match' THEN p_type
    WHEN p_title IN ('Listing sent for review', 'Your listing is live', 'Your listing needs a change',
                     'Your item is now free', 'Haul-away is open', 'Haul-away not booked',
                     'Haul-away refunded', 'Back on sale', 'Donation receipt',
                     -- Listing rounds (sell flow, 20261028164424, lands after this file)
                     'Your listing goes back up soon', 'Your listing comes down soon',
                     'Back up for another 30 days', 'Your listing came down')
      THEN 'declutter_listings'
    WHEN p_title IN ('New offer', 'New counteroffer', 'Offer declined', 'Offer withdrawn', 'Offer expired',
                     'Item no longer available', 'Item paused', 'Item taken down', 'Item off sale',
                     'Now free', 'Item came down',
                     -- Smart offers (20261029162620): an offer the seller's rules answered.
                     'Offer accepted automatically', 'Offer answered automatically',
                     -- Bundle requests (20261104103528): an ask and its answers are offers.
                     'Bundle request', 'Bundle request declined', 'Bundle request closed', 'Bundle request expired')
      THEN 'declutter_offers'
    WHEN p_title IN ('It''s yours', 'Reserved for you: check out within 48 hours',
                     'It''s yours: pick a pickup within 48 hours', 'Free item claimed',
                     'Someone claimed your free item', 'Sold: waiting for the buyer to pay',
                     'Check out within 24 hours', '2 hours left to check out', 'Checkout closed',
                     'Buyer did not check out', 'The seller cancelled', 'This sale was cancelled',
                     'Sale cancelled', 'Free pickup cancelled', 'Payment received', 'Buyer paid',
                     'Card saved', 'Handover done', 'Enjoy your item', 'Amount owed', 'Amount owed added',
                     'An amount owed comes out of your next payout', 'Setup fee coming back',
                     'Delivery pay raised', 'Your raise is coming back',
                     -- Shipping S6 (20261102030530, 20261102055653)
                     'Order cancelled: no charge', 'Shipping label added to what you owe', 'Don''t ship it',
                     -- Bundle requests (20261104103528): an accepted bundle waits to be paid, like 'Check out within 24 hours'.
                     'Bundle accepted: pay within 24 hours', 'Save a card to get your bundle')
      THEN 'declutter_sales'
    WHEN p_title IN ('Pickup booked', 'Pickup time changed', 'Pickup time cancelled', 'You missed your pickup',
                     'Your buyer is at the meeting spot', 'The seller is at the meeting spot',
                     'Your item is on the porch', 'Your item was picked up', 'Picked up', 'Delivered',
                     'Delivery booked', 'Delivery changed', 'Delivery coming up', 'Delivery time kept',
                     'Delivery time changed', 'New delivery time asked', 'Pick a new delivery time',
                     'Buyer is picking a delivery time', 'Your items were delivered', 'Your item is on its way',
                     'A Helpr took your delivery', 'A Helpr will pick it up', 'Helpr pickup booked',
                     'Finding another Helpr', 'The Helpr couldn''t pick up', 'Your delivery is on hold',
                     'Your delivery fell through', 'No Helpr took your delivery', 'The buyer will pick it up')
      THEN 'declutter_pickups'
    WHEN p_title IN ('Refund request', 'Refund request withdrawn', 'Refund on its way', 'Buyer refunded',
                     'Your refund did not go through', 'Your refund is being sent by hand',
                     'The seller agreed to a full refund', 'Full refund agreed',
                     'The seller offered a part refund', 'The seller said no',
                     'Louisiana Helpr will decide', 'Louisiana Helpr decided',
                     -- F503 (20261110202142): the decision notices' titles by outcome
                     'Sale is final', 'The free handover stands', 'Free pickup cancelled by our team',
                     'Part refund on your Declutter order', 'Refund on your Declutter order',
                     'We reviewed your delivery problem', 'Sale cancelled after delivery problem',
                     'A problem was reported on your sale', 'You got a Declutter strike',
                     'Your strike was removed',
                     -- Shipping S6 (20261102051521)
                     'Shipping refund on its way')
      THEN 'declutter_refunds'
    WHEN p_title IN ('A seller has a match')
      THEN 'declutter_wanted'
    WHEN p_title IN ('New question', 'The seller answered')
      THEN 'declutter_questions'
    -- A title nobody listed yet still lands in the Declutter group, by its old type.
    WHEN p_type IN ('new_offers', 'expired') THEN 'declutter_offers'
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'transit_updates') THEN 'declutter_pickups'
    WHEN p_type IN ('warning', 'system_alert') THEN 'declutter_refunds'
    WHEN p_type IN ('payment', 'financial_alerts') THEN 'declutter_sales'
    WHEN p_type IN ('info', 'success') THEN 'declutter_listings'
    ELSE p_type
  END;
$fn$;
