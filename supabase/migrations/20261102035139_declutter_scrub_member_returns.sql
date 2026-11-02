-- Q1933: a deleted member's exact addresses (and words) outlive the deletion on rows added after the scrub.
--
-- What was broken: declutter_scrub_member (20261021204947, Q2307), which the account purge calls before the auth user
-- goes, already clears the deleted member's drop-off address on the order's delivery row and their home address on
-- finished Helpr delivery tasks (the columns Q1933 names; placeholders, since the columns are NOT NULL). But a finished
-- sale outlives the deletion with everything hanging off it, and two later changes added personal data the scrub
-- never learned about:
--   * declutter_refund_requests.return_address / return_lat / return_lng (20261030071818): the exact address the
--     BUYER typed for the seller to collect a return; and the request's note and photo_paths (the buyer's words and
--     photos, 20261029225634);
--   * declutter_problems.other_side_note / other_side_photo_paths (20261029225634): the words and photos of the party
--     who did NOT report the problem (the reporter's own were already scrubbed).
-- A request or problem still in flight blocks the deletion first (accountPurge.ts findDeclutterInFlight), so only
-- settled rows are scrubbed. What stays is the outcome (status, money, fault, dates), the owner/lead rule of
-- 2026-10-21 ("what stays for the other side is money only").
--
-- declutter_scrub_member is restated VERBATIM from 20261021204947 (its only CREATE) plus the two UPDATEs and two new
-- keys in its report (marked "New (Q1933)"). Photo FILES go in the purge's storage step, as before.
-- Replay-safe: CREATE OR REPLACE; grants as before (service role only).
-- Proof: src/test/pglite/declutterScrubMemberReturns.pglite.mjs. Guard: src/test/declutterScrubMemberReturns.test.ts.

CREATE OR REPLACE FUNCTION public.declutter_scrub_member(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_handovers integer := 0;
  v_problems integer := 0;
  v_deliveries integer := 0;
  v_tasks integer := 0;
  v_reviews integer := 0;
  v_requests integer := 0;
  v_other_side integer := 0;
  v_rows integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user' USING ERRCODE = '22023';
  END IF;
  -- The porch note is the seller's words; on a sale with someone who is leaving, it goes.
  UPDATE public.declutter_handovers h
     SET set_out_note = NULL
    FROM public.declutter_orders o
   WHERE h.order_id = o.id AND (o.buyer_id = p_user_id OR o.seller_id = p_user_id) AND h.set_out_note IS NOT NULL;
  GET DIAGNOSTICS v_handovers = ROW_COUNT;
  -- Their drop-off address on the delivery row of a sale they bought (NOT NULL columns: placeholders).
  UPDATE public.declutter_order_deliveries d
     SET dropoff_address = 'Removed: account deleted', dropoff_area = 'Removed', dropoff_lat = 0, dropoff_lng = 0
    FROM public.declutter_orders o
   WHERE d.order_id = o.id AND o.buyer_id = p_user_id AND d.dropoff_address IS DISTINCT FROM 'Removed: account deleted';
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;
  -- Their home address on FINISHED Helpr delivery tasks (a task still running blocks the deletion first).
  UPDATE public.helpr_tasks t
     SET pickup_address = 'Removed: account deleted', pickup_area = 'Removed', pickup_lat = 0, pickup_lng = 0
   WHERE t.pickup_contact_id = p_user_id AND t.status IN ('confirmed', 'cancelled', 'failed', 'unfilled')
     AND t.pickup_address IS DISTINCT FROM 'Removed: account deleted';
  GET DIAGNOSTICS v_tasks = ROW_COUNT;
  UPDATE public.helpr_tasks t
     SET dropoff_address = 'Removed: account deleted', dropoff_area = 'Removed', dropoff_lat = 0, dropoff_lng = 0
   WHERE t.customer_id = p_user_id AND t.status IN ('confirmed', 'cancelled', 'failed', 'unfilled')
     AND t.dropoff_address IS DISTINCT FROM 'Removed: account deleted';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_tasks := v_tasks + v_rows;
  -- The reviews they wrote keep the stars (the other side's rating), not their words or tags.
  UPDATE public.declutter_reviews r
     SET comment = NULL, tags = '{}'
   WHERE r.reviewer_id = p_user_id AND (r.comment IS NOT NULL OR cardinality(r.tags) > 0);
  GET DIAGNOSTICS v_reviews = ROW_COUNT;
  -- Their problem reports keep the decision (money and fault), not their words or photos (note is NOT NULL, 1..1000).
  UPDATE public.declutter_problems p
     SET note = 'Removed: this member deleted their account.', photo_paths = '{}'
   WHERE p.reporter_id = p_user_id
     AND (p.note IS DISTINCT FROM 'Removed: this member deleted their account.' OR cardinality(p.photo_paths) > 0);
  GET DIAGNOSTICS v_problems = ROW_COUNT;
  -- New (Q1933): their refund requests on sales they bought keep the outcome (status, money, dates), not their
  -- words, photos or the address they typed for the seller to collect a return (note is NOT NULL, 1..1000; the
  -- return address, lat and lng are all-or-nothing, so all three go).
  UPDATE public.declutter_refund_requests q
     SET note = 'Removed: this member deleted their account.', photo_paths = '{}',
         return_address = NULL, return_lat = NULL, return_lng = NULL
    FROM public.declutter_orders o
   WHERE q.order_id = o.id AND o.buyer_id = p_user_id
     AND (q.note IS DISTINCT FROM 'Removed: this member deleted their account.' OR cardinality(q.photo_paths) > 0
          OR q.return_address IS NOT NULL OR q.return_lat IS NOT NULL);
  GET DIAGNOSTICS v_requests = ROW_COUNT;
  -- New (Q1933): their side of a problem the OTHER party reported (other_side_note / photos, 20261029225634).
  UPDATE public.declutter_problems p
     SET other_side_note = NULL, other_side_photo_paths = '{}'
    FROM public.declutter_orders o
   WHERE p.order_id = o.id AND (o.buyer_id = p_user_id OR o.seller_id = p_user_id)
     AND p.reporter_id IS DISTINCT FROM p_user_id
     AND (p.other_side_note IS NOT NULL OR cardinality(p.other_side_photo_paths) > 0);
  GET DIAGNOSTICS v_other_side = ROW_COUNT;
  RETURN jsonb_build_object('handovers_scrubbed', v_handovers, 'problem_reports_scrubbed', v_problems,
    'delivery_addresses_scrubbed', v_deliveries, 'task_addresses_scrubbed', v_tasks, 'reviews_scrubbed', v_reviews,
    'refund_requests_scrubbed', v_requests, 'problem_answers_scrubbed', v_other_side);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_scrub_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_scrub_member(uuid) TO service_role;
