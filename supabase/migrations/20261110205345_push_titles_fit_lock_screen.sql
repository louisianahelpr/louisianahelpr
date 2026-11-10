-- Whole-app audit 11-10 (Worker 6), WORDING ONLY: no logic, amount, status or link changes.
--   F508 push titles over 40 characters are cut off on a lock screen. Every member-facing title that was longer now
--        fits; the detail it dropped is in the body. Old -> new:
--        'Bundle accepted: waiting for the buyer to pay' -> 'Bundle accepted: waiting on payment' (declutter_answer_bundle)
--        'Your delivery pay is being sent by our team' -> 'Our team is sending your delivery pay' (declutter_delivery_gave_up_check)
--        'Declutter problem: the other side answered' -> 'Declutter problem: other side answered' (declutter_answer_no_show)
--        'Trade accepted: choose a pickup within 48 hours' -> 'Trade accepted: pick a pickup time' (declutter_respond_swap)
--        'Trade set: choose a pickup within 48 hours' -> 'Trade set: pick a pickup time' (declutter_respond_swap)
--        'It''s yours: pick a pickup within 48 hours' -> 'It''s yours: pick a pickup time' (declutter_take_item)
--        'Reserved for you: check out within 30 minutes' -> 'Reserved: check out within 30 minutes' (declutter_take_item)
--        'Reserved for you: check out within 24 hours' -> 'Reserved for you: check out in 24 hours' (declutter_take_item)
--        'Louisiana Helpr is looking at this delivery' -> 'Our team is looking at this delivery' (helpr_task_sweep; its
--          bodies say "our team decides" instead of "it decides")
--        'You''re booked for two jobs at the same time' -> 'Two jobs booked at the same time' (notify_helpr_of_booking_clash)
--        'Revision deadline passed — dispute opened' -> 'Revision deadline passed: dispute opened' (open_dispute_as)
--        'A Helpr on your crew hasn''t confirmed yet' / 'N Helprs on your crew haven''t confirmed yet'
--          -> 'A crew Helpr hasn''t confirmed yet' / 'N crew Helprs haven''t confirmed yet' (sweep_dayof_confirm_reminders)
--        Admin-only alert titles (the owner's admin inbox) are left as they are: shortening them loses the detail
--        they exist to carry.
--   F504 declutter_manager_end: the title names who did what ("<Name> ended your Declutter access" to the manager,
--        "<Name> stopped managing your Declutter" to the seller, was 'Declutter managing ended' for both); the body
--        says "Sales already paid for still go through." instead of "Shares already locked on sales still pay."
-- Readers keyed on a title list the new title beside the old one, so rows already written keep their behaviour:
-- declutter_notice_type (notice kind), sms_kind_for (no SMS for the crew reminder), jobs_notice_email_type (the
-- dispute notice is emailed), guarantee_filing_skips_revision_notice and its trigger (the platform filing's copy is
-- dropped during a guarantee filing), trg_email_declutter_notice / trg_email_declutter_trade_notice (the trade
-- "accepted" notice is emailed once; "Trade set" stays in the bell only).
-- Each body is the newest repo definition (effectiveDefs) with ONLY those strings changed; generated, then checked by
-- src/test/pushTitlesFitLockScreen.test.ts. Replay-safe: CREATE OR REPLACE keeps each function's grants; triggers are
-- DROP IF EXISTS + CREATE. MONEY: none. AUTHZ: none.

-- declutter_manager_end: from 20261101181005_declutter_manager_mode.sql
CREATE OR REPLACE FUNCTION public.declutter_manager_end(p_grant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_g public.declutter_manager_grants%ROWTYPE;
  v_to text;
  v_other uuid;
BEGIN
  SELECT * INTO v_g FROM public.declutter_manager_grants WHERE id = p_grant_id FOR UPDATE;
  IF v_g.id IS NULL OR v_uid IS NULL OR (v_g.seller_id <> v_uid AND v_g.manager_id <> v_uid) THEN
    RAISE EXCEPTION 'not_your_grant' USING ERRCODE = '42501';
  END IF;
  IF v_g.status NOT IN ('offered', 'active') THEN
    RETURN v_g.status;
  END IF;
  v_to := CASE WHEN v_g.status = 'offered' AND v_uid = v_g.seller_id THEN 'withdrawn'
               WHEN v_g.status = 'offered' THEN 'declined'
               ELSE 'ended' END;
  UPDATE public.declutter_manager_grants
     SET status = v_to, ended_at = now(), ended_by = v_uid, updated_at = now(),
         responded_at = COALESCE(responded_at, CASE WHEN v_to = 'declined' THEN now() END)
   WHERE id = p_grant_id;
  v_other := CASE WHEN v_uid = v_g.seller_id THEN v_g.manager_id ELSE v_g.seller_id END;
  IF v_to = 'ended' THEN
    PERFORM public.declutter_notify(v_other, 'declutter_listings', CASE WHEN v_uid = v_g.seller_id
        THEN format('%s ended your Declutter access', public.declutter_manager_first_name(v_uid))
        ELSE format('%s stopped managing your Declutter', public.declutter_manager_first_name(v_uid)) END,
      CASE WHEN v_uid = v_g.seller_id
        THEN format('%s ended your access to their Declutter. Sales already paid for still go through.',
                    public.declutter_manager_first_name(v_uid))
        ELSE format('%s stopped managing your Declutter.', public.declutter_manager_first_name(v_uid)) END,
      '/declutter?tab=selling', v_uid);
  END IF;
  RETURN v_to;
END;
$fn$;

-- declutter_answer_bundle: from 20261108202546_declutter_notices_email_and_honest_sold.sql
CREATE OR REPLACE FUNCTION public.declutter_answer_bundle(p_request_id uuid, p_accept_item_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_req record;
  v_all boolean := p_accept_item_ids IS NULL;
  v_row record;
  v_item record;
  v_line uuid;
  v_accepted integer := 0;
  v_gone integer := 0;
BEGIN
  -- Q281 ban gate (lander 11-04): a banned account cannot ask for, or answer, a bundle (the same refusal as declutter_request_free).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter');
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO v_req FROM public.declutter_bundle_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.seller_id <> v_uid THEN
    RAISE EXCEPTION 'bundle_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_req.status <> 'open' OR v_req.respond_by <= now() THEN
    RAISE EXCEPTION 'bundle_not_open' USING ERRCODE = '55000', HINT = 'This request is already closed.';
  END IF;
  IF NOT v_all AND EXISTS (SELECT 1 FROM unnest(p_accept_item_ids) x
                            WHERE x IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_bundle_request_items bi
                                                             WHERE bi.request_id = p_request_id AND bi.item_id = x)) THEN
    RAISE EXCEPTION 'bundle_item_not_in_request' USING ERRCODE = '22023';
  END IF;

  IF NOT v_all AND cardinality(p_accept_item_ids) = 0 THEN
    UPDATE public.declutter_bundle_requests SET status = 'declined', closed_at = now() WHERE id = p_request_id;
    UPDATE public.declutter_bundle_request_items SET outcome = 'not_picked' WHERE request_id = p_request_id;
    PERFORM public.declutter_notify(v_req.buyer_id, 'new_offers', 'Bundle request declined',
      'The seller said no to your bundle request this time. Nothing was charged.', '/declutter?tab=buying', v_uid);
    RETURN 0;
  END IF;

  IF public.member_under_18(v_req.buyer_id) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;
  -- Review 11-04: the buyer's saved card once, before anything is held. A buyer who removed it is asked to save one,
  -- and the request stays open so the seller can answer again: nothing held, nothing charged. -1 tells the seller.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = v_req.buyer_id) THEN
    -- Q2731: asked at most once per request (card_asked_at), however often the seller taps.
    UPDATE public.declutter_bundle_requests SET card_asked_at = now() WHERE id = p_request_id AND card_asked_at IS NULL;
    IF FOUND THEN
      PERFORM public.declutter_notify(v_req.buyer_id, 'payment', 'Save a card to get your bundle',
        'The seller wants to accept your bundle request. Save a card in Declutter so they can; it is charged only when you check out.',
        '/declutter?tab=buying', v_uid);
    END IF;
    RETURN -1;
  END IF;

  -- Q2731: one notice to each side for the whole bundle: declutter_take_item (20261104124645) skips its per-item
  -- ones while this is 'on'. Transaction-local; turned off again after the loop.
  PERFORM set_config('declutter.bundle_take', 'on', true);
  FOR v_row IN
    SELECT bi.item_id, bi.price_cents FROM public.declutter_bundle_request_items bi
     WHERE bi.request_id = p_request_id ORDER BY bi.item_id
  LOOP
    IF NOT v_all AND NOT (v_row.item_id = ANY (p_accept_item_ids)) THEN
      UPDATE public.declutter_bundle_request_items SET outcome = 'not_picked'
       WHERE request_id = p_request_id AND item_id = v_row.item_id;
      CONTINUE;
    END IF;
    BEGIN
      -- The buyer's checks again (card, blocks, seed rules, still live), as the buyer.
      SELECT * INTO v_item FROM public.declutter_lock_buyable_item(v_row.item_id, v_req.buyer_id);
      -- Review 11-04: a price under $1 today (made free meanwhile) is never taken through the bundle.
      IF v_item.o_seller_id <> v_uid OR least(v_row.price_cents, v_item.o_price_cents) < 100 THEN
        RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000';
      END IF;
      v_line := public.declutter_take_item(v_row.item_id, v_req.buyer_id, least(v_row.price_cents, v_item.o_price_cents),
                                           'offer', NULL);
      UPDATE public.declutter_bundle_request_items SET outcome = 'accepted', line_id = v_line
       WHERE request_id = p_request_id AND item_id = v_row.item_id;
      v_accepted := v_accepted + 1;
    EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE 'PT404' OR SQLSTATE 'P0002' OR SQLSTATE '22023' THEN
      -- Sold, held for someone else, hidden, blocked, or no longer an offers-mode sale (22023, review 11-04)
      -- meanwhile: never charged; the rest of the bundle goes on.
      UPDATE public.declutter_bundle_request_items SET outcome = 'unavailable'
       WHERE request_id = p_request_id AND item_id = v_row.item_id;
      v_gone := v_gone + 1;
    END;
  END LOOP;
  PERFORM set_config('declutter.bundle_take', 'off', true);

  UPDATE public.declutter_bundle_requests
     SET status = CASE WHEN v_accepted > 0 THEN 'answered' ELSE 'declined' END, closed_at = now()
   WHERE id = p_request_id;
  PERFORM public.declutter_notice_ref(p_request_id); -- Q2659
  IF v_accepted > 0 THEN
    PERFORM public.declutter_notify(v_req.buyer_id, 'payment', 'Bundle accepted: pay within 24 hours',
      format('The seller accepted %s of your items%s. They are in your cart; pay within 24 hours or they go back on sale.',
             v_accepted, CASE WHEN v_gone > 0 THEN format(' (%s sold meanwhile)', v_gone) ELSE '' END),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notice_ref(p_request_id); -- Q2659
    PERFORM public.declutter_notify(v_uid, 'declutter_sales', 'Bundle accepted: waiting on payment', -- M1 (audit 11-08)
      format('You accepted %s of the items. The buyer has 24 hours to check out and pay.', v_accepted),
      '/declutter?tab=selling', v_req.buyer_id);
  ELSE
    PERFORM public.declutter_notify(v_req.buyer_id, 'new_offers', 'Bundle request closed',
      'The items you asked for are no longer available. Nothing was charged.', '/declutter?tab=buying', v_uid);
  END IF;
  RETURN v_accepted;
END;
$function$;

-- declutter_delivery_gave_up_check: from 20261102070238_declutter_gave_up_notice_no_fee_words.sql
CREATE OR REPLACE FUNCTION public.declutter_delivery_gave_up_check()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
  v_dollars text;
BEGIN
  FOR r IN
    SELECT x.* FROM (
      SELECT 'helpr_payout'::text AS kind, p.id, p.helpr_id, NULL::uuid AS buyer_id, p.amount_cents AS cents, p.last_error,
             p.gave_up_notified_at, p.is_seed, p.task_id AS ref_id, p.created_at
        FROM public.helpr_task_payouts p
       WHERE p.status = 'failed' AND p.attempts >= 12
      UNION ALL
      SELECT 'delivery_refund', d.id, NULL::uuid, o.buyer_id, d.refund_cents, d.last_error, d.gave_up_notified_at, d.is_seed,
             d.order_id, d.created_at
        FROM public.declutter_delivery_refunds d
        LEFT JOIN public.declutter_orders o ON o.id = d.order_id
       WHERE d.status = 'failed' AND d.attempts >= 12
      UNION ALL
      SELECT 'raise_refund', g.id, NULL::uuid, o.buyer_id, g.refund_cents, g.refund_last_error, g.gave_up_notified_at, g.is_seed,
             g.order_id, g.created_at
        FROM public.declutter_delivery_raises g
        LEFT JOIN public.declutter_orders o ON o.id = g.order_id
       WHERE g.status = 'refunding' AND g.refund_attempts >= 12
    ) x
    ORDER BY x.created_at
    LIMIT 500
  LOOP
    v_n := v_n + 1;
    v_dollars := to_char(r.cents / 100.0, 'FM999990.00');
    -- Nested (not AND): plpgsql plans the inner statements only when the table exists.
    IF to_regclass('public.error_logs') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.error_logs e
         WHERE jsonb_typeof(e.tags) = 'object'
           AND coalesce(e.tags ->> 'origin', '') <> 'client'
           AND e.tags ->> 'source' = 'declutter-delivery-gave-up'
           AND e.tags ->> 'row_id' = r.id::text
           AND e.created_at > date_trunc('day', now())
      ) THEN
        -- One ledger item for every gave-up row (the title before ' — ' is the fingerprint).
        INSERT INTO public.error_logs (severity, message, tags, context)
        VALUES ('error',
                format('Declutter delivery money gave up after 12 tries: send it by hand in Stripe — %s %s ($%s, %s %s). Last error: %s',
                       r.kind, r.id, v_dollars, CASE WHEN r.kind = 'helpr_payout' THEN 'task' ELSE 'order' END,
                       coalesce(r.ref_id::text, 'none'), coalesce(left(r.last_error, 200), 'none recorded')),
                jsonb_strip_nulls(jsonb_build_object('source', 'declutter-delivery-gave-up', 'area', 'declutter',
                                                     'row_kind', r.kind, 'row_id', r.id::text,
                                                     'seed', CASE WHEN r.is_seed THEN 'true' END)),
                jsonb_build_object('row_kind', r.kind, 'row_id', r.id, 'ref_id', r.ref_id, 'cents', r.cents));
      END IF;
    END IF;
    IF r.gave_up_notified_at IS NULL THEN
      IF r.kind = 'helpr_payout' THEN
        UPDATE public.helpr_task_payouts SET gave_up_notified_at = now() WHERE id = r.id AND gave_up_notified_at IS NULL;
      ELSIF r.kind = 'delivery_refund' THEN
        UPDATE public.declutter_delivery_refunds SET gave_up_notified_at = now() WHERE id = r.id AND gave_up_notified_at IS NULL;
      ELSE
        UPDATE public.declutter_delivery_raises SET gave_up_notified_at = now() WHERE id = r.id AND gave_up_notified_at IS NULL;
      END IF;
      IF FOUND THEN
        IF r.kind = 'helpr_payout' AND r.helpr_id IS NOT NULL THEN
          PERFORM public.declutter_notify(r.helpr_id, 'payment', 'Our team is sending your delivery pay',
            format('We could not send your $%s delivery pay automatically, so our team is sending it. You do not need to do anything. We will tell you when it is on its way.',
                   v_dollars),
            '/profile?tab=earnings');
        ELSIF r.kind <> 'helpr_payout' AND r.buyer_id IS NOT NULL THEN
          PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Your refund is being sent by hand',
            -- CHANGED (fee words): names what the money was for, never a fee (owner: members see no fee words).
            format('We could not send the $%s you paid for %s back to your card automatically, so our team is sending it by hand. You do not need to do anything. We will tell you when it is on its way.',
                   v_dollars, CASE WHEN r.kind = 'delivery_refund' THEN 'delivery' ELSE 'the delivery pay raise' END),
            '/declutter?tab=buying');  -- CHANGED (DC-17 format): the buyer's side, not ?view=cart
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;

-- declutter_answer_no_show: from 20261103222939_q2390_helpr_answer_take_item_report_problem_answer_no_show_fault_report_copy_not_found_is_404.sql
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
          PERFORM public.declutter_notify(a.user_id, 'info', 'Declutter problem: other side answered',
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

-- declutter_respond_swap: from 20261108195151_declutter_trades_fixes.sql
CREATE OR REPLACE FUNCTION public.declutter_respond_swap(p_swap_id uuid, p_action text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  s record;
  v_ok record;
  v_buyer_line uuid;
  v_seller_line uuid;
  v_name text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_action IS NULL OR p_action NOT IN ('accept', 'decline', 'withdraw') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.declutter_swap_offers f
   WHERE f.id = p_swap_id AND (f.buyer_id = v_uid OR f.seller_id = v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF (p_action = 'withdraw') <> (s.buyer_id = v_uid) THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'accept' THEN
    -- Lock order: both items (id order, inside the check), then the trade row.
    SELECT * INTO v_ok FROM public.declutter_swap_items_ok(s.item_id, s.offered_item_id, s.buyer_id);
  END IF;
  SELECT * INTO s FROM public.declutter_swap_offers f WHERE f.id = p_swap_id FOR UPDATE;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'trade_not_open' USING ERRCODE = '55000', HINT = 'This trade offer is already closed.';
  END IF;

  IF p_action = 'withdraw' THEN
    UPDATE public.declutter_swap_offers SET status = 'withdrawn', closed_at = now(), updated_at = now() WHERE id = p_swap_id;
    PERFORM public.declutter_notify(s.seller_id, 'declutter_offers', 'Trade offer withdrawn',
      format('The buyer took back their trade offer for "%s".',
             (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id)),
      '/declutter?tab=selling', s.buyer_id);
    RETURN 'withdrawn';
  END IF;

  IF s.respond_by <= now() THEN
    RAISE EXCEPTION 'trade_expired' USING ERRCODE = '55000', HINT = 'This trade offer ran out of time.';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.declutter_swap_offers SET status = 'declined', closed_at = now(), updated_at = now() WHERE id = p_swap_id;
    -- One wording for every decline (B26): never says why. CHANGED (#11): bell and email.
    PERFORM public.declutter_notify(s.buyer_id, 'declutter_offers', 'Trade offer declined',
      format('Your trade offer for "%s" was declined. Nothing changed hands.',
             (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id)),
      '/declutter/item/' || s.item_id::text, v_uid);
    RETURN 'declined';
  END IF;

  -- accept. The trade row closes FIRST, so the item trigger (fired by take_item reserving the items) voids only the
  -- OTHER open trades naming either item.
  IF public.member_under_18(s.buyer_id) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;
  UPDATE public.declutter_swap_offers SET status = 'accepted', closed_at = now(), updated_at = now() WHERE id = p_swap_id;
  -- take_item's own free-claim notices are skipped (the setting it already honours, 20261104124645); this sends one each.
  PERFORM set_config('declutter.bundle_take', 'on', true);
  v_buyer_line := public.declutter_take_item(s.item_id, s.buyer_id, 0, 'buy', NULL);
  v_seller_line := public.declutter_take_item(s.offered_item_id, s.seller_id, 0, 'buy', NULL);
  PERFORM set_config('declutter.bundle_take', '', true);
  UPDATE public.declutter_swap_offers SET buyer_line_id = v_buyer_line, seller_line_id = v_seller_line WHERE id = p_swap_id;
  -- CHANGED (#2): both lines say they are a trade, so every free-item path can tell them apart.
  UPDATE public.declutter_cart_items SET swap_id = p_swap_id WHERE id IN (v_buyer_line, v_seller_line);

  SELECT public.member_display_name(p.full_name, 'The seller') INTO v_name FROM public.profiles p WHERE p.user_id = s.seller_id;
  PERFORM public.declutter_notice_ref(v_buyer_line); -- Q2659
  -- CHANGED (#11): the buyer's "accepted" is emailed too.
  PERFORM public.declutter_notify(s.buyer_id, 'declutter_sales', 'Trade accepted: pick a pickup time',
    format('%s accepted your trade: "%s" for "%s". Choose how you''ll pick up their item within 48 hours. No money changes hands.',
           coalesce(v_name, 'The seller'), v_ok.o_offered_title, v_ok.o_title),
    '/declutter?tab=buying', s.seller_id);
  PERFORM public.declutter_notice_ref(v_seller_line); -- Q2659
  PERFORM public.declutter_notify(s.seller_id, 'declutter_sales', 'Trade set: pick a pickup time',
    format('You traded "%s" for "%s". Choose how you''ll pick up their item within 48 hours. No money changes hands.',
           v_ok.o_title, v_ok.o_offered_title),
    '/declutter?tab=selling', s.buyer_id);
  RETURN 'accepted';
END;
$fn$;

-- declutter_take_item: from 20261108202546_declutter_notices_email_and_honest_sold.sql
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

  -- Q2731 (Q2268 money review 11-04): a bundle answer (declutter_answer_bundle) sends ONE notice to each side for the
  -- whole bundle, so these per-item "reserved" / "sold" notices are skipped while it takes its items (the
  -- transaction-local setting declutter.bundle_take, which only that function sets). The voided-offer notices above
  -- still go to every other buyer.
  IF coalesce(current_setting('declutter.bundle_take', true), '') <> 'on' THEN
    IF p_price = 0 THEN
      -- A free claim (20261027170717): the same 48 hours, nothing to pay.
      -- DA-12: no strike for letting the 48 hours run out on a free item; it just goes back up.
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: pick a pickup time',
        format('"%s" is free and held for you. Choose how you''ll pick it up within 48 hours or it goes back up. %s',
               v_title, public.declutter_free_hold_charge_words(p_buyer)),
        '/declutter?view=cart', v_seller);
      PERFORM public.declutter_notify(v_seller, 'new_offers', 'Someone claimed your free item',
        format('"%s" was claimed. The buyer has 48 hours to choose a pickup.', v_title),
        '/declutter?view=selling', p_buyer);
    ELSIF p_source = 'buy' THEN
      -- DB-5 (owner 2026-10-30): Buy now goes straight to checkout; not paying is no strike, the item just goes back up.
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved: check out within 30 minutes',
        format('"%s" is held for you at checkout for %s. Pay within 30 minutes or it goes back up for sale. Your card is not charged until you pay.',
               v_title, v_price),
        '/declutter?view=cart', v_seller);
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      -- M1 (audit 11-08): not "Sold" until the payment lands; the buyer can still back out with no strike.
      PERFORM public.declutter_notify(v_seller, 'declutter_sales', 'Someone''s buying your item',
        format('Someone is checking out "%s" for %s. It''s held for them for 30 minutes. We''ll tell you when they pay.', v_title, v_price),
        '/declutter?view=selling', p_buyer);
    ELSE
    -- Owner's wording (2026-10-28, via the lead): reserved, not paid yet.
    -- B110 (owner 11-01, lead copy): an accepted offer says who accepted it and what to do next.
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved for you: check out in 24 hours',
      CASE WHEN p_offer_id IS NOT NULL THEN
        format('%s accepted your %s offer for "%s". Check out within 24 hours: choose pickup or delivery, pick a day and time, and pay, or it goes back up for sale and you get a strike. Your card is not charged until you check out.',
               COALESCE((SELECT public.member_display_name(p.full_name, 'The seller') FROM public.profiles p WHERE p.user_id = v_seller), 'The seller'),
               v_price, v_title)
      ELSE
      format('"%s" is in your cart for %s. Check out within 24 hours or you get a strike and it goes back up for sale. Your card is not charged until you check out.',
             v_title, v_price) END,
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    -- M1 (audit 11-08): not "Sold" until the payment lands.
    PERFORM public.declutter_notify(v_seller, 'declutter_sales', 'Someone''s buying your item',
      format('"%s" is held for the buyer at %s. They have 24 hours to check out and pay. We''ll tell you when they pay.', v_title, v_price),
      '/declutter?view=selling', p_buyer);
    END IF;
  END IF;
  RETURN v_line;
END;
$function$;

-- helpr_task_sweep: from 20261109224952_notices_card_fee_and_our_team.sql
CREATE OR REPLACE FUNCTION public.helpr_task_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  t public.helpr_tasks;
  v_unfilled integer := 0;
  v_noshow integer := 0;
  v_auto integer := 0;
  v_in_hand integer := 0;
  v_stuck integer := 0;
  v_o public.declutter_orders;
  a record;
  v_no_answer integer := 0;
BEGIN
  -- NEW (soldstates-5): the seller said the Helpr didn't come and the Helpr didn't answer in 24 hours. A strike, and a
  -- task still booked goes back up for another Helpr. The buyer's money is not refunded: the delivery goes on. An open
  -- problem on the order means Louisiana Helpr already has it: nothing here.
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.seller_no_show_answer_by <= now() AND x.seller_no_show_answered_at IS NULL
              AND x.seller_no_show_settled_at IS NULL ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.seller_no_show_answer_by <= now() AND t.seller_no_show_answered_at IS NULL AND t.seller_no_show_settled_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = t.source_id AND p.status = 'open')
         AND NOT (t.source_kind = 'shop_delivery' AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = t.source_id AND h.problem_at IS NOT NULL)) THEN
        UPDATE public.helpr_tasks SET seller_no_show_settled_at = now(), updated_at = now() WHERE id = t.id;
        -- Review #4: only a Helpr still booked for it (picked up, cancelled or closed since: no strike).
        IF t.status = 'accepted' THEN
          PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id,
            'The seller said you didn''t come for a Helpr delivery pickup, and you didn''t answer within 24 hours');
          -- helpr_task_reopen clears the report, so the next Helpr starts clean (review #3).
          PERFORM public.helpr_task_reopen(t.id, 'helpr_no_show', t.helpr_id, 'the seller said the Helpr did not come; no answer in 24 h');
        END IF;
        v_no_answer := v_no_answer + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x WHERE x.status = 'open' AND x.open_until <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      -- An open problem freezes the task: the admin decides the money, never
      -- this sweep (lh-money-escrow re-review #1, 2026-10-16: the late
      -- fall-through close would otherwise refund under the no-fault rule and
      -- leave the problem undecidable).
      IF t.status = 'open' AND t.open_until <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_close(t.id, 'unfilled', 'No Helpr took it in time');
        PERFORM public.helpr_task_source_event(t.id, 'unfilled', NULL);
        v_unfilled := v_unfilled + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'accepted' AND x.pickup_slot_start + interval '2 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      -- A problem on the source (e.g. the Helpr's "the seller wasn't there")
      -- freezes the task: an admin decides, the Helpr is not a no-show.
      IF t.status = 'accepted' AND t.pickup_slot_start + interval '2 hours' <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_reopen(t.id, 'helpr_no_show', t.helpr_id, 'not picked up 2 h after the pickup time');
        PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id,
          'Did not pick up a Helpr delivery within 2 hours of the pickup time');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'delivered' AND x.delivered_at + interval '24 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.status = 'delivered' AND t.delivered_at + interval '24 hours' <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_source_event(t.id, 'confirmed', 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- BUY-37: picked up, never marked delivered, nobody has said anything. Nudged 24 hours after the pickup, then weekly.
  -- No money moves and no strike: the money stays held (owner 10-30, "Nobody taps at all: hold the money"). An open
  -- problem means an admin already has it. Test data reaches nobody.
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'picked_up' AND x.picked_up_at + interval '24 hours' <= now()
              AND x.stuck_stage IS NULL
              AND (x.in_hand_nudged_at IS NULL OR x.in_hand_nudged_at + interval '7 days' <= now())
              AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)
              AND x.is_seed IS NOT TRUE
              AND NOT EXISTS (SELECT 1 FROM public.test_accounts ta WHERE ta.user_id IN (x.customer_id, x.pickup_contact_id, x.helpr_id))
              AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (x.customer_id, x.pickup_contact_id, x.helpr_id) AND pr.is_seed)
            ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.status = 'picked_up' AND t.picked_up_at + interval '24 hours' <= now()
         AND (t.in_hand_nudged_at IS NULL OR t.in_hand_nudged_at + interval '7 days' <= now())
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        UPDATE public.helpr_tasks SET in_hand_nudged_at = now() WHERE id = t.id;
        PERFORM public.helpr_task_source_event(t.id, 'still_in_hand', NULL);
        v_in_hand := v_in_hand + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- BUY-36: the clocks on a delivery the Helpr can't finish. A problem freezes them all: an admin decides.
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'picked_up'
              AND ((x.stuck_stage = 'waiting_fix' AND x.stuck_fix_by <= now())
                OR (x.stuck_stage = 'returned' AND x.return_answer_by <= now())
                OR (x.stuck_stage IN ('returning', 'collecting') AND x.stuck_return_by <= now())
                OR (x.stuck_stage = 'awaiting_choice' AND x.stuck_choice_by <= now()))
              AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)
            ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      CONTINUE WHEN t.status <> 'picked_up' OR public.helpr_task_source_held(t.source_kind, t.source_id);
      IF t.stuck_stage = 'waiting_fix' AND t.stuck_fix_by <= now() THEN
        -- Not fixed in 24 hours: as a failed retry.
        UPDATE public.helpr_tasks SET stuck_stage = 'returning', stuck_return_by = now() + interval '48 hours', updated_at = now() WHERE id = t.id;
        PERFORM public.declutter_notify(t.helpr_id, 'info', 'Take it back to the seller',
          format('The buyer didn''t fix the delivery of "%s". Take it back to the seller within 48 hours, and you''re paid for the trip.', t.title),
          '/declutter?tab=deliver', t.customer_id);
        PERFORM public.declutter_notify(t.customer_id, 'declutter_pickups', 'The delivery couldn''t be finished',
          format('"%s" goes back to the seller and the sale is cancelled. You get back what you paid, less what the delivery cost, which pays the Helpr for the trip, and less the card cost.', t.title),
          '/declutter?tab=buying', t.helpr_id);
        PERFORM public.declutter_notify(t.pickup_contact_id, 'declutter_sales', 'Your item is coming back',
          format('The Helpr couldn''t leave "%s" and brings it back within 48 hours. Confirm in Selling when you have it.', t.title),
          '/declutter?tab=selling', t.helpr_id);
        v_stuck := v_stuck + 1;
      ELSIF t.stuck_stage = 'returned' AND t.return_answer_by <= now() THEN
        PERFORM public.declutter_delivery_return_finish(t.id);
        v_stuck := v_stuck + 1;
      ELSIF (t.stuck_stage IN ('returning', 'collecting') AND t.stuck_return_by <= now())
         OR (t.stuck_stage = 'awaiting_choice' AND t.stuck_choice_by <= now()) THEN
        -- Nobody finished it: Louisiana Helpr decides, the money held, and no second strike.
        SELECT * INTO v_o FROM public.declutter_orders WHERE id = t.source_id;
        INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
        VALUES (t.source_id, t.helpr_id, 'helpr', 'other',
                CASE WHEN t.stuck_stage = 'awaiting_choice' THEN 'The item is back with the seller, and the buyer hasn''t chosen a refund or re-posting in 48 hours.'
                     WHEN t.stuck_stage = 'collecting' THEN 'The buyer was going to collect the item from the Helpr, and 48 hours have passed without it being confirmed.'
                     ELSE 'The Helpr reported they couldn''t finish, and hasn''t brought the item back to the seller in 48 hours.' END,
                '{}');
        PERFORM public.declutter_notify(t.customer_id, 'declutter_pickups', 'Our team is looking at this delivery',
          format('About "%s". The money stays held until our team decides.', t.title), '/declutter?tab=buying', t.helpr_id);
        PERFORM public.declutter_notify(t.pickup_contact_id, 'declutter_sales', 'Our team is looking at this delivery',
          format('About "%s". The money stays held until our team decides.', t.title), '/declutter?tab=selling', t.helpr_id);
        PERFORM public.declutter_notify(t.helpr_id, 'warning', 'Our team is looking at this delivery',
          format('About "%s". Our team decides what happens next.', t.title), '/declutter?tab=deliver', NULL);
        -- A cron has no caller for the gate to read, so test data is skipped here too (20261030150104's rule).
        IF NOT (t.is_seed OR public.is_test_subject(t.customer_id) OR public.is_test_subject(t.pickup_contact_id) OR public.is_test_subject(t.helpr_id)) THEN
          FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
            PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter delivery stuck',
              'A delivery a Helpr couldn''t finish has stalled. The money is held until you decide it.', '/admin');
          END LOOP;
        END IF;
        v_stuck := v_stuck + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('unfilled', v_unfilled, 'helpr_no_show', v_noshow, 'auto_confirmed', v_auto,
                            'still_in_hand_nudged', v_in_hand, 'seller_report_unanswered', v_no_answer,
                            'stuck_steps', v_stuck);
END;
$function$
;

-- notify_helpr_of_booking_clash: from 20261012171958_helpr_double_booking_notice.sql
CREATE OR REPLACE FUNCTION public.notify_helpr_of_booking_clash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_helper uuid := NEW.helper_id;
  v_job uuid;
  v_title text;
  v_date date;
  v_other record;
  v_seed boolean;
BEGIN
  IF TG_TABLE_NAME = 'jobs' THEN
    v_job := NEW.id;
  ELSE
    v_job := NEW.job_id;
  END IF;
  IF v_helper IS NULL OR v_job IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT o.id, o.title INTO v_other
      FROM public.helpr_booking_clashes(v_helper) c
      JOIN public.jobs o ON o.id = c.other_job_id
     WHERE c.job_id = v_job
     ORDER BY o.date_needed, o.start_time
     LIMIT 1;
    IF v_other.id IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT j.title, j.date_needed, j.is_seed INTO v_title, v_date, v_seed FROM public.jobs j WHERE j.id = v_job;

    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_helper, v_job,
      'Two jobs booked at the same time',
      format('"%s" and "%s" overlap on %s. Please get one of them rescheduled: open either job and tap "Ask for a new date or time".',
             COALESCE(v_title, 'This job'), COALESCE(v_other.title, 'another job'),
             to_char(v_date, 'FMDy FMMon FMDD')),
      'job_updates',
      '/jobs?job=' || v_job::text
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never refuse a hire because its heads-up could not be written; the
    -- in-app notice on the card (my_schedule_clashes) still shows the clash.
    -- Recorded where ops reads (error_logs), best effort.
    RAISE WARNING 'notify_helpr_of_booking_clash: % (job %, user %)', SQLERRM, v_job, v_helper;
    BEGIN
      INSERT INTO public.error_logs (severity, message, url, tags, context)
      VALUES ('error', 'Double-booking notice not sent: ' || SQLERRM,
              format('/admin?view=jobs&job=%s', v_job),
              -- A seed/E2E job's failure goes to the daily digest, not the page
              -- (error_log_is_seed reads tags.seed); unknown counts as real.
              jsonb_build_object('source', 'notify_helpr_of_booking_clash', 'origin', 'server',
                                 'seed', COALESCE(v_seed, false)),
              jsonb_build_object('job_id', v_job, 'helper_id', v_helper));
    EXCEPTION WHEN OTHERS THEN
      NULL; -- the WARNING above is the last resort; a hire is never refused for a log row
    END;
  END;
  RETURN NULL;
END;
$fn$;

-- open_dispute_as: from 20261109215021_notices_our_team_and_no_strike.sql
CREATE OR REPLACE FUNCTION public.open_dispute_as(_job_id uuid, _opener_id uuid, _reason text, _evidence_urls text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := _opener_id;
  _system boolean := _opener_id IS NULL;
  _customer uuid;
  _helper uuid;
  _title text;
  _status text;
  _existing_id uuid;
  _new_id uuid;
  _other uuid;
  _admin uuid;
  _refroze boolean := false;
  _reason_trimmed text;
  _velocity_count integer;
  _payment_status text;
  _is_group boolean;
  _crew boolean := false;
  _on_crew boolean := false;
  _member uuid;
BEGIN
  -- A dispute with no explanation freezes someone's money for 72 hours and
  -- hands an admin nothing to decide on. Applies to the platform too: a
  -- system filing has to say what happened in the same words a person would.
  _reason_trimmed := btrim(COALESCE(_reason, ''));
  IF _reason_trimmed = ''
     OR right(_reason_trimmed, 1) = ':'
     OR length(_reason_trimmed) < 15
  THEN
    RAISE EXCEPTION 'dispute_needs_description'
      USING HINT = 'Describe what happened — our team decides this from your words.';
  END IF;

  -- FOR UPDATE, restored. Without the lock two parties filing at the same
  -- instant each read "no open dispute" and both insert. The unique index
  -- added in 20260901032007 is the backstop; this is what makes the loser WAIT
  -- and then take the existing-dispute branch instead of erroring.
  SELECT customer_id, helper_id, title, status::text, payment_status, is_group_job
    INTO _customer, _helper, _title, _status, _payment_status, _is_group
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- A crew has no lead (Q407): jobs.helper_id is NULL on every group job, so
  -- the Helpr side of a crew is its roster. Read under the jobs lock above.
  _crew := _is_group IS TRUE;
  _on_crew := _crew AND _uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _uid);

  -- The platform is not a party to the job, so there is no membership to
  -- check on that branch. Every human caller still is.
  -- NULL-safe (Q728): this read `_uid <> _customer AND _uid <> _helper`, and
  -- on a crew `_uid <> NULL` is NULL, so the IF never fired and ANY signed-in
  -- account could open a dispute on any booked crew job, freezing its escrow.
  IF NOT _system
     AND _uid IS DISTINCT FROM _customer
     AND (_helper IS NULL OR _uid IS DISTINCT FROM _helper)
     AND NOT _on_crew THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  -- DONE IS FINAL (owner, 2026-09-14). A completed job cannot be disputed by
  -- either party, and an open dispute row on one cannot be appended to or used
  -- to re-freeze it. Human callers only: the one system caller
  -- (auto-release-payment's undelivered-revision sweep) files on
  -- revision_requested jobs, never completed ones, and its path is unchanged.
  -- Ahead of the existing-dispute branch on purpose, so its re-freeze from
  -- 'completed' is unreachable for a person.
  -- (Live guard from 20260915025607, kept verbatim when this migration was
  -- re-derived from the live definition on 2026-09-15.)
  IF NOT _system AND _status = 'completed' THEN
    RAISE EXCEPTION 'job_already_completed'
      USING HINT = 'Once a job is marked done it is final.';
  END IF;

  -- ── Evidence is the filer's own uploads, nothing else (authz review of the
  -- dispute-races rebase, MEDIUM). Both the new-dispute path and the re-file
  -- branch below store `_evidence_urls` verbatim, and they render as <a>/<img>
  -- in the admin console and the other party's dialog. A person may attach only
  -- signed proof-photos URLs for their own uploads on this job
  -- (dispute_evidence_url_ok, section 8); the platform files with none.
  IF _system THEN
    IF COALESCE(cardinality(_evidence_urls), 0) > 0 THEN
      RAISE EXCEPTION 'dispute_evidence_invalid_url'
        USING HINT = 'A platform filing carries no evidence.';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM unnest(COALESCE(_evidence_urls, '{}'::text[])) AS e(u)
     WHERE NOT public.dispute_evidence_url_ok(e.u, _uid, _job_id)
  ) THEN
    RAISE EXCEPTION 'dispute_evidence_invalid_url'
      USING HINT = 'Only photos you uploaded to this dispute can be attached.';
  END IF;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  -- ── Not over a decided dispute whose money has not moved ────────────────
  -- rpc_decide_dispute leaves the job completed/cancelled with the escrow held
  -- until execute-dispute-split settles it. A party re-filing then flipped the
  -- job back to `disputed` (and a withdrawal to in_progress), which handed the
  -- escrow to Quick Release / Quick Refund / the sweep and, via
  -- poster_cancel_job, to void-cancelled-payments — each settling over the
  -- admin's decision, and "Retry settlement" moving the split on top (both
  -- reviews, round 2, HIGH; live shape on prod: job bb2c3732 / dispute
  -- c7a12050). The decision stands until it executes.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
     WHERE d.job_id = _job_id
       AND d.status = 'decided'
       AND d.execution_status IS DISTINCT FROM 'executed'
  ) THEN
    RAISE EXCEPTION 'dispute_already_decided'
      USING HINT = 'Our team has already decided this dispute and its payment is being settled.';
  END IF;

  -- ── Not while the escrow is being cancelled ─────────────────────────────
  -- `cancelling` is cancel_escrow's claim: its Stripe refund is in flight.
  -- A dispute stamped onto that job made it `disputed` with the refund still
  -- going out, and an admin Quick Release then paid the Helpr beside it.
  -- claim_dispute_settlement now refuses that shape too; this stops it being
  -- created. Read under the FOR UPDATE above, so cancel_escrow's claim either
  -- committed first (visible here) or waits behind this filing (and its own
  -- status-pinned claim then matches zero rows).
  IF _payment_status = 'cancelling' THEN
    RAISE EXCEPTION 'dispute_payment_being_cancelled'
      USING HINT = 'This job''s payment is being cancelled and refunded, so it can no longer be disputed.';
  END IF;

  SELECT id INTO _existing_id
  FROM public.disputes
  WHERE job_id = _job_id AND status = 'open'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    -- Set-like append, 20260915034822. A DOUBLE SUBMIT from the dispute
    -- dialog — two clicks inside one JS task, both past the React-state
    -- `submitting` flag because state does not land until the next render —
    -- sends two calls. The second blocks on the FOR UPDATE above, then lands
    -- HERE, and with a bare `||` it appended the SAME evidence urls a second
    -- time: the admin queue showed each photo twice and `evidence_urls` grew
    -- without bound on every retry. The client now holds a synchronous ref
    -- guard as well (DisputeDialog.tsx), but a guard in the browser is not a
    -- guarantee; this is.
    UPDATE public.disputes
    SET evidence_urls = (
          SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
            FROM (
              SELECT u, min(ord) AS ord
                FROM unnest(
                       evidence_urls || COALESCE(_evidence_urls, '{}'::text[])
                     ) WITH ORDINALITY AS t(u, ord)
               GROUP BY u
            ) d
        )
    WHERE id = _existing_id;

    -- Mirror the appended evidence so the poster card and admin queue that
    -- read the legacy array don't diverge from the disputes row.
    UPDATE public.jobs
       SET dispute_evidence_urls = (
             SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
               FROM (
                 SELECT u, min(ord) AS ord
                   FROM unnest(
                          COALESCE(dispute_evidence_urls, '{}'::text[])
                            || COALESCE(_evidence_urls, '{}'::text[])
                        ) WITH ORDINALITY AS t(u, ord)
                  GROUP BY u
               ) d
           )
     WHERE id = _job_id;

    -- RE-FREEZE. An open `disputes` row on a job that is NOT disputed is the
    -- shape auto-resolve-disputes leaves behind (it writes `jobs`, never this
    -- table), and this branch used to RETURN without touching the job — so a
    -- re-file inside the payout hold appended evidence, reported success, and
    -- left the escrow free to pay out. Only re-freeze from a state the
    -- transition matrix allows, so this can never raise on a job that has
    -- legitimately moved on.
    IF _status <> 'disputed' AND _status IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
      UPDATE public.jobs
         SET status = 'disputed',
             disputed_by = COALESCE(disputed_by, _uid),
             disputed_at = COALESCE(disputed_at, now()),
             dispute_status = 'open'
       WHERE id = _job_id;
      _refroze := true;
    END IF;

    -- Page ops on a re-freeze but not on a bare evidence append. A re-freeze
    -- means money was one payout-hold away from leaving on a job somebody is
    -- still contesting; an extra photo on an already-frozen dispute is not
    -- news at 3am.
    IF _refroze THEN
      PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, true);
    END IF;

    -- NO velocity check on this branch, deliberately. This is a re-file on a
    -- dispute that already exists, and both mirror columns are COALESCEd above
    -- precisely so it does not restamp. The job was already counted the first
    -- time; counting it again here would flag people for uploading a second
    -- photo.
    --
    -- This is ALSO the sweep's idempotency guard: a second pass over a job
    -- whose dispute the platform already opened lands here, appends nothing
    -- and returns the SAME id. No duplicate row, no second notification.
    RETURN _existing_id;
  END IF;

  -- ── The job must still be disputable, 20260915034822 ────────────────────
  -- The re-freeze branch above has always checked `_status` against the
  -- transition matrix's own `-> disputed` edges. The NEW-dispute path below
  -- never did: it inserted the row and stamped status='disputed'
  -- unconditionally. `_status` was read under the FOR UPDATE above, so a
  -- concurrent `poster_cancel_job` / completion / payout either commits BEFORE
  -- this call takes the lock (and is therefore visible in `_status`) or waits
  -- behind it — which is exactly why checking it here closes the window
  -- instead of merely narrowing it.
  --
  -- Without it, filing a dispute that raced a cancellation either stamped
  -- `disputed` onto a cancelled job (freezing an escrow that had already been
  -- refunded) or raised `enforce_job_status_transition`'s raw Postgres prose at
  -- the filer. A terse code instead, so `lifecycleErrorMessage` can say what
  -- happened; the allowed set is the same list the re-freeze branch uses.
  IF _status NOT IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
    RAISE EXCEPTION 'dispute_job_not_disputable'
      USING HINT = 'This job has already been resolved or closed, so it can no longer be disputed.';
  END IF;

  -- Q1262(1): the Helpr's answer to the PREVIOUS dispute on this job is kept
  -- on that dispute's own row before the UPDATE below clears the job's copy
  -- (Q1165). Without this a poster could withdraw and re-file to wipe the
  -- Helpr's statement for good. Only into a closed row that has none yet.
  -- This runs as a definer INSIDE the party's session, so the opener
  -- whitelist trigger sees a party's write: a transaction-local flag, set only
  -- here and cleared right after (as rpc_withdraw_dispute's
  -- app.dispute_withdraw_rpc), lets exactly this NULL -> answer write through
  -- (lh-authz-rls review, 2026-10-05: without it the re-file raised 42501).
  PERFORM set_config('app.dispute_archive_rpc', '1', true);
  UPDATE public.disputes d
     SET helper_response = j.dispute_helper_response
    FROM public.jobs j
   WHERE j.id = _job_id
     AND j.dispute_helper_response IS NOT NULL
     AND d.helper_response IS NULL
     AND d.id = (SELECT p.id FROM public.disputes p
                  WHERE p.job_id = _job_id AND p.status <> 'open'
                  ORDER BY p.created_at DESC LIMIT 1);
  PERFORM set_config('app.dispute_archive_rpc', '0', true);

  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (_job_id, _uid, _reason, COALESCE(_evidence_urls, '{}'::text[]))
  RETURNING id INTO _new_id;

  -- ONE statement: status + the mirror columns together, so the
  -- set_dispute_deadline trigger (BEFORE UPDATE, keyed on the flip to
  -- 'disputed') sees a non-null disputed_at and can derive the 72h deadline.
  UPDATE public.jobs
     SET status = 'disputed',
         disputed_by = _uid,
         disputed_at = now(),
         dispute_reason = _reason,
         -- Q1165: a NEW dispute starts with no Helpr answer. A withdrawn
         -- dispute's answer survived the re-file, rendered under the new
         -- complaint, and (write-once since 20261003180355) stopped the Helpr
         -- answering it. SECURITY DEFINER, so the table-door trigger does not
         -- apply to this write.
         dispute_helper_response = NULL,
         dispute_status = 'open',
         -- Q1262(3): a NEW dispute starts from its own evidence and is not
         -- resolved: the job's legacy mirror no longer carries the withdrawn
         -- dispute's photos under the new complaint (they stay on that
         -- dispute's own row), and the withdrawal's dispute_resolved_at stamp
         -- (can_review_job reads it) is cleared with the answer.
         dispute_resolved_at = NULL,
         dispute_evidence_urls = COALESCE(_evidence_urls, '{}'::text[])
   -- Belt and braces on the predicate above: the same allowed set, written
   -- into the statement itself so the freeze can never land on a job that
   -- moved on, even if a future edit drops the IF.
   WHERE id = _job_id
     AND status::text IN ('completed', 'in_progress', 'revision_requested', 'accepted');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute_job_not_disputable'
      USING HINT = 'This job has already been resolved or closed, so it can no longer be disputed.';
  END IF;

  -- ── DISPUTE VELOCITY ────────────────────────────────────────────────────
  -- Delivers "3+ disputes in 30 days flags your account for review."
  --
  -- Skipped entirely for a system filing: `disputed_by` is NULL, nobody chose
  -- to file, and flagging an account for the platform's own sweep would turn a
  -- stalled revision into a fraud signal against whichever party the count
  -- happened to land on.
  --
  -- Runs AFTER the UPDATE above on purpose: that statement is what stamps
  -- disputed_by/disputed_at, so the dispute being filed right now is inside
  -- the window the check counts. check_dispute_velocity returns TRUE while
  -- UNDER the limit, so `NOT ...` is "this filing put them at or past it".
  --
  -- Wrapped, and this is the one place in this function where swallowing is
  -- correct: the purpose of this RPC is to FREEZE THE MONEY on a contested
  -- job. Failing to file a risk signal must never be the reason a real
  -- dispute does not freeze.
  IF NOT _system THEN
    BEGIN
      IF NOT public.check_dispute_velocity(_uid) THEN
        -- One open flag per account at a time. Every further dispute past the
        -- threshold is more of the same signal, and an admin resolving the flag
        -- is what re-arms it.
        IF NOT EXISTS (
          SELECT 1 FROM public.fraud_flags
          WHERE user_id = _uid AND flag_type = 'high_dispute_rate' AND resolved = false
        ) THEN
          SELECT count(*) INTO _velocity_count
            FROM public.jobs
           WHERE disputed_by = _uid
             AND disputed_at > now() - interval '30 days';

          INSERT INTO public.fraud_flags (user_id, job_id, flag_type, details)
          VALUES (
            _uid,
            _job_id,
            'high_dispute_rate',
            'Opened ' || _velocity_count || ' disputes in the last 30 days, at or over the '
              || 'review threshold. Most recent: "' || COALESCE(_title, 'a job') || '".'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'open_dispute_as: dispute-velocity flag failed for % on job %: %',
        _uid, _job_id, SQLERRM;
    END;
  END IF;

  -- ── Tell the people this affects ────────────────────────────────────────
  -- A human filing tells the counterparty (the filer knows already). A system
  -- filing tells BOTH, because neither of them did this and neither is
  -- expecting it.
  --
  -- `?job=<id>`, never a fixed `?filter=`: `disputed` has no chip of its own.
  IF _system THEN
    IF _customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _customer,
        'Revision deadline passed: dispute opened',
        'The revision you requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so we opened a dispute for you. ' ||
          'The payment stays on hold and our team will decide it — add your side.',
        'warning',
        '/posts?job=' || _job_id::text
      );
    END IF;
    IF _helper IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _helper,
        'Revision deadline passed: dispute opened',
        'The revision requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so a dispute was opened automatically. ' ||
          'Our team will decide the payment — add your side.',
        'warning',
        '/jobs?job=' || _job_id::text
      );
    END IF;
    -- A crew has no helper_id: every hired member is told instead.
    FOR _member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE _crew AND g.job_id = _job_id AND g.helper_id IS NOT NULL
    LOOP
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _member,
        'Revision deadline passed: dispute opened',
        'The revision requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so a dispute was opened automatically. ' ||
          'Our team will decide the payment — add your side.',
        'warning',
        '/jobs?job=' || _job_id::text
      );
    END LOOP;
  ELSIF _crew THEN
    -- A crew: every hired member's pay is now on hold, so every member other
    -- than the filer is told; so is the poster when a member filed.
    IF _uid IS DISTINCT FROM _customer AND _customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _customer,
        'A dispute was opened',
        'A dispute was opened on "' || COALESCE(_title, 'a job') ||
          '". The payment is on hold while it is reviewed — add your side so our team hears from you both.',
        'warning',
        '/posts?job=' || _job_id::text
      );
    END IF;
    FOR _member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL AND g.helper_id IS DISTINCT FROM _uid
    LOOP
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _member,
        'A dispute was opened',
        'A dispute was opened on "' || COALESCE(_title, 'a job') ||
          '". The crew''s payment is on hold while it is reviewed — add your side so our team hears it.',
        'warning',
        '/jobs?job=' || _job_id::text
      );
    END LOOP;
  ELSIF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'A dispute was opened',
      'A dispute was opened on "' || COALESCE(_title, 'a job') ||
        '". The payment is on hold while it is reviewed — add your side so our team hears from you both.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/posts?job=' || _job_id::text
           ELSE '/jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- Then the admins, who are the ones who actually resolve it. Done here
  -- because it CANNOT be done from the client: `user_roles` is unreadable to
  -- a normal user and the notifications INSERT policy is admin/service-role
  -- only. `?view=` is what Admin.tsx reads.
  -- Not for test accounts (owner 2026-10-30): a dispute a test account opened,
  -- or on a job a test account posted or works, never reaches an admin's bell.
  IF NOT (public.is_test_subject(_uid) OR public.is_test_subject(_customer) OR public.is_test_subject(_helper)) THEN
    FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        _admin,
        'Job disputed',
        '"' || COALESCE(_title, 'a job') || '" has been disputed. Payment is on hold pending review.',
        'warning',
        '/admin?view=disputes',
        _job_id
      );
    END LOOP;
  END IF;

  -- And page ops in Slack.
  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$function$
;

-- sweep_dayof_confirm_reminders: from 20260927012241_group_crew_reminders_and_counts.sql
CREATE OR REPLACE FUNCTION public.sweep_dayof_confirm_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  v_start timestamptz;
  v_member uuid;
BEGIN
  -- Pass 1: window open — remind the unanswered parties.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.helper_id,
           j.helper_confirmed_at, j.helper_dayof_confirmed_at, j.poster_confirmed_at,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_confirm_reminder_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      v_start := rec.scheduled_start;
      -- Helper: skip when the day-of stamp exists OR the accept itself
      -- happened inside the window (same grace as JobConfirmation).
      IF rec.helper_dayof_confirmed_at IS NULL
         AND (rec.helper_confirmed_at IS NULL
              OR v_start - rec.helper_confirmed_at > INTERVAL '24 hours') THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.helper_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on. One tap keeps your spot.', rec.title),
                '/jobs?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      IF rec.poster_confirmed_at IS NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.customer_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on so your Helpr knows it''s a go.', rec.title),
                '/posts?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      UPDATE public.jobs SET dayof_confirm_reminder_sent_at = NOW() WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p1:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', 1, 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p1: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  -- Pass 1c (Q728): a CREW. No lead (Q407), so the single pass above never
  -- matches it (helper_id IS NULL): every hired member who has not confirmed
  -- for the day is reminded on their own roster row, and the poster once.
  -- Same window, same grace (a member hired inside the window is not
  -- reminded), same one-per-job stamp. A crew still staffing ('open' with
  -- members) is booked for the members already hired.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.poster_confirmed_at,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_confirm_reminder_sent_at IS NULL
      AND j.is_group_job IS TRUE
      AND j.status IN ('open', 'accepted')
      AND j.date_needed IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      v_start := rec.scheduled_start;
      FOR v_member IN
        SELECT g.helper_id FROM public.group_job_helpers g
         WHERE g.job_id = rec.id AND g.helper_id IS NOT NULL
           AND g.helper_dayof_confirmed_at IS NULL
           AND (g.helper_confirmed_at IS NULL OR v_start - g.helper_confirmed_at > INTERVAL '24 hours')
      LOOP
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (v_member, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on. One tap keeps your spot on the crew.', rec.title),
                '/jobs?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END LOOP;
      IF rec.poster_confirmed_at IS NULL AND rec.customer_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.customer_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on so your crew knows it''s a go.', rec.title),
                '/posts?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      UPDATE public.jobs SET dayof_confirm_reminder_sent_at = NOW() WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p1c:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', '1c', 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p1c: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  -- Pass 2: T-12h and the helper still hasn't answered — alert the poster.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_unanswered_poster_alert_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND j.helper_dayof_confirmed_at IS NULL
      AND (j.helper_confirmed_at IS NULL
           OR ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') - j.helper_confirmed_at > INTERVAL '24 hours')
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '12 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (rec.customer_id, 'warning', 'Your Helpr hasn''t confirmed yet',
              format('"%s" starts in under 12 hours and your Helpr hasn''t confirmed they''re still on. Message them — or line up a backup while there''s time.', rec.title),
              '/posts?job=' || rec.id::text, false, rec.id);
      UPDATE public.jobs SET dayof_unanswered_poster_alert_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p2:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', 2, 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p2: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  -- Pass 2c (Q728): T-12h and a crew member still hasn't answered — tell the
  -- poster once, with how many.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id,
           (SELECT count(*) FROM public.group_job_helpers g
             WHERE g.job_id = j.id AND g.helper_id IS NOT NULL
               AND g.helper_dayof_confirmed_at IS NULL
               AND (g.helper_confirmed_at IS NULL
                    OR ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') - g.helper_confirmed_at > INTERVAL '24 hours')
           )::int AS unanswered
    FROM public.jobs j
    WHERE j.dayof_unanswered_poster_alert_sent_at IS NULL
      AND j.is_group_job IS TRUE
      AND j.status IN ('open', 'accepted')
      AND j.date_needed IS NOT NULL
      AND j.customer_id IS NOT NULL
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '12 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    CONTINUE WHEN rec.unanswered = 0;
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (rec.customer_id, 'warning',
              CASE WHEN rec.unanswered = 1 THEN 'A crew Helpr hasn''t confirmed yet'
                   ELSE rec.unanswered::text || ' crew Helprs haven''t confirmed yet' END,
              format('"%s" starts in under 12 hours and not everyone on the crew has confirmed they''re still on. Message them — or line up a backup while there''s time.', rec.title),
              '/posts?job=' || rec.id::text, false, rec.id);
      UPDATE public.jobs SET dayof_unanswered_poster_alert_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p2c:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', '2c', 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p2c: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_dayof_confirm_reminders', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$function$;

-- declutter_notice_type: from 20261110202142_notice_titles_by_outcome_plain_words.sql
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
                     -- F508 (20261110205345): the same notices with titles that fit a lock screen
                     'It''s yours: pick a pickup time', 'Reserved for you: check out in 24 hours',
                     'Reserved: check out within 30 minutes', 'Bundle accepted: waiting on payment',
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

-- sms_kind_for: from 20261108200000_poster_cancel_refused_once_work_started.sql
CREATE OR REPLACE FUNCTION public.sms_kind_for(p_type text, p_title text, p_job_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    -- Nearby / matching jobs are never texted (owner 2026-10-23). First, so nothing below can catch one.
    WHEN p_type = 'job_match' THEN NULL
    WHEN p_type = 'message' THEN 'message'
    -- Needs-you deadline reminders (owner 11-01 12:19 PM; 20261102002011): a step the member must take before a
    -- deadline. Jobs: approve the finished work (sweep_release_last_chance). Declutter: check out (the 24 h and 2 h
    -- checkout reminders), hand over (the 1-hour pickup reminder), answer an offer or a refund step
    -- (sweep_needs_you_reminders). Ahead of every catch-all.
    WHEN p_type IN ('warning', 'work_status') AND p_title = 'Please review the work' THEN 'needs_you'
    WHEN p_type = 'payment' AND p_title IN ('Check out within 24 hours', '2 hours left to check out') THEN 'needs_you'
    WHEN p_type = 'declutter_pickups' AND (p_title IN ('Porch pickup in 1 hour', 'Pickup in 1 hour')
                                           OR p_title LIKE 'Porch pickup at %' OR p_title LIKE 'Pickup at %') THEN 'needs_you'
    WHEN p_type = 'declutter_offers' AND p_title IN ('Answer the offer', 'Offer closes soon') THEN 'needs_you'
    WHEN p_type = 'declutter_refunds' AND p_title IN ('Answer the refund request', 'Refund request closes soon',
                                                      'Answer the refund offer', 'Refund offer closes soon') THEN 'needs_you'
    -- A job offer has an answer deadline (direct offer, or the hire offer).
    WHEN p_type = 'new_offers' AND p_title IN ('You got a direct job offer!', 'New job offer', '📋 New job offer!') THEN 'job_offer'
    WHEN p_type = 'info' AND p_title = '📋 New job offer!' THEN 'job_offer'
    WHEN p_type = 'application' AND p_title = 'New application' THEN 'application'
    WHEN p_type = 'job_update' AND p_title = 'Starting soon' THEN 'starting_soon'
    -- Q2483: the 2-hour and head-out start reminders are as time-critical as Starting soon.
    WHEN p_type = 'job_update' AND p_title IN ('Your job starts in 2 hours', 'Time to head out') THEN 'starting_soon'
    WHEN p_type = 'job_updates' AND p_title = 'New date or time requested' THEN 'reschedule'
    WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute'
    WHEN p_type IN ('payment', 'warning', 'job_updates') AND p_title IN ('Job cancelled', 'Job cancelled — you''ll be compensated') THEN 'job_cancelled'
    WHEN p_type IN ('warning', 'job_updates') AND p_title = 'Your Helpr cancelled' THEN 'job_cancelled'
    WHEN p_type = 'job_updates' AND p_title = 'Job auto-cancelled' THEN 'job_cancelled'
    WHEN p_type = 'warning' AND p_title IN ('Your payout didn''t go through', 'Payout account needs attention',
                                            'Payment failed', 'Your bank payment failed', 'Job payment failed')
      THEN 'money_problem'
    WHEN p_type = 'payment' AND p_title = 'A refund didn''t go through' THEN 'money_problem'
    WHEN p_type = 'financial_alerts' AND p_title IN ('Payout account required', 'We couldn''t send your payout') THEN 'money_problem'
    -- Back-out reminders moved from 'warning' to 'job_updates' and are still never texted: ahead of the catch-all.
    WHEN p_type = 'job_updates' AND p_title IN ('Offer declined', 'Offer expired', 'Your Helpr didn''t confirm',
                                                'Your Helpr hasn''t confirmed yet', 'A Helpr on your crew hasn''t confirmed yet',
                                                'A crew Helpr hasn''t confirmed yet')
      THEN NULL
    -- Other updates on the member's own job.
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'expired') AND p_job_id IS NOT NULL THEN 'job_update'
    WHEN p_type IN ('info', 'success') AND p_job_id IS NOT NULL THEN 'job_update'
    ELSE NULL
  END;
$fn$;

-- jobs_notice_email_type: from 20261108214605_continue_day_missed_return.sql
CREATE OR REPLACE FUNCTION public.jobs_notice_email_type(p_type text, p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    -- Hired and paid (Payments / Financial alerts: the row's own type).
    WHEN p_type = 'financial_alerts' AND p_title IN ('Job funded', 'Payout released', 'You received a tip!') THEN p_type
    WHEN p_type = 'financial_alerts' AND p_title LIKE '% tipped you %' THEN p_type
    WHEN p_type IN ('payment', 'info') AND p_title IN ('Job approved!', 'Job complete', 'Helpr support approved your job', 'Job completed!') THEN p_type
    -- The poster cancelled (poster_cancel_job: 'payment' when the Helpr is paid for their time, else 'job_updates').
    WHEN p_type IN ('payment', 'job_updates') AND p_title IN ('Job cancelled', 'Job cancelled — you''ll be compensated') THEN p_type
    -- A dispute opened (the parties' copies; 'A dispute was opened' is filed under job_updates before insert).
    WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('A dispute was opened', 'Revision deadline passed: dispute opened') THEN 'job_updates'
    -- Reschedule asked, answered, withdrawn, not applied, unanswered.
    WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('New date or time requested', 'New date or time accepted',
      'New date or time declined', 'New date or time not possible', 'Offer to come back not answered in time',
      'Date or time request withdrawn', 'New date or time not applied', 'Your new time wasn''t answered') THEN 'job_updates'
    -- The start passed with no check-in; the last chance to approve.
    WHEN p_type = 'work_status' AND p_title IN ('Start time passed', 'Job day ended', 'Please review the work') THEN 'work_status'
    -- Continue-day check-ins (continue_day_check_in: the Helpr's first name leads the title).
    WHEN p_type = 'job_updates' AND (p_title LIKE '% is on the way back' OR p_title LIKE '% is back at the job'
                                     OR p_title LIKE '% started working again') THEN 'job_updates'
    -- CHANGED 20261108214605 (owner #4): a missed continue day, told to the other side.
    WHEN p_type = 'job_updates' AND p_title IN ('Reported: didn''t come back', 'Your Helpr can''t come back') THEN 'job_updates'
    ELSE NULL
  END;
$fn$;

-- guarantee_filing_skips_revision_notice: from 20261027200455_helpr_guarantee.sql
CREATE OR REPLACE FUNCTION public.guarantee_filing_skips_revision_notice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF COALESCE(current_setting('app.guarantee_filing', true), '') = 'on'
     AND NEW.title = 'Revision deadline passed: dispute opened' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

-- The guarantee filing's BEFORE INSERT filter fires on the renamed title (20261027200455 restated).
REVOKE ALL ON FUNCTION public.guarantee_filing_skips_revision_notice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS aa_notifications_guarantee_filing ON public.notifications;
CREATE TRIGGER aa_notifications_guarantee_filing
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.title = 'Revision deadline passed: dispute opened')
  EXECUTE FUNCTION public.guarantee_filing_skips_revision_notice();

-- trg_email_declutter_notice (20261109005133 restated): the renamed trade titles are excluded like the old ones.
DROP TRIGGER IF EXISTS trg_email_declutter_notice ON public.notifications;
CREATE TRIGGER trg_email_declutter_notice
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type IN ('declutter_offers', 'declutter_sales', 'declutter_pickups', 'declutter_refunds')
        AND NEW.title NOT IN (
          -- their own email already goes (header)
          'Payment received', 'Buyer paid', 'Refund on its way',
          'Delivery pay raised', 'Your raise is coming back', 'Shipping refund on its way',
          -- the payment page said it first (M4)
          'Card saved',
          -- each chat line: the delayed "Unread message" reminder is emailed instead
          'New message about your order', 'New message about a handover', 'New message about a delivery',
          -- an edit to an item someone offered on
          'Listing updated', 'Listing changed')
        AND NEW.title NOT LIKE 'Your payout for %'
        -- trade notices: trg_email_declutter_trade_notice (20261108195151) emails the ones that go, once
        AND NEW.title NOT IN (
          'New trade offer', 'Trade offer declined', 'Trade offer expired', 'Trade offer closed',
          'Trade offer: about 12 hours left', 'Trade accepted: choose a pickup within 48 hours',
          'Trade accepted: pick a pickup time',
          'Trade cancelled', 'Trade ended, no strike',
          'Trade offer withdrawn', 'Trade set: choose a pickup within 48 hours', 'Trade set: pick a pickup time',
          'You cancelled the trade'))
  EXECUTE FUNCTION public.email_declutter_notice();

-- trg_email_declutter_trade_notice (20261108195151 restated): the renamed "accepted" title is emailed, once.
DROP TRIGGER IF EXISTS trg_email_declutter_trade_notice ON public.notifications;
CREATE TRIGGER trg_email_declutter_trade_notice
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (COALESCE(NEW.link, '') LIKE '/declutter%'
        AND NEW.title IN ('New trade offer', 'Trade offer declined', 'Trade offer expired', 'Trade offer closed',
                          'Trade offer: about 12 hours left', 'Trade accepted: choose a pickup within 48 hours',
                          'Trade accepted: pick a pickup time',
                          'Trade cancelled', 'Trade ended, no strike'))
  EXECUTE FUNCTION public.email_declutter_trade_notice();
