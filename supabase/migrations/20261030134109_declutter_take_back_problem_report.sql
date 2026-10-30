-- Declutter: "Take back my report" until Louisiana Helpr acts (owner 2026-10-30 08:25, pop-up answer 4: build
-- 'take back my report' until an admin acts, a withdrawn state, the payout hold lifts and the clock resumes; Builder 100).
--
-- What this adds:
--   * declutter_problems.status 'withdrawn' (+ withdrawn_at). The status and decided CHECKs gain a withdrawn branch:
--     no decision, no fault, no decided_at, withdrawn_at set. There are 0 rows on prod (read 2026-10-30), and every
--     existing open/decided row already satisfies the new CHECK.
--   * declutter_withdraw_problem(problem): only the member who reported it, as the buyer or seller of the order
--     (a Helpr's no-show report is not theirs to take back here), only while it is still 'open' (once Louisiana
--     Helpr decides, it is too late). Locks the order, then the problem, as the decision does, so a withdraw and a
--     decision cannot both land.
--       - A refund request that went to Louisiana Helpr WITH a buyer's report is the buyer's own: it is withdrawn too
--         (otherwise it would sit 'to_admin' with no open problem, unseen in the admin queue).
--       - Refused when a return was already agreed on that request (return_agreed_at set: the item may be back with
--         the seller; the 2026-10-27 money review's rule for declutter_withdraw_refund) and when a SELLER's report
--         carries the buyer's refund request (the buyer's request must not be dropped by the seller).
--     The other side and the admins are told.
--   * declutter_report_problem: a member who took back their report on a sale cannot report that sale again
--     (B100 conservative choice: otherwise report, take back, report again would hold the seller's money without
--     end). The other side can still report. Restated from the EFFECTIVE prod definition (pg_get_functiondef
--     2026-10-30, md5 1d0faa8d88e0e1cd936d08c189458970 = 20261029225634); the one change is marked "B100".
--
-- Nothing else needs restating for the hold to lift and the clocks to resume: every reader of a problem checks
-- status = 'open' (read on prod 2026-10-30: declutter_payouts_due, declutter_handover_sweep, declutter_ask_refund,
-- declutter_complete_handover, declutter_book_pickup/porch_day, delivery time, report_no_show/not_delivered,
-- declutter_porch_photo, declutter_handover_photo_access, declutter_refund_request_view, helpr_task_source_held,
-- declutter_order_talk_until, declutter_admin_open_problems), and declutter_sale_decided counts only 'decided'. So a
-- withdrawn problem stops holding the payout, stops pausing the handover sweep (its 24-hour clocks run from their
-- original start; nothing is restarted), and leaves the admin queue.
--
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, DROP/ADD CONSTRAINT IF EXISTS, CREATE OR REPLACE. Applied 3x in PGlite
-- (src/test/pglite/declutterTakeBackProblemReport.pglite.mjs).
-- DESTRUCTIVE-DDL-ACK: declutter_problems_status_check, declutter_problems_decided are dropped and re-added wider in
-- the same statement block (a withdrawn branch added; open and decided rows read as before).
-- ACK-DATA-LOSS: none; no column, table or row is dropped.

ALTER TABLE public.declutter_problems ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
DO $do$
BEGIN
  ALTER TABLE public.declutter_problems DROP CONSTRAINT IF EXISTS declutter_problems_status_check;
  ALTER TABLE public.declutter_problems ADD CONSTRAINT declutter_problems_status_check
    CHECK (status = ANY (ARRAY['open'::text, 'decided'::text, 'withdrawn'::text]));
  ALTER TABLE public.declutter_problems DROP CONSTRAINT IF EXISTS declutter_problems_decided;
  ALTER TABLE public.declutter_problems ADD CONSTRAINT declutter_problems_decided CHECK (
       (status = 'open' AND decision IS NULL AND fault IS NULL AND decided_at IS NULL AND withdrawn_at IS NULL)
    OR (status = 'decided' AND decision IS NOT NULL AND fault IS NOT NULL AND decided_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (status = 'withdrawn' AND decision IS NULL AND fault IS NULL AND decided_at IS NULL AND withdrawn_at IS NOT NULL));
END
$do$;

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
    'The money stays held until Louisiana Helpr looks at it. We may ask you for photos.',
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'cart' END, v_uid);
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
      'A buyer or seller reported a problem on a paid sale. The money is held until you decide it.', '/admin');
  END LOOP;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_report_problem(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_report_problem(uuid, text, text, text[]) TO authenticated, service_role;
