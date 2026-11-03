-- Q2390 packet 34 (REGULAR packet: lead review): "not found" answers HTTP 404, not 500, for six functions that
-- still raised P0002, and one state refusal answers 400:
--   rentals_admin_review_landlord_id (admin): 'not_pending_review' (no review row, or one not pending) is a STATE
--        refusal and becomes '22023' (400), lead decision 11-03 (relayed in Builder 56's handoff; like p31's
--        no_visit_proposed). 'profile_not_found' becomes PT404; it fires after the review UPDATE, which the raise rolls
--        back. adminRpcErrorCopy.ts maps by message.
--   declutter_report_helpr_no_show (seller; raises at the item read, before any write. lifecycleErrors.ts maps by message.)
--   declutter_answer_delivery_time, declutter_propose_delivery_time, declutter_seller_delivered (seller delivery; each
--        raises at the item read, before any write. sellerDeliveryErrors.ts maps by message.)
--   declutter_open_handover_talk (both raises: no agreed sale between the two people, before any write. lifecycleErrors.ts
--        maps by message.)
-- No edge map changes, no deploy. PostgREST maps P0002 to 500; RAISE ... USING ERRCODE = 'PT404' answers 404.
--
-- Each is restated VERBATIM from its newest migration copy, whose md5(prosrc) equals prod (read 2026-11-03 by
-- Builder 72; 1 overload each; grants as prod: authenticated, service_role). The ONLY change in each body: ERRCODE
-- 'P0002' -> 'PT404', and rentals_admin_review_landlord_id's 'not_pending_review' -> '22023'.
--   rentals_admin_review_landlord_id   20261019051407 3af2d755f4408de22e98c4fcafc76c16
--   declutter_report_helpr_no_show     20261031134217 8b5d3cca3c14ab48ea5b08dd512d341c
--   declutter_answer_delivery_time     20261027153244 a856e17a2917ef515de60d3e795e9159
--   declutter_propose_delivery_time    20261027153244 9d9e9212c9987c56c91a781d1f987abb
--   declutter_open_handover_talk       20261028235249 958e57d1ff8f55818d5dff1e0bc2dc08
--   declutter_seller_delivered         20261029002010 1eea049ec53c98531125b7f19c2f6668

-- rentals_admin_review_landlord_id: restated from 20261019051407_rentals_landlord_id_review.sql.
CREATE OR REPLACE FUNCTION public.rentals_admin_review_landlord_id(p_user_id uuid, p_approve boolean, p_note text, p_submitted_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_submitted timestamptz;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'decision_required' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND char_length(btrim(coalesce(p_note, ''))) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  -- An admin never approves their own ID.
  IF p_user_id IS NULL OR p_user_id = v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT status, submitted_at INTO v_status, v_submitted FROM public.landlord_id_reviews WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'pending_review' THEN
    RAISE EXCEPTION 'not_pending_review' USING ERRCODE = '22023';
  END IF;
  -- The decision is about the photos the admin opened: a new photo sent since
  -- (submitted_at moved) is refused, so the admin looks again (authz review #1).
  IF p_submitted_at IS NULL OR v_submitted IS DISTINCT FROM p_submitted_at THEN
    RAISE EXCEPTION 'review_changed' USING ERRCODE = '40001';
  END IF;

  UPDATE public.landlord_id_reviews
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = v_uid, reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   WHERE user_id = p_user_id;

  IF p_approve THEN
    -- THE verdict every gate reads (identity_is_verified), written exactly as
    -- admin-user-actions manual_verify writes it. An admin caller passes
    -- prevent_self_escalation. Stripe's own columns are never touched.
    UPDATE public.profiles
       SET idv_status = 'verified', idv_confidence = 100, idv_failure_reason = NULL, legacy_manual_review = true
     WHERE user_id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'PT404';
    END IF;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'landlord_id_approved' ELSE 'landlord_id_rejected' END,
          'user', p_user_id::text, jsonb_build_object('note', p_note));

  PERFORM public.rentals_notify(p_user_id,
    CASE WHEN p_approve THEN 'ID approved' ELSE 'Send a new photo of your ID' END,
    CASE WHEN p_approve THEN 'Louisiana Helpr approved your ID. You are ID-verified everywhere in the app.'
         ELSE 'Louisiana Helpr could not accept your ID photo: ' || btrim(p_note) END,
    '/rentals', false, true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_admin_review_landlord_id(uuid, boolean, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_review_landlord_id(uuid, boolean, text, timestamptz) TO authenticated, service_role;

-- declutter_report_helpr_no_show: restated from 20261031134217_helpr_delivery_seller_reports_no_show.sql.
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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

-- declutter_answer_delivery_time: restated from 20261027153244_declutter_seller_delivery.sql.
CREATE OR REPLACE FUNCTION public.declutter_answer_delivery_time(p_order_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rules jsonb := public.declutter_seller_delivery_rules();
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
  v_side text;
  v_other uuid;
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
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.proposed_start IS NULL OR p_accept IS NULL THEN
    RAISE EXCEPTION 'no_proposal' USING ERRCODE = '55000';
  END IF;
  v_other := CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END;
  IF p_accept AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_accept AND d.proposed_by = v_side THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501', HINT = 'The other side accepts the time you asked for.';
  END IF;
  IF NOT p_accept THEN
    UPDATE public.declutter_seller_deliveries SET proposed_start = NULL, proposed_by = NULL, proposed_at = NULL, updated_at = now()
     WHERE order_id = o.id;
    IF d.proposed_by <> v_side THEN
      PERFORM public.declutter_notify(v_other, 'payment', 'Delivery time kept',
        format('The new time was turned down. The delivery stays %s.', COALESCE(public.declutter_delivery_when(d.slot_start), 'to be picked')),
        '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END, v_uid);
    END IF;
    RETURN jsonb_build_object('result', 'kept');
  END IF;
  PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = o.seller_id FOR UPDATE;
  IF d.proposed_start <= now()
     OR public.declutter_delivery_slot_used(o.seller_id, d.proposed_start, o.id)
        >= (v_rules ->> 'per_slot')::integer THEN
    UPDATE public.declutter_seller_deliveries SET proposed_start = NULL, proposed_by = NULL, proposed_at = NULL, updated_at = now()
     WHERE order_id = o.id;
    RETURN jsonb_build_object('result', 'slot_taken');
  END IF;
  UPDATE public.declutter_seller_deliveries
     SET status = 'booked', slot_start = d.proposed_start,
         slot_end = d.proposed_start + make_interval(mins => (v_rules ->> 'slot_minutes')::integer),
         proposed_start = NULL, proposed_by = NULL, proposed_at = NULL, reminded_hours = '{}', updated_at = now()
   WHERE order_id = o.id;
  PERFORM public.declutter_notify(v_other, 'payment', 'Delivery time changed',
    format('The delivery is now %s.', public.declutter_delivery_when(d.proposed_start)),
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END, v_uid);
  RETURN jsonb_build_object('result', 'moved', 'slot_start', d.proposed_start);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_answer_delivery_time(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_delivery_time(uuid, boolean) TO authenticated, service_role;

-- declutter_propose_delivery_time: restated from 20261027153244_declutter_seller_delivery.sql.
CREATE OR REPLACE FUNCTION public.declutter_propose_delivery_time(p_order_id uuid, p_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rules jsonb := public.declutter_seller_delivery_rules();
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.status NOT IN ('booked', 'needs_time')
     OR EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_reschedulable' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = o.seller_id FOR UPDATE;
  IF p_slot_start IS NULL OR p_slot_start IS NOT DISTINCT FROM d.slot_start
     OR NOT EXISTS (SELECT 1 FROM public.declutter_delivery_open_slots(o.seller_id, o.id) s WHERE s = p_slot_start) THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = '22023',
      HINT = 'That delivery time is not open. Pick another time.';
  END IF;
  IF d.status = 'needs_time' AND v_side = 'buyer' THEN
    UPDATE public.declutter_seller_deliveries
       SET status = 'booked', slot_start = p_slot_start,
           slot_end = p_slot_start + make_interval(mins => (v_rules ->> 'slot_minutes')::integer),
           proposed_start = NULL, proposed_by = NULL, proposed_at = NULL, reminded_hours = '{}', updated_at = now()
     WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Delivery booked',
      format('Deliver to %s on %s. The address is on the sale.', d.dropoff_area, public.declutter_delivery_when(p_slot_start)),
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'booked', 'slot_start', p_slot_start);
  END IF;
  IF d.proposed_start = p_slot_start AND d.proposed_by = v_side THEN
    -- The same request again (a double tap): nothing new, no request used.
    RETURN jsonb_build_object('result', 'proposed', 'proposed_start', p_slot_start);
  END IF;
  IF (CASE WHEN v_side = 'buyer' THEN d.buyer_proposals ELSE d.seller_proposals END)
     >= (v_rules ->> 'proposals_per_side')::integer THEN
    RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You can''t ask for another new time on this order.';
  END IF;
  UPDATE public.declutter_seller_deliveries
     SET proposed_start = p_slot_start, proposed_by = v_side, proposed_at = now(),
         buyer_proposals = buyer_proposals + CASE WHEN v_side = 'buyer' THEN 1 ELSE 0 END,
         seller_proposals = seller_proposals + CASE WHEN v_side = 'seller' THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE order_id = o.id;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'payment',
    'New delivery time asked',
    format('The %s asked to move the delivery to %s. Accept or keep the current time.',
           v_side, public.declutter_delivery_when(p_slot_start)),
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END, v_uid);
  RETURN jsonb_build_object('result', 'proposed', 'proposed_start', p_slot_start);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_propose_delivery_time(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_propose_delivery_time(uuid, timestamptz) TO authenticated, service_role;

-- declutter_open_handover_talk: restated from 20261028235249_declutter_handover_talk.sql.
CREATE OR REPLACE FUNCTION public.declutter_open_handover_talk(p_other uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_buyer uuid;
  v_seller uuid;
  v_talk public.declutter_handover_talks%ROWTYPE;
  v_title text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_other IS NULL OR p_other = v_uid THEN
    RAISE EXCEPTION 'no_agreed_sale' USING ERRCODE = 'PT404';
  END IF;
  -- Which side the caller is on: there must be an agreed sale (a line in the buyer's cart) between them.
  IF EXISTS (SELECT 1 FROM public.declutter_cart_items c
              WHERE c.buyer_id = v_uid AND c.seller_id = p_other AND c.status = 'in_cart') THEN
    v_buyer := v_uid; v_seller := p_other;
  ELSIF EXISTS (SELECT 1 FROM public.declutter_cart_items c
                 WHERE c.buyer_id = p_other AND c.seller_id = v_uid AND c.status = 'in_cart') THEN
    v_buyer := p_other; v_seller := v_uid;
  ELSE
    RAISE EXCEPTION 'no_agreed_sale' USING ERRCODE = 'PT404';
  END IF;
  IF public.are_users_blocked(v_buyer, v_seller) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  -- One per pair at a time, serialised so two taps open one talk.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_talk:' || v_buyer::text || ':' || v_seller::text));
  SELECT * INTO v_talk FROM public.declutter_handover_talks t
   WHERE t.buyer_id = v_buyer AND t.seller_id = v_seller AND t.closed_at IS NULL AND t.expires_at > now();
  IF FOUND THEN
    RETURN v_talk.id;
  END IF;
  -- Only when no way that always works is shared (otherwise the buyer can check out with it).
  IF NOT public.declutter_pair_needs_talk(v_buyer, v_seller) THEN
    RAISE EXCEPTION 'handover_way_open' USING ERRCODE = '22023',
      HINT = 'Porch pickup works for these items. Choose it at checkout.';
  END IF;
  -- One talk a week per pair, so the strike wait cannot be stretched by reopening.
  IF EXISTS (SELECT 1 FROM public.declutter_handover_talks t
              WHERE t.buyer_id = v_buyer AND t.seller_id = v_seller AND t.opened_at > now() - interval '7 days') THEN
    RAISE EXCEPTION 'talk_recently_closed' USING ERRCODE = '22023',
      HINT = 'You already talked about this sale this week.';
  END IF;
  UPDATE public.declutter_handover_talks SET closed_at = now()
   WHERE buyer_id = v_buyer AND seller_id = v_seller AND closed_at IS NULL;
  INSERT INTO public.declutter_handover_talks (buyer_id, seller_id, opened_by, expires_at)
  VALUES (v_buyer, v_seller, v_uid, now() + interval '72 hours')
  RETURNING * INTO v_talk;
  -- The strike waits: the buyer's checkout time for these lines runs to the end of the talk (never earlier).
  UPDATE public.declutter_cart_items c
     SET checkout_by = GREATEST(c.checkout_by, v_talk.expires_at), reminded_24h_at = NULL, reminded_2h_at = NULL
   WHERE c.buyer_id = v_buyer AND c.seller_id = v_seller AND c.status = 'in_cart' AND c.checkout_by > now();
  SELECT i.title INTO v_title
    FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.buyer_id = v_buyer AND c.seller_id = v_seller AND c.status = 'in_cart'
   ORDER BY c.created_at LIMIT 1;
  PERFORM public.declutter_notify(CASE WHEN v_uid = v_buyer THEN v_seller ELSE v_buyer END, 'declutter_sales',
    'Let''s agree the handover',
    format('%s wants to agree how "%s" gets handed over. Open the chat to sort it out.',
           CASE WHEN v_uid = v_buyer THEN 'The buyer' ELSE 'The seller' END, v_title),
    -- The recipient's own tab, with the chat open on it (DeclutterPage reads ?talk=).
    CASE WHEN v_uid = v_buyer THEN '/declutter?tab=selling&talk=' ELSE '/declutter?tab=buying&talk=' END || v_talk.id::text, v_uid);
  RETURN v_talk.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_open_handover_talk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_open_handover_talk(uuid) TO authenticated, service_role;

-- declutter_seller_delivered: restated from 20261029002010_declutter_handover_photos_live_only.sql.
CREATE OR REPLACE FUNCTION public.declutter_seller_delivered(p_order_id uuid, p_photo_path text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
  v_side text;
  v_m integer;
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
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.status IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  IF now() < d.slot_start THEN
    RAISE EXCEPTION 'before_delivery_time' USING ERRCODE = '55000',
      HINT = 'You can mark it delivered from the booked delivery time.';
  END IF;
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RETURN jsonb_build_object('result', 'delivered');
  END IF;
  IF (p_photo_path IS NULL AND d.handoff = 'leave') OR (p_photo_path IS NOT NULL AND (
        split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path))) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- A photo is taken at the buyer's drop-off point (20261028235709), as a Helpr's drop-off photo is.
  IF p_photo_path IS NOT NULL THEN
    -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
    IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
      RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
        HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
    END IF;
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    v_m := public.helpr_task_distance_m(p_lat, p_lng, d.dropoff_lat, d.dropoff_lng);
    IF v_m IS NULL OR v_m > 200 THEN
      RAISE EXCEPTION 'not_at_dropoff' USING ERRCODE = '22023', HINT = 'Take the photo at the buyer''s address.';
    END IF;
  END IF;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  IF p_photo_path IS NOT NULL THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now(), set_out_distance_m = v_m
     WHERE order_id = o.id AND confirmed_at IS NULL;
  END IF;
  UPDATE public.declutter_seller_deliveries SET delivered_at = now(), proposed_start = NULL, proposed_by = NULL, proposed_at = NULL,
         updated_at = now()
   WHERE order_id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your items were delivered',
    CASE WHEN d.handoff = 'hand' THEN 'The seller says they handed you your items. Tap "I got it". If something is wrong, report a problem within 24 hours; after that the seller is paid.'
         ELSE 'The seller left your items at your door and took a photo. Tap "I got it" when you have them. If something is wrong, report a problem within 24 hours; after that the seller is paid.' END,
    '/declutter?view=cart', o.seller_id);
  RETURN jsonb_build_object('result', 'delivered');
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_seller_delivered(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivered(uuid, text, numeric, numeric) TO authenticated, service_role;
