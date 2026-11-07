-- Shops: the Helpr's answer photo reaches the admin queue (Builder 5, 11-06; follows 20261106211136 and the Helpr
-- delivery stack). shop_helpr_answer_no_show (20261106211136) checked the Helpr's proof photo (their own task folder in
-- the private helpr-tasks bucket) but kept it only on the task's event log, so an admin deciding the held order in
-- Admin -> Shops never saw it. This:
--   1. adds shop_handovers.problem_photo_path (a helpr-tasks path; only with a problem). NOT granted to authenticated:
--      the table's column grant (20261018211820) stays as it is, so the buyer and the shop do not read it; an admin
--      reads it through shops_admin_queue (admin only) and opens it with a signed URL (the helpr-tasks read policy
--      already lets an admin read every task photo: helpr_task_photo_access).
--   2. restates shop_helpr_answer_no_show from 20261106211136 byte-for-byte, plus the photo on the problem row (only
--      when this answer opens the problem).
--   3. restates shops_admin_queue from 20261019071055 byte-for-byte, plus h.problem_photo_path in 'problems'. The 8
--      @mutate pins on 20261019071055 target other functions of that file and stay there.
-- No money moves. AUTHZ: lh-authz-rls. REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, constraint dropped and re-added,
-- CREATE OR REPLACE only, grants restated.

ALTER TABLE public.shop_handovers ADD COLUMN IF NOT EXISTS problem_photo_path text;
ALTER TABLE public.shop_handovers DROP CONSTRAINT IF EXISTS shop_handovers_problem_photo;
ALTER TABLE public.shop_handovers ADD CONSTRAINT shop_handovers_problem_photo
  CHECK (problem_photo_path IS NULL OR (problem_at IS NOT NULL AND char_length(problem_photo_path) <= 300));

CREATE OR REPLACE FUNCTION public.shop_helpr_answer_no_show(p_task_id uuid, p_note text, p_photo_path text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  o public.shop_orders;
  h public.shop_handovers;
  a record;
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid OR t.source_kind IS DISTINCT FROM 'shop_delivery' THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.seller_no_show_reported_at IS NULL OR t.seller_no_show_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'no_show_not_reported' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = t.source_id FOR UPDATE;
  -- The same answer sent again (a double tap) answers the same.
  IF t.seller_no_show_answered_at IS NOT NULL THEN
    SELECT * INTO h FROM public.shop_handovers WHERE order_id = o.id;
    IF h.problem_at IS NOT NULL AND h.problem_note = left(format('The Helpr answers the shop''s "didn''t come" report: %s', v_note), 500) THEN
      RETURN o.id;
    END IF;
    RAISE EXCEPTION 'already_answered' USING ERRCODE = '55000',
      HINT = 'You already answered. Louisiana Helpr looks at both sides and tells you what it decides.';
  END IF;
  IF now() >= t.seller_no_show_answer_by THEN
    RAISE EXCEPTION 'no_show_answer_late' USING ERRCODE = '55000', HINT = 'The 24 hours to answer are over.';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  -- As every Shops note (shops_report_not_received): no contact details.
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
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
  -- The hold: a handover problem on the order (an admin decides it), as the Helpr's own "the shop wasn't there".
  -- A problem already open keeps its own note; the answer is still recorded, so the Helpr gets no strike.
  -- NEW (20261107035259): the answer photo goes on the problem, so an admin sees it beside the note. Only when this
  -- answer opens the problem: a problem already open keeps its own note AND its own photo (never a Helpr's photo
  -- shown beside someone else's words).
  INSERT INTO public.shop_handovers (order_id, problem_at, problem_note, problem_photo_path, is_seed)
  VALUES (o.id, now(), left(format('The Helpr answers the shop''s "didn''t come" report: %s', v_note), 500), p_photo_path, o.is_seed)
  ON CONFLICT (order_id) DO UPDATE SET problem_at = COALESCE(public.shop_handovers.problem_at, EXCLUDED.problem_at),
                                       problem_note = COALESCE(public.shop_handovers.problem_note, EXCLUDED.problem_note),
                                       problem_photo_path = CASE WHEN public.shop_handovers.problem_at IS NULL
                                                                 THEN EXCLUDED.problem_photo_path
                                                                 ELSE public.shop_handovers.problem_photo_path END;
  UPDATE public.helpr_tasks SET seller_no_show_answered_at = now(), updated_at = now() WHERE id = t.id;
  PERFORM public.helpr_task_log(t.id, 'seller_no_show_answer', v_uid,
    left(v_note, 200) || CASE WHEN p_photo_path IS NULL THEN '' ELSE ' | photo ' || p_photo_path END);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'The Helpr answered your report',
    'About your order. Louisiana Helpr looks at both sides and tells you what it decides. The money stays held until then.',
    '/shops/dashboard', NULL);
  -- Owner rule: test data never reaches an admin.
  IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id) OR public.is_test_subject(v_uid)) THEN
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops pickup problem reported',
        'A shop reported that the Helpr didn''t come, and the Helpr answered. The money is held until you decide it.', '/admin');
    END LOOP;
  END IF;
  RETURN o.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_helpr_answer_no_show(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_helpr_answer_no_show(uuid, text, text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.shops_admin_queue()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'problems', (SELECT COALESCE(jsonb_agg(x ORDER BY x.problem_at), '[]'::jsonb) FROM (
      SELECT o.id AS order_id, o.buyer_id, o.seller_id, o.shop_id, s.name AS shop_name, o.ready_date, o.items_cents,
             o.total_cents, o.card_fee_cents, o.tax_cents, o.handover_mode, h.problem_at, h.problem_note,
             h.ready_photo_path, h.ready_at, h.problem_photo_path, o.is_seed
        FROM public.shop_orders o
        JOIN public.shop_handovers h ON h.order_id = o.id
        LEFT JOIN public.shops s ON s.id = o.shop_id
       WHERE o.status = 'accepted' AND h.problem_at IS NOT NULL) x),
    'refunds', (SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at), '[]'::jsonb) FROM (
      SELECT r.id AS refund_id, r.order_id, r.reason, r.fee_policy, r.refund_cents, r.status, r.attempts, r.last_error,
             r.created_at, r.next_attempt_at, o.is_seed
        FROM public.shop_refunds r JOIN public.shop_orders o ON o.id = r.order_id
       WHERE r.status <> 'succeeded') x),
    'payouts', (SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at), '[]'::jsonb) FROM (
      SELECT p.id AS payout_id, p.order_id, o.seller_id, s.name AS shop_name, p.amount_cents, p.status, p.attempts,
             p.last_error, p.review_reason, p.created_at, (ph.helper_id IS NOT NULL) AS on_hold, ph.reason AS hold_reason, o.is_seed
        FROM public.shop_payouts p
        JOIN public.shop_orders o ON o.id = p.order_id
        LEFT JOIN public.shops s ON s.id = o.shop_id
        LEFT JOIN public.payout_holds ph ON ph.helper_id = o.seller_id
       -- held_for_review too (/code-review of shops-m3-v1 #6): a payout no cron will send is exactly one an admin must see.
       WHERE p.status IN ('pending', 'failed', 'held_for_review')) x),
    'facilitator', jsonb_build_object(
      'year', extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::integer,
      'ytd_cents', public.facilitated_la_sales_cents(extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::integer),
      'warn_cents', 8000000, 'duty_cents', 10000000),
    'strikes', (SELECT COALESCE(jsonb_agg(x ORDER BY x.given_at DESC), '[]'::jsonb) FROM (
      SELECT k.id AS strike_id, k.user_id, k.offender_side, k.reason, k.order_id, k.given_at, k.expires_at,
             public.shop_active_strike_count(k.user_id) AS active_count, k.is_seed
        FROM public.shop_strikes k
       WHERE k.removed_at IS NULL AND k.expires_at > now()
       ORDER BY k.given_at DESC LIMIT 200) x));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_queue() TO authenticated, service_role;
