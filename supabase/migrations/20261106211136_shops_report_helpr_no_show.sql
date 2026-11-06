-- Shops Helpr delivery: the shop reports "the Helpr didn't come" (Builder 5, 11-06; follows 20261106203016, stacked
-- on ready/b5-shops-helpr-delivery). A Declutter seller has declutter_report_helpr_no_show; a shop had nothing, so a
-- Helpr who booked a shop pickup and never came kept the delivery (and the buyer's delivery money) until the task's
-- own clock ran out, and the shop could not say so. This adds Declutter's flow for a shop task, with Declutter's rules:
--   shop_report_helpr_no_show(order): the shop owner, 15 minutes after the booked pickup time, while a Helpr is booked
--     and the shop has not tapped "Handed over" to that Helpr, and no handover problem is open. It sets the task's
--     seller_no_show_reported_at / answer_by (24 hours), exactly the columns Declutter's report sets, so:
--       - the money is held while the Helpr answers (helpr_task_source_held already reads these for a shop task);
--       - no answer in 24 hours: helpr_task_sweep gives the Helpr a strike and puts the task back up (unchanged,
--         kind-blind; helpr_task_reopen clears the report);
--       - the shop reads its report through helpr_task_no_show_report (20261106203016).
--   shop_helpr_answer_no_show(task, note, photo): the Helpr's answer for a shop task (declutter_helpr_answer_no_show
--     refuses any other kind). It opens a handover problem on the order (shop_handovers.problem_at), the same hold
--     the Helpr's own "the shop wasn't there" writes (shop_delivery_on_task_event 'pickup_no_show'), so the shop's
--     payout and the Helpr's wait for an admin; the shop and every admin are told (test data never reaches an admin).
--     The answer photo is checked as Declutter's (the Helpr's own task folder) and kept on the task's event log.
-- No money moves here: both functions only set the hold that the payout reads (shop_payouts_due / payouts_due skip a
-- held order). Second taps answer the same. Shops switch on every RPC. MONEY + AUTHZ: lh-money-escrow, lh-authz-rls.
-- REPLAY-SAFE: CREATE OR REPLACE only, grants restated.

CREATE OR REPLACE FUNCTION public.shop_report_helpr_no_show(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  t public.helpr_tasks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL OR o.fulfillment IS DISTINCT FROM 'helpr_delivers'
     OR o.helpr_unfilled_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_helpr_delivery' USING ERRCODE = '55000';
  END IF;
  SELECT x.* INTO t FROM public.helpr_tasks x
   WHERE x.source_kind = 'shop_delivery' AND x.source_id = o.id FOR UPDATE;
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'not_a_helpr_delivery' USING ERRCODE = '55000';
  END IF;
  -- A second tap answers the same.
  IF t.seller_no_show_reported_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'helpr_told', 'answer_by', t.seller_no_show_answer_by);
  END IF;
  IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF t.status <> 'accepted' OR t.helpr_id IS NULL OR t.pickup_slot_start IS NULL THEN
    RAISE EXCEPTION 'no_helpr_booked' USING ERRCODE = '55000',
      HINT = 'No Helpr is booked for this pickup now.';
  END IF;
  -- The shop already tapped "Handed over" to this Helpr, so the Helpr came.
  IF t.handed_over_at IS NOT NULL AND t.handed_over_to IS NOT DISTINCT FROM t.helpr_id THEN
    RAISE EXCEPTION 'already_handed_over' USING ERRCODE = '55000',
      HINT = 'You said you handed it over to this Helpr. If something is wrong, report a problem.';
  END IF;
  IF now() < t.pickup_slot_start + interval '15 minutes' THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000', HINT = 'Wait 15 minutes after the pickup time.';
  END IF;
  UPDATE public.helpr_tasks
     SET seller_no_show_reported_at = now(), seller_no_show_answer_by = now() + interval '24 hours', updated_at = now()
   WHERE id = t.id
  RETURNING * INTO t;
  PERFORM public.helpr_task_log(t.id, 'seller_no_show_report', v_uid, 'the shop says the Helpr did not come');
  PERFORM public.declutter_notify(t.helpr_id, 'declutter_pickups', 'The shop says you didn''t come',
    format('About "%s". Answer within 24 hours in Deliver, with a photo if you have one. If you don''t, you get a strike and the delivery goes to another Helpr.',
           t.title),
    '/declutter?tab=deliver', o.seller_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The shop says the Helpr didn''t come',
    'About your order. Your money stays held while the Helpr answers. We''ll tell you what happens next.',
    '/shops/orders', NULL);
  RETURN jsonb_build_object('result', 'helpr_told', 'answer_by', t.seller_no_show_answer_by);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_report_helpr_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_report_helpr_no_show(uuid) TO authenticated, service_role;


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
  INSERT INTO public.shop_handovers (order_id, problem_at, problem_note, is_seed)
  VALUES (o.id, now(), left(format('The Helpr answers the shop''s "didn''t come" report: %s', v_note), 500), o.is_seed)
  ON CONFLICT (order_id) DO UPDATE SET problem_at = COALESCE(public.shop_handovers.problem_at, EXCLUDED.problem_at),
                                       problem_note = COALESCE(public.shop_handovers.problem_note, EXCLUDED.problem_note);
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
