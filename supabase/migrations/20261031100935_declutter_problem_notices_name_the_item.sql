-- BUY-30 (buying audit 10-30 #30): dispute and refund notices named no item and opened a retired link. The seller's
-- "Refund request" and the other side's "A problem was reported on your sale" now name the order's items
-- (declutter_order_items_named, as the delivery notices do since 20261030031642) and open the recipient's own tab
-- (?tab=selling for the seller, ?tab=buying for the buyer; ?view=selling / ?view=cart are retired). Titles are
-- unchanged: declutter_notice_type files notices by title.
--
-- Restated verbatim from origin/main's NEWEST CREATEs (newest file naming each function, on origin/main and on
-- wip/b76-1031, read 2026-10-31):
--   declutter_report_problem  20261030134109_declutter_take_back_problem_report.sql
--   declutter_ask_refund      20261029225634_declutter_problem_both_sides_and_photos.sql
-- The ONLY change in each body is its one notice to the other side (marked BUY-30). Every check, lock, write, the
-- admin notices and the money hold are as before. No money moves in either function.
--
-- REPLAY-SAFE: CREATE OR REPLACE; grants restated by role name.
-- Proof: src/test/pglite/declutterProblemNoticesNameTheItem.pglite.mjs (3x; NEW_MIGRATION=skip is red).

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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
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

CREATE OR REPLACE FUNCTION public.declutter_ask_refund(p_order_id uuid, p_reason text, p_note text,
  p_photo_paths text[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_id uuid;
  v_path text;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'handed_over' THEN
    RAISE EXCEPTION 'refund_before_handover' USING ERRCODE = '55000',
      HINT = 'You can ask for a refund once you have the item. Before that, report a problem.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_refund_requests r WHERE r.order_id = o.id) THEN
    RAISE EXCEPTION 'refund_already_asked' USING ERRCODE = '55000';
  END IF;
  IF o.handed_over_at IS NULL OR now() >= o.handed_over_at + interval '24 hours' OR public.declutter_sale_decided(o.id) THEN
    RAISE EXCEPTION 'refund_window_over' USING ERRCODE = '55000',
      HINT = 'The 24 hours to ask for a refund are over, so this sale is final.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
  END IF;
  PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
  IF NOT public.declutter_payout_unsent(o.id) THEN
    RAISE EXCEPTION 'refund_window_over' USING ERRCODE = '55000',
      HINT = 'The 24 hours to ask for a refund are over, so this sale is final.';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('not_as_described', 'damaged', 'not_received') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell the seller what''s wrong (up to 1,000 characters).';
  END IF;
  IF cardinality(COALESCE(p_photo_paths, '{}')) > 3 THEN
    RAISE EXCEPTION 'too_many_problem_photos' USING ERRCODE = '22023', HINT = 'Add up to 3 photos.';
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
  INSERT INTO public.declutter_refund_requests (order_id, reason, note, answer_by, photo_paths)
  VALUES (o.id, p_reason, btrim(p_note), now() + interval '24 hours', COALESCE(p_photo_paths, '{}'))
  RETURNING id INTO v_id;
  -- BUY-30: the notice names the item and opens Selling (the retired ?view= link went).
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Refund request',
    format('The buyer asked for a refund on %s. Answer within 24 hours: refund it all, offer part, or say no. If you don''t answer, Louisiana Helpr decides. Your payout waits until then.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=selling', v_uid);
  RETURN jsonb_build_object('result', 'asked', 'request_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ask_refund(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_ask_refund(uuid, text, text, text[]) TO authenticated, service_role;
