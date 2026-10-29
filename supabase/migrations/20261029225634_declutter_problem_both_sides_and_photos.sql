-- Declutter: both sides of a problem, and photos on refund requests (audit 1b #3; Builder 45's two server gaps, measured
-- live 2026-10-29, via the coordinator).
--
-- WHAT WAS BROKEN:
--   #3  The seller could not give their side, and a second report on a sale with an open problem (the seller's, or
--       the buyer's own again) answered with the first report's id while its reason, note and photos were thrown
--       away; the app showed success (prod 2026-10-29: the seller's report returned the buyer's problem id, note unchanged).
--   B45 (1) declutter_ask_refund took no photos, so a "damaged" refund request could only be words; and the photos
--       never reached Louisiana Helpr when the request went to it.
--   B45 (2) declutter_handover_photo_access let a party upload only while the order is 'paid', so no problem or
--       refund photo could be uploaded after the handover, when those are reported.
--
-- WHAT CHANGES (each function restated VERBATIM from its newest definition, with only these edits):
--   * declutter_problems gains the other side's words and photos (other_side_note, other_side_photo_paths up to 3,
--     other_side_at); declutter_refund_requests gains photo_paths (up to 3). Both sides already read problem rows
--     ("declutter problems: the two sides and admins read", 20261015042253); the request reaches members through the view.
--   * NEW declutter_problem_add_side(problem, note, photos): only the OTHER side of the sale, only while the problem
--     is open; photos only from the caller's own <uid>/declutter/problem/<order>/ folder and already uploaded.
--     The reporter and the admins are told.
--   * declutter_report_problem (20261026155251): a second report is refused with words (problem_already_open: add your
--     side; problem_already_reported: yours is with Louisiana Helpr). The same report sent twice still answers its id.
--   * declutter_ask_refund (20261026155251): p_photo_paths text[] DEFAULT '{}' (up to 3, the buyer's own problem
--     folder), stored on the request. The 3-argument version is dropped; a call with the three old named arguments
--     resolves to the new one.
--   * declutter_refund_request_to_admin (20261026155251): the request's photos go on the problem it opens, or are
--     added to the open problem it joins (up to the problem's 6).
--   * declutter_refund_request_view (20261029224147): the request carries photo_paths.
--   * declutter_handover_photo_access (20261017055502): 'problem' folder uploads also on a handed-over order while a
--     problem can still be reported, a refund request waits, or a problem is open. Handover photos stay paid-only.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS; DROP FUNCTION IF EXISTS for the old ask_refund signature; CREATE OR REPLACE.
-- Proof: src/test/pglite/declutterProblemBothSides.pglite.mjs. Guard: src/test/declutterProblemBothSides.test.ts.

ALTER TABLE public.declutter_problems
  ADD COLUMN IF NOT EXISTS other_side_note text CHECK (other_side_note IS NULL OR char_length(btrim(other_side_note)) BETWEEN 1 AND 1000),
  ADD COLUMN IF NOT EXISTS other_side_photo_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(other_side_photo_paths) <= 3),
  ADD COLUMN IF NOT EXISTS other_side_at timestamptz;
ALTER TABLE public.declutter_refund_requests
  ADD COLUMN IF NOT EXISTS photo_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_paths) <= 3);

-- DESTRUCTIVE-DDL-ACK: DROP FUNCTION public.declutter_ask_refund(uuid, text, text)
-- ACK-REASON: replaced right below by the same function with a fourth parameter (p_photo_paths DEFAULT '{}'); a call
-- with the three old named arguments resolves to the new one.
-- ACK-DATA-LOSS: No data: this drops a function definition, not rows.
DROP FUNCTION IF EXISTS public.declutter_ask_refund(uuid, text, text);

CREATE OR REPLACE FUNCTION public.declutter_report_problem(p_order_id uuid, p_reason text, p_note text, p_photo_paths text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
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
$fn$;
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
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Refund request',
    'The buyer asked for a refund. Answer within 24 hours: refund it all, offer part, or say no. If you don''t answer, Louisiana Helpr decides. Your payout waits until then.',
    '/declutter?view=selling', v_uid);
  RETURN jsonb_build_object('result', 'asked', 'request_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ask_refund(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_ask_refund(uuid, text, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_request_to_admin(p_request_id uuid, p_why text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r public.declutter_refund_requests;
  o public.declutter_orders;
  v_problem uuid;
  a record;
BEGIN
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = r.order_id;
  SELECT x.id INTO v_problem FROM public.declutter_problems x WHERE x.order_id = r.order_id AND x.status = 'open';
  IF v_problem IS NULL THEN
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
    VALUES (r.order_id, o.buyer_id, 'buyer', r.reason,
            left(btrim(r.note) || E'\n\n[Refund request: ' || p_why || ']', 1000), COALESCE(r.photo_paths, '{}'))
    RETURNING id INTO v_problem;
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter refund to decide',
        'A buyer asked for a refund after the handover and the two sides did not agree. The seller''s payout is held until you decide.', '/admin');
    END LOOP;
  ELSE
    -- D2-3: joining a problem already open: the request's photos are added to it (the problem holds up to 6).
    UPDATE public.declutter_problems x
       SET photo_paths = (SELECT COALESCE(array_agg(u.p ORDER BY u.n), '{}') FROM (
             SELECT q.p, min(q.n) AS n FROM unnest(x.photo_paths || COALESCE(r.photo_paths, '{}')) WITH ORDINALITY AS q(p, n)
              GROUP BY q.p ORDER BY min(q.n) LIMIT 6) u)
     WHERE x.id = v_problem AND cardinality(COALESCE(r.photo_paths, '{}')) > 0;
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'to_admin', problem_id = v_problem WHERE id = r.id;
  PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Louisiana Helpr will decide',
    'Your refund request goes to Louisiana Helpr. We look at both sides and decide. The seller isn''t paid until then.',
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Louisiana Helpr will decide',
    'The buyer''s refund request goes to Louisiana Helpr. We look at both sides and decide. Your payout waits until then.',
    '/declutter?view=selling', o.buyer_id);
  RETURN v_problem;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_request_to_admin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_to_admin(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_request_view(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_side text;
  v_refund public.declutter_refunds;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF o.id IS NULL OR v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE order_id = o.id;
  IF r.refund_id IS NOT NULL THEN
    SELECT * INTO v_refund FROM public.declutter_refunds WHERE id = r.refund_id;
  END IF;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'side', v_side,
    'handed_over', o.status = 'handed_over',
    'window_ends_at', CASE WHEN o.status = 'handed_over' THEN o.handed_over_at + interval '24 hours' END,
    'can_ask', COALESCE(v_side = 'buyer' AND o.status = 'handed_over' AND r.id IS NULL
               AND now() < o.handed_over_at + interval '24 hours'
               AND NOT public.declutter_sale_decided(o.id) AND public.declutter_payout_unsent(o.id)
               AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open'), false),
    'can_report', COALESCE(v_side = 'buyer' AND public.declutter_problem_window_open(o.id)
                  AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open'), false),
    'items_cents', o.items_cents,
    'full_refund_cents', public.declutter_full_refund_cents(o.id),
    'delivery_kept_cents', public.declutter_delivery_reserved_cents(o.id),
    'request', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'status', r.status, 'reason', r.reason, 'note', r.note, 'answer_by', r.answer_by,
      -- D2-3: the buyer's photos (both sides read them through declutter-handover's read rule: the two parties and admins).
      'photo_paths', COALESCE(r.photo_paths, '{}'),
      'offer_cents', r.offer_cents, 'offer_answer_by', r.offer_answer_by, 'declined_at', r.declined_at,
      'return_by', r.return_by, 'returned_at', r.returned_at,
      'report_until', CASE WHEN r.status = 'declined' THEN greatest(r.declined_at, o.handed_over_at) + interval '24 hours' END,
      'refund_cents', v_refund.refund_cents, 'refund_status', v_refund.status, 'created_at', r.created_at,
      -- D2-5: the request ended with Louisiana Helpr's decision (not the seller's answer), so the panel says so.
      'admin_decided', r.status IN ('agreed', 'declined')
                       AND EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.id = r.problem_id AND x.status = 'decided')) END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_request_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_view(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_handover_photo_access(p_name text, p_write boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
BEGIN
  IF v_uid IS NULL OR p_name IS NULL OR p_write IS NULL
     -- Exactly <uid>/declutter/<handover|problem>/<order>/<file>: no extra or empty segments.
     OR array_length(string_to_array(p_name, '/'), 1) IS DISTINCT FROM 5
     OR split_part(p_name, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_name, '/', 3) NOT IN ('handover', 'problem')
     OR split_part(p_name, '/', 4) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR split_part(p_name, '/', 5) = ''
     OR split_part(p_name, '/', 6) <> '' THEN
    RETURN false;
  END IF;
  v_order := split_part(p_name, '/', 4)::uuid;
  IF p_write THEN
    -- Only into your own folder, only for an order you are a party of, and
    -- only while it is paid (both RPCs take a photo only then; lh-authz-rls
    -- review of lane J, should-fix 2: no uploads to a refunded or closed order).
    -- D2-3 (Builder 45, measured live 2026-10-29): problem and refund photos are taken after the handover too, so
    -- the 'problem' folder also takes uploads while the order is handed over and a problem can still be reported,
    -- a refund request waits for an answer, or a problem is open (the other side adds theirs). Handover photos: paid only.
    RETURN split_part(p_name, '/', 1) = v_uid::text
       AND EXISTS (SELECT 1 FROM public.declutter_orders o
                    WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid)
                      AND (o.status = 'paid'
                           OR (split_part(p_name, '/', 3) = 'problem' AND o.status = 'handed_over'
                               AND (public.declutter_problem_window_open(o.id)
                                    OR EXISTS (SELECT 1 FROM public.declutter_refund_requests r
                                                WHERE r.order_id = o.id AND r.status IN ('open', 'offered', 'returning'))
                                    OR EXISTS (SELECT 1 FROM public.declutter_problems x
                                                WHERE x.order_id = o.id AND x.status = 'open')))));
  END IF;
  RETURN public.has_role(v_uid, 'admin')
      OR EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_handover_photo_access(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_handover_photo_access(text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_problem_add_side(p_problem_id uuid, p_note text, p_photo_paths text[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  p public.declutter_problems;
  v_side text;
  v_path text;
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
  -- Only the OTHER side of the sale (never the reporter, never a stranger, who is not told it exists).
  IF v_side IS NULL OR v_side NOT IN ('buyer', 'seller') THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p.reporter_id IS NOT DISTINCT FROM v_uid OR p.reporter_side = v_side THEN
    RAISE EXCEPTION 'problem_side_is_yours' USING ERRCODE = '55000',
      HINT = 'You reported this problem. Louisiana Helpr is looking at it.';
  END IF;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell Louisiana Helpr your side (up to 1,000 characters).';
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
  -- One side per problem; sent again before the decision, it replaces the earlier words and photos.
  UPDATE public.declutter_problems
     SET other_side_note = btrim(p_note), other_side_photo_paths = COALESCE(p_photo_paths, '{}'), other_side_at = now()
   WHERE id = p.id;
  IF p.reporter_id IS NOT NULL THEN
    PERFORM public.declutter_notify(p.reporter_id, 'declutter_refunds', 'The other side answered',
    format('The %s added their side to the problem with %s. Louisiana Helpr reads both before it decides.',
           v_side, public.declutter_order_items_named(o.id)),
    '/declutter?view=' || CASE WHEN v_side = 'seller' THEN 'cart' ELSE 'selling' END, v_uid);
  END IF;
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'info', 'Declutter problem: the other side answered',
      'The other side of a reported Declutter problem added their side. It is in the problem case.', '/admin');
  END LOOP;
  RETURN jsonb_build_object('result', 'added', 'problem_id', p.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_problem_add_side(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_problem_add_side(uuid, text, text[]) TO authenticated, service_role;
