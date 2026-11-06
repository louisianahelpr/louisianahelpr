-- Shops Helpr delivery, the Helpr's and the shop's reads (Builder 5, 11-06; follows 20261106194913, stacked on
-- ready/b5-shops-helpr-delivery). The task flow is Declutter's, but these functions answered only for a Declutter
-- task, so a Helpr who took a shop delivery got no pickup times, no chat, and the shop and the admin saw less:
--   helpr_task_pickup_windows / helpr_task_same_pickup_slot: a shop task (only for a Helpr the shops switch is on
--     for, as helpr_tasks_open_near) offers 8 AM to 8 PM every day up to its latest pickup; its latest pickup is
--     its own (no Declutter 7-day deadline). shop_delivery_slot_ok still refuses a slot before the ready date.
--   helpr_task_send_message / helpr_task_talk_view: the three-way delivery chat for a shop task (Helpr, buyer, the
--     shop); the shops switch is checked; notices link to Shops pages and call the seller side "the shop".
--   helpr_task_no_show_report: the shop reads its own order's "the Helpr didn't come" report, as a Declutter seller.
--   helpr_task_seller_move_pickup: the shop order's buyer is told of a moved pickup too.
--   admin_payouts_held_for_review: a shop task's held Helpr payout names its real transfer group, shop_order_<id>;
--     admin_payout_settle_by_hand is restated VERBATIM beside it (declutterManagerPayoutKind keeps the two in one
--     file, so no replay order drops either's hunks).
-- Unknown kinds keep their deny answer. AUTHZ: yes (lh-authz-rls). MONEY: admin view only (no amount changes).
-- REPLAY-SAFE: CREATE OR REPLACE only, grants restated.


-- RESTATED from 20261103061500_homes_declutter_helpr_reads_not_found_is_404.sql (a shop task's pickup times).
CREATE OR REPLACE FUNCTION public.helpr_task_pickup_windows(p_task_id uuid)
RETURNS TABLE(weekday smallint, starts time, ends time, latest_pickup_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  t public.helpr_tasks;
  o public.declutter_orders;
  v_hours jsonb;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  -- helpr_tasks_open_near's own filter, for this one task.
  SELECT * INTO t FROM public.helpr_tasks x
   WHERE x.id = p_task_id AND x.source_kind IN ('declutter_delivery', 'shop_delivery')
     AND (x.source_kind <> 'shop_delivery' OR public.feature_enabled_for_user('shops', v_uid))
     AND x.status = 'open' AND x.open_until > now()
     AND v_uid IS DISTINCT FROM x.customer_id AND v_uid IS DISTINCT FROM x.pickup_contact_id
     AND public.helpr_task_vehicle_fits(v_uid, x.size)
     AND NOT public.are_users_blocked(v_uid, x.customer_id)
     AND NOT public.are_users_blocked(v_uid, x.pickup_contact_id)
     AND public.helpr_task_same_stripe_mode(v_uid, x.customer_id)
     -- BUY-41 (new): as helpr_tasks_open_near.
     AND NOT EXISTS (SELECT 1 FROM public.helpr_task_events e
                      WHERE e.task_id = x.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show'))
     AND NOT public.helpr_task_source_held(x.source_kind, x.source_id);
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- A shop order (20261106203016): the shop hands over any day from 8 AM to 8 PM up to the task's latest pickup;
  -- shop_delivery_slot_ok keeps it on or after the ready date.
  IF t.source_kind = 'shop_delivery' THEN
    RETURN QUERY SELECT d::smallint, time '08:00', time '20:00', t.latest_pickup_at FROM generate_series(0, 6) d;
    RETURN;
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- LEAD-PLACE-TIMES: the hours frozen on the order at the place the buyer picked, else the usual times.
  SELECT hp.windows INTO v_hours FROM public.declutter_order_porch_places hp WHERE hp.order_id = o.id;
  IF v_hours IS NOT NULL THEN
    RETURN QUERY
      SELECT (e ->> 'weekday')::smallint, (e ->> 'starts')::time, (e ->> 'ends')::time,
             LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')
        FROM jsonb_array_elements(v_hours) e
       ORDER BY 1, 2;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT w.weekday, w.starts_local, w.ends_local, LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')
      FROM public.declutter_pickup_windows w
     WHERE w.seller_id = o.seller_id
     ORDER BY w.weekday, w.starts_local;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_pickup_windows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_pickup_windows(uuid) TO authenticated, service_role;


-- RESTATED from 20261103061500_homes_declutter_helpr_reads_not_found_is_404.sql (a shop task's latest pickup is its own).
CREATE OR REPLACE FUNCTION public.helpr_task_same_pickup_slot(p_task_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  t public.helpr_tasks;
  o public.declutter_orders;
  v_slot timestamptz;
  v_latest timestamptz;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  -- helpr_task_pickup_windows' own filter, for this one task.
  SELECT * INTO t FROM public.helpr_tasks x
   WHERE x.id = p_task_id AND x.source_kind IN ('declutter_delivery', 'shop_delivery')
     AND (x.source_kind <> 'shop_delivery' OR public.feature_enabled_for_user('shops', v_uid))
     AND x.status = 'open' AND x.open_until > now()
     AND v_uid IS DISTINCT FROM x.customer_id AND v_uid IS DISTINCT FROM x.pickup_contact_id
     AND public.helpr_task_vehicle_fits(v_uid, x.size)
     AND NOT public.are_users_blocked(v_uid, x.customer_id)
     AND NOT public.are_users_blocked(v_uid, x.pickup_contact_id)
     AND public.helpr_task_same_stripe_mode(v_uid, x.customer_id)
     -- BUY-41 (new): as helpr_tasks_open_near.
     AND NOT EXISTS (SELECT 1 FROM public.helpr_task_events e
                      WHERE e.task_id = x.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show'))
     AND NOT public.helpr_task_source_held(x.source_kind, x.source_id);
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.source_kind = 'shop_delivery' THEN
    v_latest := t.latest_pickup_at;
  ELSE
    SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
    IF o.id IS NULL THEN
      RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
    END IF;
    v_latest := LEAST(t.latest_pickup_at, o.paid_at + interval '7 days');
  END IF;
  -- The caller's own coming pickup from this seller at this place (within 50 m), if helpr_task_accept would take it.
  SELECT min(x.pickup_slot_start) INTO v_slot
    FROM public.helpr_tasks x
   WHERE x.helpr_id = v_uid AND x.status = 'accepted' AND x.id <> t.id
     AND x.pickup_contact_id = t.pickup_contact_id
     AND public.helpr_task_distance_m(x.pickup_lat, x.pickup_lng, t.pickup_lat, t.pickup_lng) <= 50
     AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)
     AND x.pickup_slot_start > now()
     AND x.pickup_slot_start + interval '30 minutes' <= v_latest
     AND public.helpr_task_source_slot_ok(t.source_kind, t.source_id, x.pickup_slot_start);
  RETURN v_slot;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_same_pickup_slot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_same_pickup_slot(uuid) TO authenticated, service_role;


-- RESTATED from 20261103055505_declutter_shops_homes_messages_not_found_is_404.sql (the three-way delivery chat for a shop task too).
CREATE OR REPLACE FUNCTION public.helpr_task_send_message(p_task_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_side text;
  v_body text := btrim(COALESCE(p_body, ''));
  v_quiet boolean;
  v_id uuid;
  v_to uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock: a stranger never locks someone else's delivery.
  IF NOT EXISTS (SELECT 1 FROM public.helpr_tasks x WHERE x.id = p_task_id
                   AND x.source_kind IN ('declutter_delivery', 'shop_delivery')
                   AND v_uid IN (x.helpr_id, x.customer_id, x.pickup_contact_id)) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  PERFORM public.helpr_task_source_require_feature(t.source_kind);
  v_side := CASE WHEN t.helpr_id = v_uid THEN 'helpr' WHEN t.customer_id = v_uid THEN 'buyer' WHEN t.pickup_contact_id = v_uid THEN 'seller' END;
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.helpr_id IS NULL OR t.status NOT IN ('accepted', 'picked_up', 'delivered') THEN
    RAISE EXCEPTION 'talk_closed' USING ERRCODE = '22023', HINT = 'This chat has ended.';
  END IF;
  -- A blocked pair never reaches each other here, on either side of a three-way chat.
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[t.helpr_id, t.customer_id, t.pickup_contact_id]) AS other(id)
              WHERE other.id IS NOT NULL AND other.id <> v_uid AND public.are_users_blocked(v_uid, other.id)) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023', HINT = 'Write a message of up to 1,000 characters.';
  END IF;
  IF (SELECT count(*) FROM public.helpr_task_talk_messages m
       WHERE m.task_id = t.id AND m.sender_id = v_uid AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'message_rate_limited' USING ERRCODE = '42501', HINT = 'Slow down a little, then send again.';
  END IF;
  -- Money review 10-31 (2): only this run's messages keep a sender quiet, so a new Helpr is told of the first message
  -- the buyer or seller sends them, even one sent minutes after a message to the Helpr before.
  v_quiet := EXISTS (SELECT 1 FROM public.helpr_task_talk_messages m
                      WHERE m.task_id = t.id AND m.sender_id = v_uid AND m.created_at >= t.accepted_at
                        AND m.created_at > now() - interval '15 minutes');
  INSERT INTO public.helpr_task_talk_messages (task_id, sender_id, sender_side, body)
  VALUES (t.id, v_uid, v_side, v_body)
  RETURNING id INTO v_id;
  -- Tell the other two, at most once per 15 minutes from one sender, never with the words themselves.
  IF NOT v_quiet THEN
    FOREACH v_to IN ARRAY ARRAY[t.helpr_id, t.customer_id, t.pickup_contact_id] LOOP
      IF v_to IS NOT NULL AND v_to <> v_uid THEN
        PERFORM public.declutter_notify(v_to, 'declutter_sales', 'New message about a delivery',
          format('The %s sent a message about the delivery of "%s".',
                 CASE WHEN v_side = 'helpr' THEN 'Helpr' WHEN v_side = 'seller' AND t.source_kind = 'shop_delivery' THEN 'shop' ELSE v_side END, t.title),
          CASE WHEN v_to = t.helpr_id THEN '/declutter?tab=deliver'
               WHEN t.source_kind = 'shop_delivery' AND v_to = t.customer_id THEN '/shops/orders'
               WHEN t.source_kind = 'shop_delivery' THEN '/shops/dashboard'
               WHEN v_to = t.customer_id THEN '/declutter?tab=buying' ELSE '/declutter?tab=selling' END,
          v_uid);
      END IF;
    END LOOP;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_send_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_send_message(uuid, text) TO authenticated, service_role;


-- RESTATED from 20261103050349_declutter_orders_talk_admin_not_found_is_404.sql (the chat of a shop task reads too).
CREATE OR REPLACE FUNCTION public.helpr_task_talk_view(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id AND source_kind IN ('declutter_delivery', 'shop_delivery');
  v_side := CASE WHEN NOT FOUND THEN NULL
                 WHEN t.helpr_id = v_uid THEN 'helpr' WHEN t.customer_id = v_uid THEN 'buyer' WHEN t.pickup_contact_id = v_uid THEN 'seller' END;
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN jsonb_build_object(
    'task_id', t.id,
    'side', v_side,
    'open', t.helpr_id IS NOT NULL AND t.status IN ('accepted', 'picked_up', 'delivered'),
    'messages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'side', m.sender_side, 'mine', m.sender_id = v_uid, 'body', m.body, 'created_at', m.created_at)
                                           ORDER BY m.created_at, m.id), '[]'::jsonb)
                   FROM public.helpr_task_talk_messages m WHERE m.task_id = t.id AND m.created_at >= t.accepted_at));
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_talk_view(p_task_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_talk_view(p_task_id uuid) TO authenticated, service_role;


-- RESTATED from 20261031134217_helpr_delivery_seller_reports_no_show.sql (the shop reads its own order's report).
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
                                            WHERE o.id = t.source_id AND t.source_kind = 'declutter_delivery' AND o.seller_id = v_uid)
                          OR EXISTS (SELECT 1 FROM public.shop_orders so
                                      WHERE so.id = t.source_id AND t.source_kind = 'shop_delivery' AND so.seller_id = v_uid)) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('reported_at', t.seller_no_show_reported_at, 'answer_by', t.seller_no_show_answer_by,
                            'answered_at', t.seller_no_show_answered_at, 'settled_at', t.seller_no_show_settled_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_no_show_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_no_show_report(uuid) TO authenticated, service_role;


-- RESTATED from 20261104175521_q2390_last_member_not_found_is_404.sql (the buyer of a shop order is told too).
CREATE OR REPLACE FUNCTION public.helpr_task_seller_move_pickup(p_task_id uuid, p_pickup_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_when text;
  v_what text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.pickup_contact_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM public.helpr_task_source_require_feature(t.source_kind);
  IF t.status <> 'accepted' OR t.helpr_id IS NULL
     OR (t.handed_over_at IS NOT NULL AND t.handed_over_to = t.helpr_id) THEN
    RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF t.pickup_slot_start <= now() THEN
    RAISE EXCEPTION 'too_late' USING ERRCODE = '55000',
      HINT = 'The pickup time has started. Message the Helpr instead.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.helpr_task_events e
              WHERE e.task_id = t.id AND e.task_event = 'pickup_moved' AND e.actor_id = v_uid
                AND e.created_at >= t.accepted_at) THEN
    RAISE EXCEPTION 'already_moved' USING ERRCODE = '55000',
      HINT = 'You can move a Helpr''s pickup once.';
  END IF;
  IF p_pickup_slot_start IS NULL OR p_pickup_slot_start < now() + interval '2 hours'
     OR p_pickup_slot_start = t.pickup_slot_start
     OR p_pickup_slot_start + interval '30 minutes' > t.latest_pickup_at
     OR NOT public.helpr_task_source_slot_ok(t.source_kind, t.source_id, p_pickup_slot_start) THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
      HINT = 'Pick a new time at least 2 hours away, inside your pickup times.';
  END IF;
  UPDATE public.helpr_tasks SET pickup_slot_start = p_pickup_slot_start, updated_at = now()
   WHERE id = t.id AND status = 'accepted';
  PERFORM public.helpr_task_log(t.id, 'pickup_moved', v_uid, to_char(p_pickup_slot_start, 'YYYY-MM-DD"T"HH24:MI:SSOF'));
  v_when := to_char(p_pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM');
  PERFORM public.declutter_notify(t.helpr_id, 'info', 'Pickup time changed',
    format('The seller moved the pickup of %s to %s.', t.title, v_when),
    '/declutter?tab=deliver', v_uid);
  IF t.source_kind = 'declutter_delivery' THEN
    v_what := public.declutter_order_items_named(t.source_id);
    PERFORM public.declutter_notify(t.customer_id, 'info', 'Pickup time changed',
      format('The seller moved the Helpr''s pickup of %s to %s. Your delivery comes after that.', v_what, v_when),
      '/declutter?tab=buying', v_uid);
  ELSIF t.source_kind = 'shop_delivery' THEN
    PERFORM public.declutter_notify(t.customer_id, 'info', 'Pickup time changed',
      format('The shop moved the Helpr''s pickup of your order to %s. Your delivery comes after that.', v_when),
      '/shops/orders', v_uid);
  END IF;
  RETURN jsonb_build_object('result', 'moved', 'pickup_slot_start', p_pickup_slot_start);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_seller_move_pickup(p_task_id uuid, p_pickup_slot_start timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_seller_move_pickup(p_task_id uuid, p_pickup_slot_start timestamp with time zone) TO authenticated, service_role;


-- RESTATED from 20261102150413_declutter_manager_admin_held_after_gave_up.sql (a shop delivery Helpr payout names its real transfer group, shop_order_<id>).
CREATE OR REPLACE FUNCTION public.admin_payouts_held_for_review()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(held.h || jsonb_build_object(
      'payee_account', (SELECT pr.stripe_account_id FROM public.profiles pr WHERE pr.user_id = (held.h ->> 'payee_id')::uuid),
      'sibling_refs', (SELECT COALESCE(jsonb_agg(to_jsonb(sb) ORDER BY sb.ref), '[]'::jsonb) FROM (
          SELECT 'declutter' AS kind, x.id, x.stripe_transfer_id AS ref, x.amount_cents FROM public.declutter_payouts x
           WHERE x.seller_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'helpr_task', x.id, x.stripe_transfer_id, x.amount_cents FROM public.helpr_task_payouts x
           WHERE x.helpr_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'shop', x.id, x.stripe_transfer_id, x.amount_cents FROM public.shop_payouts x JOIN public.shop_orders so ON so.id = x.order_id
           WHERE so.seller_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'declutter_manager', x.id, x.stripe_transfer_id, x.amount_cents FROM public.declutter_manager_payouts x
           WHERE x.manager_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          LIMIT 20) sb))
    ORDER BY held.h ->> 'held_at'), '[]'::jsonb) FROM (
    SELECT to_jsonb(x) AS h FROM (
      SELECT 'declutter' AS kind, p.id, p.seller_id AS payee_id, p.amount_cents, p.review_reason AS reason, p.review_held_at AS held_at,
             'declutter_order_' || p.order_id::text AS stripe_group, false AS gave_up
        FROM public.declutter_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      -- Manager mode: the manager's share, sent in the same order's transfer group as the seller's payout.
      SELECT 'declutter_manager', p.id, p.manager_id, p.amount_cents, p.review_reason, p.review_held_at,
             'declutter_order_' || p.order_id::text, false
        FROM public.declutter_manager_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      -- The REAL transfer group a Helpr's delivery payout is sent in: its Declutter order's.
      SELECT 'helpr_task', p.id, p.helpr_id, p.amount_cents, p.review_reason, p.review_held_at,
             CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || t.source_id::text
                  WHEN t.source_kind = 'shop_delivery' THEN 'shop_order_' || t.source_id::text END, false
        FROM public.helpr_task_payouts p LEFT JOIN public.helpr_tasks t ON t.id = p.task_id WHERE p.status = 'held_for_review'
      UNION ALL
      -- Q1931: a Helpr's delivery pay that used its 12 tries (helpr_task_payouts_due takes attempts < 12): it is
      -- sent by hand in Stripe and recorded here, or it stays 'failed' (and blocks the Helpr's deletion) for good.
      SELECT 'helpr_task', p.id, p.helpr_id, p.amount_cents, 'gave_up: ' || COALESCE(p.last_error, 'no error recorded'), p.created_at,
             CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || t.source_id::text
                  WHEN t.source_kind = 'shop_delivery' THEN 'shop_order_' || t.source_id::text END, true
        FROM public.helpr_task_payouts p LEFT JOIN public.helpr_tasks t ON t.id = p.task_id
       WHERE p.status = 'failed' AND p.attempts >= 12
      UNION ALL
      SELECT 'shop', p.id, o.seller_id, p.amount_cents, p.review_reason, p.review_held_at, 'shop_order_' || p.order_id::text, false
        FROM public.shop_payouts p JOIN public.shop_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'declutter_refund', r.id, o.buyer_id, r.refund_cents, r.review_reason, r.review_held_at, r.stripe_payment_intent_id, false
        FROM public.declutter_refunds r LEFT JOIN public.declutter_orders o ON o.id = r.order_id WHERE r.status = 'held_for_review'
      UNION ALL
      SELECT 'delivery_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.review_held_at, d.stripe_payment_intent_id, false
        FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
      UNION ALL
      -- Q1931: a delivery-fee refund that used its 12 tries (declutter_delivery_refunds_due takes attempts < 12).
      SELECT 'delivery_refund', d.id, o.buyer_id, d.refund_cents, 'gave_up: ' || COALESCE(d.last_error, 'no error recorded'), d.created_at,
             d.stripe_payment_intent_id, true
        FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id
       WHERE d.status = 'failed' AND d.attempts >= 12
      UNION ALL
      -- Q1931 (raise refunds): a delivery pay-raise refund that used its 12 tries (declutter_delivery_raise_refunds_due
      -- takes refund_attempts < 12). A raise is its own payment, so the Stripe reference is the raise's PaymentIntent.
      SELECT 'raise_refund', g.id, o.buyer_id, g.refund_cents, 'gave_up: ' || COALESCE(g.refund_last_error, 'no error recorded'),
             g.created_at, g.stripe_payment_intent_id, true
        FROM public.declutter_delivery_raises g LEFT JOIN public.declutter_orders o ON o.id = g.order_id
       WHERE g.status = 'refunding' AND g.refund_attempts >= 12
      UNION ALL
      -- Shops: an app refund held because a refund made in Stripe stands on its order.
      SELECT 'shop_refund', r.id, o.buyer_id, r.refund_cents, r.review_reason, r.review_held_at, r.stripe_payment_intent_id, false
        FROM public.shop_refunds r JOIN public.shop_orders o ON o.id = r.order_id WHERE r.status = 'held_for_review'
    ) x) held);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payouts_held_for_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payouts_held_for_review() TO authenticated, service_role;


-- RESTATED from 20261102150413_declutter_manager_admin_held_after_gave_up.sql (verbatim, kept beside admin_payouts_held_for_review).
CREATE OR REPLACE FUNCTION public.admin_payout_settle_by_hand(p_kind text, p_id uuid, p_ref text, p_amount_cents integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_stripe text;
  v_other text;
  v_status text;
  v_pi text;
  v_adopted boolean := false;
  v_payout boolean := p_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_manager');
  v_succeeded boolean;
  v_refund_cents integer;
  v_order uuid;
  v_attempts integer;
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say how it was settled, in under 500 characters.';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023', HINT = 'Enter the amount it was settled for.';
  END IF;
  IF v_ref ~* '^other:' THEN
    v_other := left(btrim(regexp_replace(v_ref, '^other:', '', 'i')), 300);
    IF char_length(v_other) < 3 THEN
      RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023', HINT = 'Say how it was paid outside Stripe, after "other:".';
    END IF;
  ELSIF (v_payout AND v_ref ~ '^(tr|po)_[A-Za-z0-9]+$') OR (NOT v_payout AND v_ref ~ '^(re|pyr)_[A-Za-z0-9]+$') THEN
    v_stripe := v_ref;
  ELSE
    RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023',
      HINT = 'A Stripe transfer / payout id (tr_..., po_...) for a payout, a refund id (re_...) for a refund, or "other: how it was paid".';
  END IF;
  -- Shops: the order row lock first (one lock order for every Shops money path: the order,
  -- then its refund / payout rows, then hand-refund rows).
  IF p_kind = 'shop' THEN
    SELECT order_id INTO v_order FROM public.shop_payouts WHERE id = p_id;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT order_id INTO v_order FROM public.shop_refunds WHERE id = p_id;
  END IF;
  IF v_order IS NOT NULL THEN
    SELECT * INTO o FROM public.shop_orders WHERE id = v_order FOR UPDATE;
  END IF;
  IF p_kind = 'declutter' THEN
    SELECT status INTO v_status FROM public.declutter_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'helpr_task' THEN
    SELECT status, attempts INTO v_status, v_attempts FROM public.helpr_task_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop' THEN
    SELECT status INTO v_status FROM public.shop_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_refund' THEN
    SELECT status, refund_cents INTO v_status, v_refund_cents FROM public.declutter_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'delivery_refund' THEN
    SELECT status, refund_cents, attempts INTO v_status, v_refund_cents, v_attempts FROM public.declutter_delivery_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'raise_refund' THEN
    SELECT status, refund_cents, refund_attempts INTO v_status, v_refund_cents, v_attempts
      FROM public.declutter_delivery_raises WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT status, refund_cents INTO v_status, v_refund_cents FROM public.shop_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_manager' THEN
    SELECT status INTO v_status FROM public.declutter_manager_payouts WHERE id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  -- Q1931: a Declutter delivery row that used its 12 tries ('failed', attempts >= 12: no queue offers it again)
  -- is settled here too; a row still being retried is not.
  IF v_status IS DISTINCT FROM 'held_for_review'
     AND NOT (p_kind IN ('helpr_task', 'delivery_refund') AND v_status = 'failed' AND v_attempts >= 12)
     -- Q1931 (raise refunds): a raise refund keeps 'refunding' while it is retried; only one past its 12 tries.
     AND NOT (p_kind = 'raise_refund' AND v_status = 'refunding' AND v_attempts >= 12) THEN
    RAISE EXCEPTION 'not_held_for_review' USING ERRCODE = '55000';
  END IF;
  -- Shops refund (run-3 review #2/#3): a Stripe refund id is checked WITH Stripe first, so it goes
  -- only through shop-checkout's admin_settle_held_refund (service-only shops_admin_settle_held_refund);
  -- here only "other: ...", and only for the WHOLE refund the row owes (CHECK shop_refunds_settled_in_full).
  IF p_kind = 'shop_refund' AND v_stripe IS NOT NULL THEN
    RAISE EXCEPTION 'stripe_check_required' USING ERRCODE = '22023',
      HINT = 'Settle a Shops refund with a Stripe refund id from Payouts held for review: it is checked with Stripe first.';
  END IF;
  IF p_kind = 'shop_refund' AND p_amount_cents <> v_refund_cents THEN
    RAISE EXCEPTION 'settle_amount_differs' USING ERRCODE = '22023',
      HINT = format('A Shops refund is settled only for its whole amount, $%s.', to_char(v_refund_cents / 100.0, 'FM999999990.00'));
  END IF;
  -- Q1931 (raise refunds): a raise row has only 'refunded' after 'refunding' (no settled-by-hand state), and it
  -- goes back to the buyer's card: so only a Stripe refund id, for exactly the refund the row owes.
  IF p_kind = 'raise_refund' AND v_stripe IS NULL THEN
    RAISE EXCEPTION 'stripe_refund_required' USING ERRCODE = '22023',
      HINT = 'A pay-raise refund goes back to the card: refund it in Stripe and give the re_... id.';
  END IF;
  IF p_kind = 'raise_refund' AND p_amount_cents <> v_refund_cents THEN
    RAISE EXCEPTION 'settle_amount_differs' USING ERRCODE = '22023',
      HINT = format('A pay-raise refund is settled only for its whole amount, $%s.', to_char(v_refund_cents / 100.0, 'FM999999990.00'));
  END IF;
  -- A transfer on a payout / a refund (re_ or pyr_) on a refund: 'succeeded' with that id (the
  -- ledgers and the webhooks know it). A Stripe payout id or money paid outside Stripe:
  -- 'settled_by_hand'.
  v_succeeded := v_stripe IS NOT NULL AND (NOT v_payout OR v_stripe ~ '^tr_');
  -- A refund reaches 'succeeded' only for the WHOLE amount owed: a short Stripe refund would
  -- close the row (and count as refunded) while the buyer is still owed the rest.
  IF NOT v_payout AND v_succeeded AND p_amount_cents < COALESCE(v_refund_cents, 0) THEN
    RAISE EXCEPTION 'settle_amount_short' USING ERRCODE = '22023',
      HINT = 'Refund the rest in Stripe first, then record the full amount.';
  END IF;
  IF v_stripe IS NOT NULL THEN
    -- A Dashboard refund the hand-refund ledger recorded with no row, on THIS row's payment, is
    -- the refund that settled it: adopted (linked), not refused.
    IF p_kind = 'declutter_refund' THEN
      SELECT r.stripe_payment_intent_id INTO v_pi FROM public.declutter_refunds r WHERE r.id = p_id;
      UPDATE public.declutter_hand_refunds SET refund_row_id = p_id, hand_outcome = 'settled'
       WHERE stripe_refund_id = v_stripe AND stripe_payment_intent_id = v_pi AND refund_row_id IS NULL AND failed_at IS NULL;
      v_adopted := FOUND;
    END IF;
    IF NOT v_adopted AND public.money_ref_in_use(v_stripe) THEN
      RAISE EXCEPTION 'ref_already_used' USING ERRCODE = '23505',
        HINT = 'That Stripe id is already recorded on another payout or refund. Check you have the right one.';
    END IF;
  END IF;
  INSERT INTO public.payout_settlements (stripe_ref, off_stripe_note, row_kind, row_id, amount_cents)
  VALUES (v_stripe, v_other, p_kind, p_id, p_amount_cents);
  IF p_kind = 'declutter_refund' AND v_stripe IS NOT NULL AND NOT v_adopted THEN
    INSERT INTO public.declutter_hand_refunds (stripe_refund_id, stripe_payment_intent_id, order_id, refund_row_id, amount_cents,
                                               livemode, hand_outcome)
    SELECT v_stripe, r.stripe_payment_intent_id, r.order_id, r.id, p_amount_cents, COALESCE(r.payment_livemode, true), 'settled'
      FROM public.declutter_refunds r WHERE r.id = p_id;
  END IF;
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_ref = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_ref END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_ref = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_ref END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'raise_refund' THEN
    -- The same end state as declutter_delivery_raise_refund_executed's success (20261021185418).
    UPDATE public.declutter_delivery_raises SET status = 'refunded', stripe_refund_ref = v_stripe, refunded_at = now(),
           refund_last_error = NULL, updated_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'declutter_manager' THEN
    UPDATE public.declutter_manager_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'shop_refund' THEN
    -- Only "other: ..." reaches here (above): settled by hand, never 'succeeded'.
    UPDATE public.shop_refunds SET status = 'settled_by_hand',
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.payout_payee_waits WHERE payout_kind = p_kind AND payout_id = p_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'admin_payout_settle_by_hand', p_kind, p_id::text,
          jsonb_build_object('note', v_note, 'ref', v_ref, 'amount_cents', p_amount_cents, 'adopted_hand_refund', v_adopted));
  RETURN jsonb_build_object('result', 'settled', 'kind', p_kind, 'id', p_id, 'adopted_hand_refund', v_adopted,
    'status', CASE WHEN p_kind = 'raise_refund' THEN 'refunded' WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payout_settle_by_hand(text, uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_settle_by_hand(text, uuid, text, integer, text) TO authenticated, service_role;
