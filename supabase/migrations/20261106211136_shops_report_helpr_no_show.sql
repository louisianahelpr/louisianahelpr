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
--   helpr_task_sweep: RESTATED byte-for-byte from 20261031231150_helpr_delivery_cant_finish.sql with ONE added line in
--     the no-answer step: it also steps aside (no strike, no reopen) while a SHOP handover problem is open on the
--     order (shop_handovers.problem_at), as it already does for an open declutter_problems row. A buyer's "I didn't
--     get it" (shops_report_not_received) or the 60-day held_admin problem can open while the report waits; the
--     order is then frozen for an admin, so the Helpr must not be struck and the task must not go to another Helpr
--     (lh-money-escrow BLOCK on 858bb092bf).
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
          format('"%s" goes back to the seller and the sale is cancelled. You get back what you paid, less what the delivery cost, which pays the Helpr for the trip, and less the small part the card network kept for the payment, which it doesn''t give back.', t.title),
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
        PERFORM public.declutter_notify(t.customer_id, 'declutter_pickups', 'Louisiana Helpr is looking at this delivery',
          format('About "%s". The money stays held until it decides.', t.title), '/declutter?tab=buying', t.helpr_id);
        PERFORM public.declutter_notify(t.pickup_contact_id, 'declutter_sales', 'Louisiana Helpr is looking at this delivery',
          format('About "%s". The money stays held until it decides.', t.title), '/declutter?tab=selling', t.helpr_id);
        PERFORM public.declutter_notify(t.helpr_id, 'warning', 'Louisiana Helpr is looking at this delivery',
          format('About "%s". It decides what happens next.', t.title), '/declutter?tab=deliver', NULL);
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
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_sweep() TO service_role;
