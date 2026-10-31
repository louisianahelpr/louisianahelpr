-- LEAD-TAKENBACK-LINK (lead 10-31; NOID-16's old links): the "Problem report taken back" notice still named the old
-- address ('/declutter?view=selling' for the seller, '/declutter?view=cart' for the buyer). declutter_notify_strict
-- already rewrites both at write time (declutter_notice_link, 20261030155159: view=selling -> tab=selling, view=cart ->
-- tab=buying), so the stored link was already the tab one; this restatement makes the source say it, so the ?view=
-- ratchet (src/test/declutterNoticeLinksOneFormat.test.ts) drops declutter_withdraw_problem. (For verdict.)
--
-- declutter_withdraw_problem restated verbatim from its newest CREATE (20261031004529_declutter_handover_both_confirm,
-- on origin/main; no newer one on wip/b75-1031, wip/b76-1031 or open PR land/l43-next-ea305f7d). The ONLY change is
-- the one link line (marked CHANGED). No refund, amount, fee or hold is read or written differently.
-- Replay-safe: CREATE OR REPLACE; grants by role name as before.
-- Proof: src/test/pglite/declutterTakenBackNoticeLink.pglite.mjs (3x; NEW_MIGRATION=skip is red).

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
    -- CHANGED (LEAD-TAKENBACK-LINK): the tab address, not the old ?view= one.
    '/declutter?tab=' || CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'buying' END, v_uid);
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'info', 'Declutter problem taken back',
      'A member took back a Declutter problem they reported. It has left the problems queue.', '/admin');
  END LOOP;
  RETURN jsonb_build_object('result', 'withdrawn', 'problem_id', p.id, 'refund_requests_withdrawn', v_withdrawn);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_withdraw_problem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_problem(uuid) TO authenticated, service_role;
