-- soldstates-5 (night audit, sold states #5; owner 10-31 morning): on a Helpr delivery the seller can report "The Helpr
-- didn't come". The buyer's money stays held, the Helpr is told at once and has 24 hours to answer with proof; no answer
-- is a strike (the seller no-show rule of 20261031004529, mirrored).
--
-- NEW:
--   helpr_tasks.seller_no_show_reported_at / _answer_by / _answered_at / _settled_at   the report's clock.
--   declutter_report_helpr_no_show(p_order_id)    the seller's report: a Helpr delivery, the Helpr booked and not yet
--                                                 marked "Picked up", 15 minutes past the pickup time (the seller
--                                                 no-show rule's 15). Tells the Helpr and the buyer at once.
--   declutter_helpr_answer_no_show(p_task_id, p_note, p_photo_path)  the Helpr's answer within 24 hours: their words and,
--                                                 if they have one, a photo from their task folder. It becomes the Helpr's
--                                                 problem on the order (reporter_side 'helpr', the shape of their own "The
--                                                 seller wasn't there", so the admin can't "Pay the seller" on it), the
--                                                 seller's report as the other side; the money stays held and no one gets a strike until it is decided.
--   helpr_task_no_show_report(p_task_id)          the Helpr's and the seller's read of the report's clock.
-- RESTATED (only the marked parts change):
--   helpr_task_source_held   newest 20261017055505: also held while a seller's report waits for the Helpr's answer, so
--                            nothing confirms, pays out, reopens or strikes the task under it (every sweep branch and
--                            helpr_task_confirm / helpr_task_payouts_due ask this one function).
--   helpr_task_reopen        newest 20261017055505: a task back up for another Helpr drops the old Helpr's report.
--   helpr_task_sweep         newest 20261031014011: one new loop first. 24 hours with no answer: the Helpr gets a
--                            delivery_no_show strike (helpr_task_give_job_strike, one per task), and a task still booked
--                            goes back up for another Helpr (helpr_task_reopen, which tells the buyer and the seller).
--                            The buyer's money is not refunded: the delivery goes on.
-- Checked for newer restatements: origin/main, land/l48-next-c82c8844, wip/b82-wanted-hub (none).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE; grants restated by role name.
-- Proof: src/test/pglite/helprDeliverySellerReportsNoShow.pglite.mjs (3x; NEW_MIGRATION=skip is red).

ALTER TABLE public.helpr_tasks
  ADD COLUMN IF NOT EXISTS seller_no_show_reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS seller_no_show_answer_by timestamptz,
  ADD COLUMN IF NOT EXISTS seller_no_show_answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS seller_no_show_settled_at timestamptz;
-- The event CHECK, restated from its newest definition (20261031095846_helpr_task_seller_move_pickup.sql), with the
-- report's two events added.
ALTER TABLE public.helpr_task_events DROP CONSTRAINT IF EXISTS helpr_task_events_task_event_check;
ALTER TABLE public.helpr_task_events ADD CONSTRAINT helpr_task_events_task_event_check CHECK (task_event IN (
  'created', 'accepted', 'released', 'helpr_no_show', 'picked_up', 'delivered', 'wrong_code', 'confirmed',
  'unfilled', 'cancelled', 'failed', 'pickup_no_show', 'handed_over', 'pickup_moved',
  'seller_no_show_report', 'seller_no_show_answer'));

COMMENT ON COLUMN public.helpr_tasks.seller_no_show_answer_by IS
  'soldstates-5: the seller said the Helpr did not come; the Helpr answers by then or gets a strike (helpr_task_sweep).';

CREATE OR REPLACE FUNCTION public.declutter_report_helpr_no_show(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  t public.helpr_tasks;
  v_side text;
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
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  IF o.status <> 'paid' OR o.handover IS DISTINCT FROM 'delivery' THEN
    RAISE EXCEPTION 'not_a_helpr_delivery' USING ERRCODE = '55000';
  END IF;
  SELECT tk.* INTO t FROM public.declutter_order_deliveries od JOIN public.helpr_tasks tk ON tk.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF tk;
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'not_a_helpr_delivery' USING ERRCODE = '55000';
  END IF;
  -- A second tap answers the same.
  IF t.seller_no_show_reported_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'helpr_told', 'answer_by', t.seller_no_show_answer_by);
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF t.status <> 'accepted' OR t.helpr_id IS NULL OR t.pickup_slot_start IS NULL THEN
    RAISE EXCEPTION 'no_helpr_booked' USING ERRCODE = '55000',
      HINT = 'No Helpr is booked for this pickup now.';
  END IF;
  -- Review #6: the seller already tapped "Handed over" to this Helpr, so the Helpr came.
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
  PERFORM public.helpr_task_log(t.id, 'seller_no_show_report', v_uid, 'the seller says the Helpr did not come');
  PERFORM public.declutter_notify(t.helpr_id, 'declutter_pickups', 'The seller says you didn''t come',
    format('About "%s". Answer within 24 hours in Deliver, with a photo if you have one. If you don''t, you get a strike and the delivery goes to another Helpr.',
           t.title),
    '/declutter?tab=deliver', o.seller_id);
  PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'The seller says the Helpr didn''t come',
    format('About %s. Your money stays held while the Helpr answers. We''ll tell you what happens next.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=buying', NULL);
  RETURN jsonb_build_object('result', 'helpr_told', 'answer_by', t.seller_no_show_answer_by);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_report_helpr_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_report_helpr_no_show(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_helpr_answer_no_show(p_task_id uuid, p_note text, p_photo_path text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  o public.declutter_orders;
  v_open public.declutter_problems;
  v_id uuid;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid OR t.source_kind IS DISTINCT FROM 'declutter_delivery' THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.seller_no_show_reported_at IS NULL OR t.seller_no_show_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'no_show_not_reported' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  -- The same answer sent again (a double tap) answers the same.
  IF t.seller_no_show_answered_at IS NOT NULL THEN
    SELECT p.* INTO v_open FROM public.declutter_problems p
     WHERE p.order_id = o.id AND p.status = 'open' AND p.reporter_id = v_uid AND p.note = btrim(p_note);
    IF FOUND THEN
      RETURN v_open.id;
    END IF;
    RAISE EXCEPTION 'already_answered' USING ERRCODE = '55000',
      HINT = 'You already answered. Louisiana Helpr looks at both sides and tells you what it decides.';
  END IF;
  IF now() >= t.seller_no_show_answer_by THEN
    RAISE EXCEPTION 'no_show_answer_late' USING ERRCODE = '55000', HINT = 'The 24 hours to answer are over.';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
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
  -- Review #4: a problem already open on the sale (opened after the report) has the money; the answer is still
  -- recorded, so the Helpr who answered in time gets no strike for it, and the admin is told below.
  SELECT p.* INTO v_open FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open';
  IF FOUND THEN
    v_id := v_open.id;
  ELSE
    -- Review #1: the problem is the HELPR's word that the seller wasn't there, the same shape as the Helpr's own
    -- "The seller wasn't there" (declutter_delivery_on_task_event 'pickup_no_show': reporter_side 'helpr'), so the
    -- admin's "Pay the seller" is refused for it (declutter_admin_decide_problem, B77: the item never left the seller).
    -- The seller's report is the other side.
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths,
                                           other_side_note, other_side_photo_paths, other_side_at, is_seed)
    VALUES (o.id, v_uid, 'helpr', 'no_show', btrim(p_note),
            CASE WHEN p_photo_path IS NULL THEN '{}'::text[] ELSE ARRAY[p_photo_path] END,
            format('The seller says the Helpr didn''t come for the pickup at %s.',
                   to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD FMHH12:MI AM')),
            '{}', t.seller_no_show_reported_at, o.is_seed)
    RETURNING id INTO v_id;
  END IF;
  UPDATE public.helpr_tasks SET seller_no_show_answered_at = now(), updated_at = now() WHERE id = t.id;
  PERFORM public.helpr_task_log(t.id, 'seller_no_show_answer', v_uid, left(btrim(p_note), 200));
  PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'The Helpr answered your report',
    format('About %s. Louisiana Helpr looks at both sides and tells you what it decides. The money stays held until then.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=selling', NULL);
  -- Owner rule: test data never reaches an admin.
  IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id) OR public.is_test_subject(v_uid)) THEN
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
        'A seller reported that the Helpr didn''t come, and the Helpr answered. The money is held until you decide it.', '/admin');
    END LOOP;
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_helpr_answer_no_show(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_helpr_answer_no_show(uuid, text, text) TO authenticated, service_role;

-- The report's clock, for the Helpr and the seller only (nothing for anyone else).
CREATE OR REPLACE FUNCTION public.helpr_task_no_show_report(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  IF v_uid IS NULL OR t.id IS NULL OR t.seller_no_show_reported_at IS NULL
     OR NOT (t.helpr_id = v_uid OR EXISTS (SELECT 1 FROM public.declutter_orders o
                                            WHERE o.id = t.source_id AND t.source_kind = 'declutter_delivery' AND o.seller_id = v_uid)) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('reported_at', t.seller_no_show_reported_at, 'answer_by', t.seller_no_show_answer_by,
                            'answered_at', t.seller_no_show_answered_at, 'settled_at', t.seller_no_show_settled_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_no_show_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_no_show_report(uuid) TO authenticated, service_role;

-- Restated from 20261017055505; only the marked lines change.
CREATE OR REPLACE FUNCTION public.helpr_task_source_held(p_kind text, p_source uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- Unknown or NULL = held: this is a deny predicate (lh-authz-rls #11).
  IF p_kind IS NULL OR p_source IS NULL THEN
    RETURN true;
  END IF;
  IF p_kind = 'declutter_delivery' THEN
    RETURN EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = p_source AND p.status = 'open')
      -- CHANGED (soldstates-5): a seller's "The Helpr didn't come" waiting for the Helpr's answer holds it too.
      OR EXISTS (SELECT 1 FROM public.helpr_tasks x
                  WHERE x.source_kind = 'declutter_delivery' AND x.source_id = p_source
                    AND x.seller_no_show_reported_at IS NOT NULL AND x.seller_no_show_answered_at IS NULL
                    AND x.seller_no_show_settled_at IS NULL);
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_source_held(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_source_held(text, uuid) TO service_role;

-- Restated from 20261017055505; only the marked lines change. Review #3: a task back up for another Helpr starts
-- with no seller report (the old one was about the old Helpr; its strike, if any, is already recorded).
CREATE OR REPLACE FUNCTION public.helpr_task_reopen(p_task uuid, p_kind text, p_actor uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  UPDATE public.helpr_tasks
     SET status = 'open', helpr_id = NULL, accepted_at = NULL, pickup_slot_start = NULL, releases = least(releases + 1, 100),
         open_until = least(greatest(open_until, now() + interval '24 hours'), latest_pickup_at - interval '2 hours'),
         wrong_codes = 0, updated_at = now(),
         -- CHANGED (soldstates-5): the seller's report on the old Helpr goes with them.
         seller_no_show_reported_at = NULL, seller_no_show_answer_by = NULL, seller_no_show_answered_at = NULL,
         seller_no_show_settled_at = NULL
   WHERE id = t.id AND status = 'accepted';
  IF NOT FOUND THEN
    -- Every caller checked 'accepted' under the lock; a miss is a bug, never a silent notice (lh-silent-failure #9).
    RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
  END IF;
  PERFORM public.helpr_task_log(t.id, p_kind, p_actor, p_note);
  PERFORM public.helpr_task_source_event(t.id, 'released', p_kind);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_reopen(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_reopen(uuid, text, uuid, text) TO service_role;

-- Restated from 20261031014011 (BUY-37); only the marked loop is new.
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
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = t.source_id AND p.status = 'open') THEN
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
  RETURN jsonb_build_object('unfilled', v_unfilled, 'helpr_no_show', v_noshow, 'auto_confirmed', v_auto,
                            'still_in_hand_nudged', v_in_hand, 'seller_report_unanswered', v_no_answer);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_sweep() TO service_role;
