-- Q2390 last member packet (Builder 2, 11-04; REGULAR packet, ERRCODE only): "not found" answers HTTP 404, not 500,
-- for the 31 functions an authenticated member can still call that raised their not-found as ERRCODE 'P0002'
-- (PostgREST maps every P0 code but P0001 to HTTP 500, which shouldRetryQuery retries and alerts count as a server
-- failure; 'PT404' answers 404). Measured on prod 2026-11-04 (read-only SELECT on pg_proc): 37 public functions still
-- raised P0002, these 31 EXECUTE-able by authenticated (none by anon), each one overload, acl
-- {postgres, authenticated, service_role}.
--   Jobs: rpc_helper_mark_done, rpc_poster_confirm_member_arrival; admin: admin_confirm_ban_settlement;
--   Declutter: declutter_book_porch_day, declutter_confirm_handover, declutter_porch_photo, declutter_seller_picked_up;
--   Helpr delivery: helpr_task_* (12); paused areas: rentals_* (7) and shops_* (5).
-- Left (not member-callable; restated on pending branches or service-only): declutter_apply_seller_fault,
-- declutter_setup_job_fee_debt, redeem_gift_card, enforce_group_member_completion_gates, shop_complete_handover,
-- shops_admin_settle_held_refund.
-- An exception rolls back the whole statement, so the code change moves no write. Callers map by message, never by
-- code (the only code maps, declutter-checkout and shop-checkout, already answer P0002|PT404 as 404); no function
-- catches P0002/no_data_found. No edge function changes, no deploy beyond this migration.
--
-- Each is restated VERBATIM from its newest migration copy, whose md5(prosrc) equals prod (read 2026-11-04 ~11:55 AM
-- CST by Builder 2; listed below as file prefix, prod md5(prosrc), raises). The ONLY change: ERRCODE 'P0002' ->
-- 'PT404'. Grants as prod.
-- Two refusals name a state, not a missing row, so they move to '22023' (HTTP 400), never PT404, as the lead ruled
-- for declutter_admin_review_item 'item_not_pending' and rentals_confirm_visit 'no_visit_proposed' (11-03):
-- shops_admin_review_item 'item_not_pending' (2 raises) and admin_confirm_ban_settlement 'no_open_review' (another
-- admin already decided it). Both admin screens map by message (adminRpcErrorCopy.ts), never by code.

--   admin_confirm_ban_settlement         20261103230932 c27da33643f74d57e6259b439fe54ace (1)
--   declutter_book_porch_day             20261102113853 3cd47cec1480751fa7b64433d15a9067 (1)
--   declutter_confirm_handover           20261103202118 b72225807052ba180c0c6d4986bc35e6 (1)
--   declutter_porch_photo                20261103202118 7d5bbd85c2f061002d573b493ac5e951 (1)
--   declutter_seller_picked_up           20261031004529 c2cf8053df303517e5e4c186a68229a1 (1)
--   helpr_task_accept                    20261031102758 00e1ea41f84fb2350a15d540eca87aa8 (2)
--   helpr_task_buyer_choose              20261031231150 235e802cc54e9376eb2b1c6948eae6d4 (2)
--   helpr_task_buyer_fix                 20261031231150 cb942db64d25c1028605d77b842eee15 (2)
--   helpr_task_cant_finish               20261031231150 c8e87a8a6b2aeb9f223eb1269ec84af3 (2)
--   helpr_task_customer_confirm          20261031231150 93b4c55af9030383ae1b41acddf3b65d (1)
--   helpr_task_delivered                 20261031231150 df913804fc961e3a451979ce7b7e5b80 (1)
--   helpr_task_picked_up                 20261030012018 e2046a9148b4d4d8986a151d88d6ac60 (1)
--   helpr_task_pickup_no_show            20261017055505 016915666188694e20f7d978d6ee854f (1)
--   helpr_task_returned                  20261031231150 afd5ec664e1a37bfdd3c7cf8a829a41e (2)
--   helpr_task_seller_move_pickup        20261031095846 29cae25ef70e5da8e9b6b9b13d368222 (1)
--   helpr_task_seller_return_answer      20261031231150 75dfb3213aef089716001d1fca55fde2 (2)
--   helpr_task_tip_start                 20261101051951 f96afd273f77226e60b86b768be73acc (1)
--   rentals_admin_lift_takedown          20261019071203 a0545d2105c9a10c9082417fc6eced9f (1)
--   rentals_admin_remove_listing         20261019071203 d303a1693e2d1133c7b9aa830aa43c62 (1)
--   rentals_file_request                 20261017205605 cb6670a9e16294c685f45527fbe68990 (1)
--   rentals_save_listing                 20261019061241 2e312b33fb07cb0857fe580cf64a2cca (2)
--   rentals_save_sale_listing            20261019061241 fd698fe6ab966c75b644153729a2fd38 (2)
--   rentals_set_rent_plan                20261019073106 83d26768b8e490ce0c2b0021bf04c7c6 (1)
--   rentals_settle_deposit               20261019082216 bfde6f97f0ccfc114846a558ce76073b (2)
--   rpc_helper_mark_done                 20261101034159 79944f2e9fbb284ca35aef07ca913866 (1)
--   rpc_poster_confirm_member_arrival    20260919192559 506f38b2785c0c3314d5df5d0ce26a15 (1)
--   shops_accept_order                   20261018164442 dba1f9e857a357c24bd9ed61315b6918 (1)
--   shops_admin_review_item              20261017061157 74d0e7f6979eaa15dd9a9e1928d18e76 (2)
--   shops_buyer_cancel_order             20261019071055 dab649195143f11eb59e0267f444fd34 (1)
--   shops_mark_ready                     20261018211820 bd216663f521fecbd5de9a69e9f68dc9 (1)
--   shops_request_order                  20261018164444 0d8a3520e3a37a8f2a58cf1fe17285ae (1)

-- admin_confirm_ban_settlement: restated from 20261103230932_ban_review_confirm_keeps_a_no_end_suspension.sql.
CREATE OR REPLACE FUNCTION public.admin_confirm_ban_settlement(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_review record;
  v_final  text;
  v_status text;
  v_out    jsonb := NULL;
  v_rung   jsonb;
  v_floor  jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  -- FOR UPDATE: a second confirm (or a lift) waits, then finds no open review.
  SELECT r.id, r.created_at, r.original_ban_status, r.original_expires_at,
         r.deferred_ban_status, r.deferred_suspended_until INTO v_review
    FROM public.ban_settlement_queue r
   WHERE r.user_id = p_user_id AND r.review_state = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_open_review' USING ERRCODE = '22023';
  END IF;

  -- Closed first: the freeze, the browse hiding and the claim refusal all
  -- key on an OPEN review, and the settlement below must be able to act.
  UPDATE public.ban_settlement_queue
     SET review_state = 'confirmed', decided_at = now(), decided_by = v_uid
   WHERE id = v_review.id;

  -- The retained judgment the match carried, now applied. The settlement
  -- triggers are told to stand aside (they would price as of now); the
  -- settlement then runs explicitly, as of the moment of the ban.
  v_final := COALESCE(v_review.original_ban_status, 'permanently_banned');
  -- Q1413: a standing the ladder deferred during the review applies when it
  -- is harsher than the retained judgment (a later suspension end too).
  -- Q1496: the harshest rung whose strikes all still stand.
  v_rung := public.ban_review_standing_rung(v_review.id, false);
  IF v_rung IS NOT NULL
     AND public.ban_standing_rank(v_rung ->> 'ban_status') > public.ban_standing_rank(v_final) THEN
    v_final := v_rung ->> 'ban_status';
    v_review.original_expires_at := (v_rung ->> 'suspended_until')::timestamptz;
  ELSIF v_rung IS NOT NULL AND v_final = 'temp_banned' AND v_rung ->> 'ban_status' = 'temp_banned'
        -- Q1415 (f3): between two suspensions the later end; one with no end
        -- outlasts any (a dated rung never replaces a no-end review suspension).
        AND v_review.original_expires_at IS NOT NULL
        AND ((v_rung ->> 'suspended_until') IS NULL
             OR (v_rung ->> 'suspended_until')::timestamptz > v_review.original_expires_at) THEN
    v_review.original_expires_at := (v_rung ->> 'suspended_until')::timestamptz;
  END IF;
  -- Q1415 (f): a stricter retained judgment applied during the review by
  -- another identity signal is never weakened by the confirm (it wrote the
  -- review's own judgment over profiles and the self-issued user_bans rows).
  v_floor := public.ban_review_retained_floor(p_user_id, v_review.created_at);
  IF v_floor IS NOT NULL THEN
    IF public.ban_standing_rank(v_floor ->> 'ban_status') > public.ban_standing_rank(v_final) THEN
      v_final := v_floor ->> 'ban_status';
      v_review.original_expires_at := (v_floor ->> 'suspended_until')::timestamptz;
    ELSIF v_final = 'temp_banned' AND v_floor ->> 'ban_status' = 'temp_banned' AND v_review.original_expires_at IS NOT NULL
          AND ((v_floor ->> 'suspended_until') IS NULL OR (v_floor ->> 'suspended_until')::timestamptz > v_review.original_expires_at) THEN
      v_review.original_expires_at := (v_floor ->> 'suspended_until')::timestamptz;
    END IF;
  END IF;
  PERFORM set_config('app.ban_settlement_review', 'on', true);
  UPDATE public.profiles p
     SET ban_status           = v_final,
         auto_suspended_until = CASE WHEN v_final = 'temp_banned' THEN v_review.original_expires_at ELSE NULL END
   WHERE p.user_id = p_user_id
     AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned');
  PERFORM set_config('app.ban_settlement_review', 'off', true);
  UPDATE public.user_bans b
     SET ban_type = v_final,
         expires_at = CASE WHEN v_final = 'temp_banned' THEN v_review.original_expires_at ELSE NULL END
   WHERE b.user_id = p_user_id AND b.is_active AND b.banned_by = p_user_id;
  SELECT p.ban_status INTO v_status FROM public.profiles p WHERE p.user_id = p_user_id;

  -- A temporary judgment never settled jobs (the triggers fire only for
  -- these two), so confirming one changes no job.
  IF v_status IN ('banned', 'permanently_banned') THEN
    PERFORM set_config('app.ban_settlement_as_of', v_review.created_at::text, true);
    v_out := public.settle_one_off_jobs_for_banned_account(p_user_id);
    PERFORM public.end_series_for_banned_account(p_user_id);
    PERFORM set_config('app.ban_settlement_as_of', '', true);
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (v_uid, 'ban_settlement_confirmed', p_user_id::text, 'user',
          jsonb_build_object('ban_status', v_status, 'as_of', v_review.created_at, 'settlement', v_out,
                             'applied_rung', v_rung, 'retained_floor', v_floor));
  RETURN jsonb_build_object('confirmed', true, 'ban_status', v_status, 'settlement', v_out);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_confirm_ban_settlement(p_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_ban_settlement(p_user_id uuid) TO authenticated, service_role;

-- declutter_book_porch_day: restated from 20261102113853_declutter_notices_retire_when_their_subject_moves_on.sql.
CREATE OR REPLACE FUNCTION public.declutter_book_porch_day(p_order_id uuid, p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  v_side text;
  v_kind text;
  v_start timestamptz;
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
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_day IS NULL OR p_day < (now() AT TIME ZONE 'America/Chicago')::date
     OR (p_day::timestamp AT TIME ZONE 'America/Chicago') >= o.paid_at + interval '7 days' THEN
    RAISE EXCEPTION 'invalid_day' USING ERRCODE = '22023',
      HINT = 'Pick a day from today until the 7-day pickup deadline.';
  END IF;
  IF NOT public.declutter_order_is_porch_day(o.id, extract(dow FROM p_day)::smallint) THEN
    RAISE EXCEPTION 'invalid_day' USING ERRCODE = '22023', HINT = 'Pick one of the seller''s pickup days.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'seller_set_out' USING ERRCODE = '55000', HINT = 'The item is already out on the porch.';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  -- declutter_book_pickup's own rules, for a day.
  IF v_side = 'buyer' THEN
    IF b.order_id IS NULL THEN
      v_kind := 'booked';
    ELSIF b.slot_start IS NULL THEN
      IF b.buyer_rebooked THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000';
      END IF;
      v_kind := 'rebooked';
    ELSE
      IF b.buyer_reschedules >= 1 THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
      END IF;
      v_kind := 'rescheduled';
    END IF;
  ELSE
    IF b.order_id IS NULL OR b.slot_start IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'The buyer picks the day first.';
    END IF;
    IF b.seller_reschedules >= 1 THEN
      RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
    END IF;
    v_kind := 'seller_rescheduled';
  END IF;
  v_start := p_day::timestamp AT TIME ZONE 'America/Chicago';
  IF b.order_id IS NULL THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end, porch_mode, pickup_day, reminded_slot_start)
    VALUES (o.id, o.buyer_id, o.seller_id, v_start, v_start + interval '30 minutes', 'all_day', p_day, v_start);
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
  ELSE
    UPDATE public.declutter_bookings
       SET slot_start = v_start, slot_end = v_start + interval '30 minutes', pickup_day = p_day,
           porch_mode = 'all_day', porch_until = NULL, reminded_slot_start = v_start, updated_at = now(),
           buyer_reschedules = buyer_reschedules + CASE WHEN v_kind = 'rescheduled' THEN 1 ELSE 0 END,
           seller_reschedules = seller_reschedules + CASE WHEN v_kind = 'seller_rescheduled' THEN 1 ELSE 0 END,
           buyer_rebooked = buyer_rebooked OR v_kind = 'rebooked'
     WHERE order_id = o.id;
  END IF;
  PERFORM public.declutter_notice_ref(p_order_id); -- Q2659
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'declutter_pickups',
    CASE v_kind WHEN 'booked' THEN 'Porch pickup day booked' ELSE 'Porch pickup day changed' END,
    CASE WHEN v_side = 'buyer'
         THEN format('The buyer picks it up from your porch on %s. Put it out that day and post the porch photo.', to_char(p_day, 'FMDay, Mon FMDD'))
         ELSE format('Your porch pickup is now on %s. We''ll tell you when it''s out.', to_char(p_day, 'FMDay, Mon FMDD')) END,
    CASE WHEN v_side = 'buyer' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END,
    v_uid);
  RETURN jsonb_build_object('result', v_kind, 'pickup_day', p_day);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_book_porch_day(p_order_id uuid, p_day date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_book_porch_day(p_order_id uuid, p_day date) TO authenticated, service_role;

-- declutter_confirm_handover: restated from 20261103202118_declutter_porch_got_it_waits_for_photo.sql.
CREATE OR REPLACE FUNCTION public.declutter_confirm_handover(p_order_id uuid, p_method text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_slot timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_method IS NULL OR p_method <> 'buyer' THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'buyer' THEN
    -- the seller cannot tap "I got it" for the buyer
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- BUY-17 (owner 11-03): on a porch pickup the buyer's "I got it" waits for the seller's porch photo
  -- (declutter_handovers.set_out_at), whatever the day: before it, nobody has said the item is out, and the tap
  -- pays the seller. The buyer can still report a problem (declutter_report_problem is not gated here).
  IF o.handover = 'porch' AND NOT EXISTS (
       SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'porch_photo_not_in' USING ERRCODE = '22023',
      HINT = 'You can tap I got it once the seller posts the porch photo.';
  END IF;
  -- A seller delivery (20261028202844, #7): only once the seller marked it delivered, or from the delivery
  -- day on the Louisiana calendar. No time booked and not delivered: not yet.
  IF o.handover = 'seller_delivery' AND NOT EXISTS (
       SELECT 1 FROM public.declutter_seller_deliveries d
        WHERE d.order_id = o.id
          AND (d.delivered_at IS NOT NULL
               OR (d.status = 'booked' AND d.slot_start IS NOT NULL
                   AND (now() AT TIME ZONE 'America/Chicago')::date >= (d.slot_start AT TIME ZONE 'America/Chicago')::date))) THEN
    RAISE EXCEPTION 'not_delivered_yet' USING ERRCODE = '55000',
      HINT = 'You can confirm you got it from the delivery day, or once the seller marks it delivered.';
  END IF;
  -- A safe meeting spot or a door pickup (audit 1030 DB-3): only with a time booked, and from the hour before it
  -- that "I'm here" opens (declutter_meetup_rules().here_from_minutes_before).
  IF o.handover IN ('meetup', 'pickup_home') THEN
    SELECT b.slot_start INTO v_slot FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL;
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'Book a time first.';
    END IF;
    IF now() < v_slot - make_interval(mins => (public.declutter_meetup_rules() ->> 'here_from_minutes_before')::integer) THEN
      RAISE EXCEPTION 'got_it_too_early' USING ERRCODE = '55000',
        HINT = 'You can tap I got it from an hour before the booked time.';
    END IF;
  END IF;
  -- Shipping S2 (review fix 10): a shipped order only after the USPS delivered scan.
  IF o.handover = 'ship' AND NOT EXISTS (
       SELECT 1 FROM public.shipments s
        WHERE s.declutter_order_id = o.id AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_delivered_yet' USING ERRCODE = '55000',
      HINT = 'You can confirm you got it once the post office scans it as delivered.';
  END IF;
  -- CHANGED (owner 10-30): the buyer's tap is enough, even on a sale held 60 days: that problem is nobody's report, and
  -- the buyer has just spoken. Any other open problem still holds it (declutter_complete_handover refuses).
  UPDATE public.declutter_problems SET status = 'withdrawn', withdrawn_at = now()
   WHERE order_id = o.id AND status = 'open' AND reporter_side = 'system';
  RETURN public.declutter_complete_handover(o.id, p_method);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_confirm_handover(p_order_id uuid, p_method text, p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_confirm_handover(p_order_id uuid, p_method text, p_code text) TO authenticated, service_role;

-- declutter_porch_photo: restated from 20261103202118_declutter_porch_got_it_waits_for_photo.sql.
CREATE OR REPLACE FUNCTION public.declutter_porch_photo(p_order_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_m integer;
  v_done jsonb;
  v_day date;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'handed_over' AND o.handover = 'porch' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  -- Audit 1a #4 (20261029201542): the seller puts it out ON the buyer's booked day, never before, so the buyer is
  -- not told to come early and the payout clock does not start early. The day is the booking's porch day, else the
  -- Louisiana date of an older timed booking's slot.
  IF v_side = 'seller' THEN
    SELECT COALESCE(b.pickup_day, (b.slot_start AT TIME ZONE 'America/Chicago')::date) INTO v_day
      FROM public.declutter_bookings b WHERE b.order_id = o.id;
    -- Fail closed: no day read (not_booked_yet above should make that impossible) is refused too, never waved through.
    IF v_day IS NULL OR (now() AT TIME ZONE 'America/Chicago')::date < v_day THEN
      RAISE EXCEPTION 'porch_day_not_yet' USING ERRCODE = '55000',
        HINT = format('Put it out on %s, the day the buyer picked.', to_char(v_day, 'FMDay, Mon FMDD'));
    END IF;
  END IF;
  -- BUY-17 (owner 11-03, lead call the same hour): the buyer's "Picked up" photo finishes the sale and pays the
  -- seller like "I got it" does, so it waits for the seller's porch photo too (same refusal, same reason).
  IF v_side = 'buyer' AND NOT EXISTS (
       SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'porch_photo_not_in' USING ERRCODE = '22023',
      HINT = 'You can take your pickup photo once the seller posts the porch photo.';
  END IF;
  IF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
  IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
    RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
      HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
  END IF;
  -- Both sides' photos are taken at the address (20261028235709): the seller's "Left on porch" as the buyer's
  -- "Picked up".
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  -- Haversine, metres, to the NEAREST pickup point of the ORDER (D-NEW14, 20261030164712): the porch place frozen
  -- on it at checkout, else (an order with no place) every item's own point, as before (authz review 2.7).
  SELECT min(round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat - pt.lat) / 2)), 2)
           + cos(radians(pt.lat)) * cos(radians(p_lat)) * power(sin(radians((p_lng - pt.lng) / 2)), 2)))))::integer)
    INTO v_m
    FROM public.declutter_order_pickup_points(o.id) pt;
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  IF v_side = 'seller' THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now(), set_out_distance_m = v_m
     WHERE order_id = o.id;
    -- The buyer's signal to go (20261028225038): its own title, the Pickups switch, Buying.
    PERFORM public.declutter_notice_ref(p_order_id); -- Q2659
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'It''s on the porch: pick it up today',
      'The seller put your item out. Take a photo when you pick it up.', '/declutter?tab=buying', o.seller_id);
    RETURN jsonb_build_object('result', 'set_out', 'distance_m', v_m);
  END IF;
  UPDATE public.declutter_handovers
     SET picked_up_photo_path = p_photo_path, picked_up_at = now(), picked_up_distance_m = v_m
   WHERE order_id = o.id;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Your item was picked up',
      'The buyer picked up the item from your porch. A problem report is open, so Louisiana Helpr decides before anyone is paid.',
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', false);
  END IF;
  v_done := public.declutter_complete_handover(o.id, 'porch');
  RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', true, 'payout_id', v_done->'payout_id');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_porch_photo(p_order_id uuid, p_photo_path text, p_lat numeric, p_lng numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_photo(p_order_id uuid, p_photo_path text, p_lat numeric, p_lng numeric) TO authenticated, service_role;

-- declutter_seller_picked_up: restated from 20261031004529_declutter_handover_both_confirm.sql.
CREATE OR REPLACE FUNCTION public.declutter_seller_picked_up(p_order_id uuid, p_photo_path text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_out jsonb;
  v_m integer;
  h public.declutter_handovers;
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
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- Q2425: handing it over at a safe meeting spot is the same act as at the door.
  IF o.handover NOT IN ('pickup_home', 'meetup') THEN
    RAISE EXCEPTION 'not_a_door_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  -- Not before the booked time (lh-money-escrow review #1): the seller cannot
  -- mark it picked up, and be paid, before the buyer could have come.
  IF EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start > now()) THEN
    RAISE EXCEPTION 'before_pickup_time' USING ERRCODE = '55000',
      HINT = 'You can mark it picked up from the booked pickup time.';
  END IF;
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF p_photo_path IS NOT NULL THEN
    IF split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
       OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
       OR split_part(p_photo_path, '/', 5) = ''
       OR split_part(p_photo_path, '/', 6) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
    IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
      RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
        HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
    END IF;
    -- A photo is taken where the handover is (20261028235709): the meeting spot frozen on the order, or the
    -- nearest item pickup point of a door pickup.
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    IF o.handover = 'meetup' THEN
      SELECT public.helpr_task_distance_m(p_lat, p_lng, m.spot_lat, m.spot_lng) INTO v_m
        FROM public.declutter_order_meetups m WHERE m.order_id = o.id;
      IF v_m IS NULL OR v_m > 200 THEN
        RAISE EXCEPTION 'not_at_meetup' USING ERRCODE = '22023', HINT = 'Take the photo at the meeting spot.';
      END IF;
    ELSE
      SELECT min(public.helpr_task_distance_m(p_lat, p_lng, p.pickup_lat, p.pickup_lng)) INTO v_m
        FROM public.declutter_cart_items c
        JOIN public.declutter_item_private p ON p.item_id = c.item_id
       WHERE c.order_id = o.id;
      IF v_m IS NULL OR v_m > 200 THEN
        RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
      END IF;
    END IF;
  END IF;
  -- CHANGED (owner 10-30): a paid sale waits for the buyer. A free claim moves no money, so it finishes as before.
  IF o.paid_with = 'free' THEN
    -- complete_handover first (it refuses an open problem); then the photo is kept with the handover.
    v_out := public.declutter_complete_handover(o.id, 'seller');
    IF p_photo_path IS NOT NULL THEN
      UPDATE public.declutter_handovers SET picked_up_photo_path = p_photo_path, picked_up_at = now(), picked_up_distance_m = v_m
       WHERE order_id = o.id AND picked_up_photo_path IS NULL;
    END IF;
    RETURN v_out;
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
  END IF;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  IF h.no_show_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'no_show_reported' USING ERRCODE = '55000',
      HINT = 'The buyer says you didn''t show. Answer that report on this order.';
  END IF;
  IF h.seller_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'seller_confirmed');
  END IF;
  UPDATE public.declutter_handovers
     SET seller_confirmed_at = now(),
         picked_up_photo_path = COALESCE(picked_up_photo_path, p_photo_path),
         picked_up_at = CASE WHEN picked_up_photo_path IS NULL AND p_photo_path IS NOT NULL THEN now() ELSE picked_up_at END,
         picked_up_distance_m = CASE WHEN picked_up_photo_path IS NULL AND p_photo_path IS NOT NULL THEN v_m ELSE picked_up_distance_m END
   WHERE order_id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'The seller says you have it',
    format('About %s. Tap "I got it" in Buying. If you don''t have it, report a problem there. If we don''t hear from you, the seller is paid in 48 hours.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=buying', o.seller_id);
  RETURN jsonb_build_object('result', 'seller_confirmed');
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_seller_picked_up(p_order_id uuid, p_photo_path text, p_lat numeric, p_lng numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_picked_up(p_order_id uuid, p_photo_path text, p_lat numeric, p_lng numeric) TO authenticated, service_role;

-- helpr_task_accept: restated from 20261031102758_helpr_backout_after_seller_move_is_free.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_accept(p_task_id uuid, p_pickup_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  t public.helpr_tasks;
  v_reason text;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM public.helpr_task_source_require_feature(t.source_kind);
  v_uid := public.helpr_task_assert_helpr();
  -- ID once (owner 2026-10-20): taking a delivery is the Helpr's accept, so it
  -- reads the one helper every accept reads. helpr_task_assert_helpr already
  -- refused an unready payout account, so what is left here is the ID.
  v_reason := public.helper_accept_block_reason(v_uid);
  IF v_reason = 'helper_identity_unverified' THEN
    RAISE EXCEPTION 'helper_identity_unverified' USING ERRCODE = '42501',
      HINT = 'Verify your ID to accept a delivery. You only do it once.';
  ELSIF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'payout_setup_incomplete' USING ERRCODE = '42501',
      HINT = 'Set up payouts in Settings before you take a delivery.';
  END IF;
  IF v_uid IN (t.customer_id, t.pickup_contact_id) THEN
    RAISE EXCEPTION 'own_task' USING ERRCODE = '42501', HINT = 'You cannot deliver your own sale.';
  END IF;
  IF public.are_users_blocked(v_uid, t.customer_id) OR public.are_users_blocked(v_uid, t.pickup_contact_id)
     OR NOT public.helpr_task_same_stripe_mode(v_uid, t.customer_id) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- 20261028012406 (lh-authz-rls review nit 1): the vehicle row stays as read until this
  -- take commits, so helpr_set_vehicle cannot drop what this delivery needs meanwhile.
  PERFORM 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid FOR SHARE;
  IF NOT public.helpr_task_vehicle_fits(v_uid, t.size) THEN
    -- 20261028012406 (Q2452, owner 2026-10-28): every delivery needs a car.
    IF NOT EXISTS (SELECT 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid AND v.has_car) THEN
      RAISE EXCEPTION 'vehicle_needs_car' USING ERRCODE = '42501',
        HINT = 'Add your car under Your vehicle to take deliveries.';
    END IF;
    RAISE EXCEPTION 'vehicle_too_small' USING ERRCODE = '42501',
      HINT = 'This item needs a truck (and a second person for extra large). Add your truck under Your vehicle.';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.status <> 'open' OR t.open_until <= now() THEN
    RAISE EXCEPTION 'task_taken' USING ERRCODE = '55000', HINT = 'Another Helpr took this delivery, or it closed.';
  END IF;
  -- Taking a delivery shows its pickup address, so taking and backing out must
  -- not be a way to collect addresses (lh-authz-rls review #4, 2026-10-16): a
  -- Helpr never takes back a delivery they backed out of or missed, and three
  -- back-outs or misses in 7 days pause taking new ones for the rest of that week.
  IF EXISTS (SELECT 1 FROM public.helpr_task_events e
              WHERE e.task_id = t.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show')) THEN
    RAISE EXCEPTION 'task_taken' USING ERRCODE = '55000', HINT = 'Another Helpr took this delivery, or it closed.';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  -- At most 2 deliveries taken and not yet picked up at a time, so a Helpr
  -- cannot take every nearby delivery at once to read the addresses
  -- (lh-authz-rls re-review #1, 2026-10-16).
  IF (SELECT count(*) FROM public.helpr_tasks x WHERE x.helpr_id = v_uid AND x.status = 'accepted') >= 2 THEN
    RAISE EXCEPTION 'too_many_taken' USING ERRCODE = '55000',
      HINT = 'Pick up one of your deliveries before you take another.';
  END IF;
  IF (SELECT count(*) FROM public.helpr_task_events e
       WHERE e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show')
         AND e.detail IS DISTINCT FROM 'seller_moved'
         AND e.created_at > now() - interval '7 days') >= 3 THEN
    RAISE EXCEPTION 'too_many_releases' USING ERRCODE = '55000',
      HINT = 'You backed out of or missed 3 deliveries this week. You can take new ones again in a few days.';
  END IF;
  IF p_pickup_slot_start IS NULL OR p_pickup_slot_start <= now()
     OR p_pickup_slot_start + interval '30 minutes' > t.latest_pickup_at
     OR NOT public.helpr_task_source_slot_ok(t.source_kind, t.source_id, p_pickup_slot_start) THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
      HINT = 'Pick a time in the future, inside the seller''s pickup times.';
  END IF;
  UPDATE public.helpr_tasks
     SET status = 'accepted', helpr_id = v_uid, accepted_at = now(), pickup_slot_start = p_pickup_slot_start, updated_at = now()
   WHERE id = t.id AND status = 'open';
  PERFORM public.helpr_task_log(t.id, 'accepted', v_uid, to_char(p_pickup_slot_start, 'YYYY-MM-DD"T"HH24:MI:SSOF'));
  PERFORM public.helpr_task_source_event(t.id, 'accepted', NULL);
  RETURN jsonb_build_object('result', 'accepted', 'pickup_slot_start', p_pickup_slot_start);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_accept(p_task_id uuid, p_pickup_slot_start timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_accept(p_task_id uuid, p_pickup_slot_start timestamp with time zone) TO authenticated, service_role;

-- helpr_task_buyer_choose: restated from 20261031231150_helpr_delivery_cant_finish.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_buyer_choose(p_task_id uuid, p_choice text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock (authz review 10-31): a stranger never locks someone else's delivery.
  IF NOT EXISTS (SELECT 1 FROM public.helpr_tasks x WHERE x.id = p_task_id AND x.customer_id = v_uid) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.stuck_fault IS DISTINCT FROM 'helpr' OR t.stuck_stage NOT IN ('returning', 'returned', 'awaiting_choice', 'collecting') THEN
    RAISE EXCEPTION 'nothing_to_choose' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_choice IS NULL OR p_choice NOT IN ('refund', 'repost', 'collect') THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  IF p_choice = 'collect' THEN
    IF t.stuck_stage NOT IN ('returning', 'collecting') THEN
      RAISE EXCEPTION 'too_late_to_collect' USING ERRCODE = '55000', HINT = 'The item is already back with the seller.';
    END IF;
    IF v_note IS NULL OR char_length(v_note) > 1000 THEN
      RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell the Helpr where and when you can meet.';
    END IF;
    UPDATE public.helpr_tasks SET stuck_choice = 'collect', stuck_stage = 'collecting', stuck_collect_note = v_note, updated_at = now() WHERE id = t.id;
    PERFORM public.helpr_task_log(t.id, 'buyer_choice', v_uid, 'collect');
    PERFORM public.declutter_notify(t.helpr_id, 'info', 'The buyer will collect it from you',
      format('See where and when on "%s".', t.title), '/declutter?tab=deliver', v_uid);
    RETURN jsonb_build_object('result', 'collecting');
  END IF;
  UPDATE public.helpr_tasks
     SET stuck_choice = p_choice, stuck_collect_note = NULL,
         stuck_stage = CASE WHEN t.stuck_stage = 'collecting' THEN 'returning' ELSE t.stuck_stage END, updated_at = now()
   WHERE id = t.id;
  PERFORM public.helpr_task_log(t.id, 'buyer_choice', v_uid, p_choice);
  IF t.stuck_stage = 'awaiting_choice' THEN
    RETURN public.declutter_delivery_return_finish(t.id);
  END IF;
  RETURN jsonb_build_object('result', 'chosen', 'choice', p_choice);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_buyer_choose(p_task_id uuid, p_choice text, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_buyer_choose(p_task_id uuid, p_choice text, p_note text) TO authenticated, service_role;

-- helpr_task_buyer_fix: restated from 20261031231150_helpr_delivery_cant_finish.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_buyer_fix(p_task_id uuid, p_note text, p_address text, p_lat numeric, p_lng numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_address text := NULLIF(btrim(COALESCE(p_address, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock (authz review 10-31): a stranger never locks someone else's delivery.
  IF NOT EXISTS (SELECT 1 FROM public.helpr_tasks x WHERE x.id = p_task_id AND x.customer_id = v_uid) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.stuck_stage IS DISTINCT FROM 'waiting_fix' THEN
    RAISE EXCEPTION 'nothing_to_fix' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF now() >= t.stuck_fix_by THEN
    RAISE EXCEPTION 'fix_too_late' USING ERRCODE = '55000', HINT = 'The 24 hours to fix this are over.';
  END IF;
  IF v_note IS NULL AND v_address IS NULL THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell the Helpr what changed.';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell the Helpr what changed (up to 1,000 characters).';
  END IF;
  IF v_address IS NOT NULL THEN
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    IF public.helpr_task_distance_m(p_lat, p_lng, t.dropoff_lat, t.dropoff_lng) > 40234 THEN
      RAISE EXCEPTION 'fix_too_far' USING ERRCODE = '22023', HINT = 'The new address has to be within 25 miles of the old one.';
    END IF;
    UPDATE public.helpr_tasks SET dropoff_address = v_address, dropoff_lat = p_lat, dropoff_lng = p_lng WHERE id = t.id;
  END IF;
  UPDATE public.helpr_tasks SET stuck_stage = 'retrying', stuck_fix_note = v_note, updated_at = now() WHERE id = t.id;
  PERFORM public.helpr_task_log(t.id, 'buyer_fix', v_uid, CASE WHEN v_address IS NULL THEN 'note' ELSE 'address' END);
  PERFORM public.declutter_notify(t.helpr_id, 'info', 'The buyer fixed it',
    format('Try "%s" once more. See what changed on the delivery.', t.title), '/declutter?tab=deliver', v_uid);
  RETURN jsonb_build_object('result', 'retrying');
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_buyer_fix(p_task_id uuid, p_note text, p_address text, p_lat numeric, p_lng numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_buyer_fix(p_task_id uuid, p_note text, p_address text, p_lat numeric, p_lng numeric) TO authenticated, service_role;

-- helpr_task_cant_finish: restated from 20261031231150_helpr_delivery_cant_finish.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_cant_finish(p_task_id uuid, p_reason text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  o public.declutter_orders;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_item text;
  v_problem uuid;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock (authz review 10-31): a stranger never locks someone else's delivery.
  IF NOT EXISTS (SELECT 1 FROM public.helpr_tasks x WHERE x.id = p_task_id AND x.helpr_id = v_uid) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.status <> 'picked_up' THEN
    RAISE EXCEPTION 'not_picked_up_yet' USING ERRCODE = '55000', HINT = 'Take the "Picked up" photo first.';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF t.stuck_stage IS NOT NULL AND t.stuck_stage <> 'retrying' THEN
    RAISE EXCEPTION 'already_reported' USING ERRCODE = '55000', HINT = 'You already reported this delivery. Follow the steps on it.';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('wrong_address', 'cant_get_in', 'nobody_there', 'wont_fit', 'cant_finish', 'damaged', 'other') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_reason IN ('damaged', 'other') AND v_note IS NULL THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  v_item := public.declutter_order_items_named(o.id);
  PERFORM public.helpr_task_log(t.id, 'cant_finish', v_uid, p_reason);
  IF p_reason IN ('damaged', 'other') THEN
    -- Louisiana Helpr decides, with the money held.
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
    VALUES (o.id, v_uid, 'helpr', p_reason, v_note, '{}')
    RETURNING id INTO v_problem;
    UPDATE public.helpr_tasks SET stuck_at = now(), stuck_reason = p_reason, stuck_note = v_note, updated_at = now() WHERE id = t.id;
    PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Your delivery is on hold',
      format('The Helpr reported a problem with %s. Louisiana Helpr looks at it and tells you what it decides. The money stays held until then.', v_item),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'declutter_sales', 'This delivery is on hold',
      format('The Helpr reported a problem with %s. Louisiana Helpr looks at it and tells you what it decides. The money stays held until then.', v_item),
      '/declutter?tab=selling', v_uid);
    -- Test stuff never reaches an admin (owner 2026-10-30; 20261030150104).
    IF NOT (t.is_seed OR o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id) OR public.is_test_subject(t.helpr_id)) THEN
      FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
        PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
          'A Helpr with an item reported a problem on a delivery. The money is held until you decide it.', '/admin');
      END LOOP;
    END IF;
    RETURN jsonb_build_object('result', 'with_admin', 'problem_id', v_problem);
  END IF;
  IF p_reason = 'cant_finish' THEN
    UPDATE public.helpr_tasks
       SET stuck_at = now(), stuck_reason = p_reason, stuck_note = v_note, stuck_fault = 'helpr', stuck_stage = 'returning',
           stuck_return_by = now() + interval '48 hours', updated_at = now()
     WHERE id = t.id;
    PERFORM public.helpr_task_give_job_strike(v_uid, 'delivery_backed_out', t.id, 'Could not finish a Helpr delivery after picking it up');
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'Your Helpr can''t finish this delivery',
      format('They have to take %s back to the seller within 48 hours. In Buying, choose a full refund, re-posting it for another Helpr, or collecting it from them.', v_item),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'declutter_sales', 'Your item is coming back',
      format('The Helpr can''t finish the delivery of %s and has to bring it back within 48 hours. Confirm in Selling when you have it.', v_item),
      '/declutter?tab=selling', v_uid);
    RETURN jsonb_build_object('result', 'returning', 'strike', true);
  END IF;
  -- Nobody's fault: one retry. A second report after it sends the item back.
  IF t.stuck_stage = 'retrying' THEN
    UPDATE public.helpr_tasks
       SET stuck_reason = p_reason, stuck_note = v_note, stuck_fault = 'none', stuck_stage = 'returning',
           stuck_return_by = now() + interval '48 hours', updated_at = now()
     WHERE id = t.id;
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'The delivery couldn''t be finished',
      format('The Helpr tried again and couldn''t leave %s, so it goes back to the seller and the sale is cancelled. You get back what you paid, less what the delivery cost, which pays the Helpr for the trip, and less the small part the card network kept for the payment, which it doesn''t give back. If you disagree, report a problem in Buying.', v_item),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'declutter_sales', 'Your item is coming back',
      format('The Helpr couldn''t leave %s and brings it back within 48 hours. Confirm in Selling when you have it.', v_item),
      '/declutter?tab=selling', v_uid);
    RETURN jsonb_build_object('result', 'returning', 'strike', false);
  END IF;
  UPDATE public.helpr_tasks
     SET stuck_at = now(), stuck_reason = p_reason, stuck_note = v_note, stuck_fault = 'none', stuck_stage = 'waiting_fix',
         stuck_fix_by = now() + interval '24 hours', updated_at = now()
   WHERE id = t.id;
  PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'Your Helpr can''t get to you',
    format('About %s. Fix it in Buying within 24 hours, and they try once more. If it isn''t fixed, it goes back to the seller and the sale is cancelled.', v_item),
    '/declutter?tab=buying', v_uid);
  RETURN jsonb_build_object('result', 'waiting_fix', 'strike', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_cant_finish(p_task_id uuid, p_reason text, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_cant_finish(p_task_id uuid, p_reason text, p_note text) TO authenticated, service_role;

-- helpr_task_customer_confirm: restated from 20261031231150_helpr_delivery_cant_finish.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_customer_confirm(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000', HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  -- CHANGED (BUY-36): the item is on its way back, so there is nothing to confirm.
  IF t.stuck_stage IN ('returning', 'returned', 'awaiting_choice') THEN
    RAISE EXCEPTION 'item_going_back' USING ERRCODE = '55000', HINT = 'This item is going back to the seller.';
  END IF;
  -- BUY-39: on the road is not "I got it". From the drop-off, or after 24 h in the Helpr's hands.
  -- CHANGED (BUY-36): except when the buyer collected it from a Helpr at fault (below).
  IF t.status = 'picked_up' AND t.stuck_stage IS DISTINCT FROM 'collecting'
     AND (t.picked_up_at IS NULL OR t.picked_up_at > now() - interval '24 hours') THEN
    RAISE EXCEPTION 'delivery_on_the_way' USING ERRCODE = '55000', HINT = 'The Helpr is bringing it. Tap I got it once it is dropped off.';
  END IF;
  -- CHANGED (BUY-36): the buyer collected it from a Helpr at fault: the sale goes ahead, the Helpr is unpaid, the delivery fee goes back.
  IF t.stuck_stage = 'collecting' THEN
    IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
      RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
        HINT = 'A problem was reported. Louisiana Helpr decides before anyone is paid.';
    END IF;
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'The buyer collected it from the Helpr', updated_at = now() WHERE id = t.id;
    PERFORM public.helpr_task_log(t.id, 'failed', v_uid, 'helpr fault: buyer collected');
    PERFORM public.declutter_delivery_refund(t.source_id, 'delivery_not_done');
    PERFORM public.declutter_notify(t.helpr_id, 'warning', 'Delivery closed',
      format('The buyer has "%s". You are not paid for this delivery.', t.title), '/declutter?tab=deliver', NULL);
  END IF;
  RETURN public.helpr_task_source_event(t.id, 'confirmed', 'customer');
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_customer_confirm(p_task_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_customer_confirm(p_task_id uuid) TO authenticated, service_role;

-- helpr_task_delivered: restated from 20261031231150_helpr_delivery_cant_finish.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_delivered(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric,
  p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'not_picked_up_yet' USING ERRCODE = '55000', HINT = 'Take the "Picked up" photo first.';
  END IF;
  -- CHANGED (BUY-36): reported as can't finish: only the retry may still drop it off.
  IF t.status = 'picked_up' AND t.stuck_stage IS NOT NULL AND t.stuck_stage <> 'retrying' THEN
    RAISE EXCEPTION 'delivery_on_hold' USING ERRCODE = '55000', HINT = 'You reported this delivery. Follow the steps on it.';
  END IF;
  -- No drop-off code any more (owner 2026-10-18): p_code is ignored, kept in
  -- the signature so an old build's call still parses; the door photo is the
  -- only drop-off.
  IF t.status = 'picked_up' THEN
    IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) OR p_photo_path = t.pickup_photo_path THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    v_m := public.helpr_task_distance_m(p_lat, p_lng, t.dropoff_lat, t.dropoff_lng);
    -- 200 m from the drop-off point.
    IF v_m IS NULL OR v_m > 200 THEN
      RAISE EXCEPTION 'not_at_dropoff' USING ERRCODE = '22023', HINT = 'Take the photo at the drop-off address.';
    END IF;
    UPDATE public.helpr_tasks
       SET status = 'delivered', delivered_at = now(), dropoff_photo_path = p_photo_path, dropoff_distance_m = v_m, updated_at = now()
     WHERE id = t.id AND status = 'picked_up';
    PERFORM public.helpr_task_log(t.id, 'delivered', v_uid, v_m::text || ' m');
  END IF;
  -- The "Delivered" notice goes out once, on the step itself; a repeat call
  -- on a task already at the door says so again without re-sending it
  -- (lh-silent-failure #5, lh-authz-rls #9).
  IF t.status = 'picked_up' THEN
    PERFORM public.helpr_task_source_event(t.id, 'delivered', NULL);
  END IF;
  RETURN jsonb_build_object('result', 'delivered', 'distance_m', v_m,
    'held', public.helpr_task_source_held(t.source_kind, t.source_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_delivered(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric, p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_delivered(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric, p_code text) TO authenticated, service_role;

-- helpr_task_picked_up: restated from 20261030012018_helpr_delivery_seller_handover.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_picked_up(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.status = 'picked_up' THEN
    RETURN jsonb_build_object('result', 'already_picked_up');
  END IF;
  IF t.status <> 'accepted' THEN
    RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  -- 20261030012018 (audit 1c #1): not before 30 minutes ahead of the booked pickup, unless the seller
  -- tapped "Handed over" for this Helpr. A NULL slot (never left by helpr_task_accept) is refused too.
  IF t.handed_over_to IS DISTINCT FROM v_uid
     AND (t.pickup_slot_start IS NULL OR now() < t.pickup_slot_start - interval '30 minutes') THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000',
      HINT = 'You can mark it picked up 30 minutes before the pickup time, or once the seller taps Handed over.';
  END IF;
  IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  v_m := public.helpr_task_distance_m(p_lat, p_lng, t.pickup_lat, t.pickup_lng);
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  UPDATE public.helpr_tasks SET status = 'picked_up', picked_up_at = now(), pickup_photo_path = p_photo_path, updated_at = now()
   WHERE id = t.id AND status = 'accepted';
  PERFORM public.helpr_task_log(t.id, 'picked_up', v_uid, v_m::text || ' m');
  PERFORM public.helpr_task_source_event(t.id, 'picked_up', NULL);
  RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_picked_up(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_picked_up(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric) TO authenticated, service_role;

-- helpr_task_pickup_no_show: restated from 20261017055505_declutter_helpr_delivery.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_pickup_no_show(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.status <> 'accepted' THEN
    RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
  END IF;
  IF now() < t.pickup_slot_start + interval '15 minutes' THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000', HINT = 'Wait 15 minutes after the pickup time.';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  -- Evidence, as for "Picked up": a photo taken at the pickup point (<= 200 m).
  -- The Helpr's word alone never cancels a sale (lh-authz-rls #3 /
  -- lh-money-escrow #5, 2026-10-16: a Helpr could take the item without
  -- tapping "Picked up" and then claim the seller was away).
  IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  v_m := public.helpr_task_distance_m(p_lat, p_lng, t.pickup_lat, t.pickup_lng);
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  PERFORM public.helpr_task_log(t.id, 'pickup_no_show', v_uid, format('%s m; photo %s', v_m, p_photo_path));
  -- The source decides through a person (Declutter: a problem for an admin).
  RETURN public.helpr_task_source_event(t.id, 'pickup_no_show', v_m::text || '|' || p_photo_path);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_pickup_no_show(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_pickup_no_show(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric) TO authenticated, service_role;

-- helpr_task_returned: restated from 20261031231150_helpr_delivery_cant_finish.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_returned(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock (authz review 10-31): a stranger never locks someone else's delivery.
  IF NOT EXISTS (SELECT 1 FROM public.helpr_tasks x WHERE x.id = p_task_id AND x.helpr_id = v_uid) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.stuck_stage = 'returned' THEN
    RETURN jsonb_build_object('result', 'already_returned');
  END IF;
  IF t.stuck_stage IS DISTINCT FROM 'returning' THEN
    RAISE EXCEPTION 'not_returning' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) OR p_photo_path = t.pickup_photo_path THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  v_m := public.helpr_task_distance_m(p_lat, p_lng, t.pickup_lat, t.pickup_lng);
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  UPDATE public.helpr_tasks
     SET stuck_stage = 'returned', returned_at = now(), return_photo_path = p_photo_path, return_distance_m = v_m,
         return_answer_by = now() + interval '24 hours', updated_at = now()
   WHERE id = t.id;
  PERFORM public.helpr_task_log(t.id, 'returned', v_uid, v_m::text || ' m');
  PERFORM public.declutter_notify(t.pickup_contact_id, 'declutter_sales', 'The Helpr says it''s back with you',
    format('About "%s". Confirm in Selling, or say it didn''t come back. If we don''t hear from you in 24 hours, we count it as back.', t.title),
    '/declutter?tab=selling', v_uid);
  RETURN jsonb_build_object('result', 'returned', 'distance_m', v_m);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_returned(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_returned(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric) TO authenticated, service_role;

-- helpr_task_seller_move_pickup: restated from 20261031095846_helpr_task_seller_move_pickup.sql.
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
  END IF;
  RETURN jsonb_build_object('result', 'moved', 'pickup_slot_start', p_pickup_slot_start);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_seller_move_pickup(p_task_id uuid, p_pickup_slot_start timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_seller_move_pickup(p_task_id uuid, p_pickup_slot_start timestamp with time zone) TO authenticated, service_role;

-- helpr_task_seller_return_answer: restated from 20261031231150_helpr_delivery_cant_finish.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_seller_return_answer(p_task_id uuid, p_back boolean, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_problem uuid;
  a record;
  o public.declutter_orders;  -- B36: was used below but never declared ("missing FROM-clause entry for table o")
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock (authz review 10-31): a stranger never locks someone else's delivery.
  IF NOT EXISTS (SELECT 1 FROM public.helpr_tasks x WHERE x.id = p_task_id AND x.pickup_contact_id = v_uid) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.pickup_contact_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.stuck_stage IS DISTINCT FROM 'returned' THEN
    RAISE EXCEPTION 'not_returned' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_back IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF p_back THEN
    RETURN public.declutter_delivery_return_finish(t.id);
  END IF;
  IF v_note IS NULL OR char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths, is_seed)
  VALUES (t.source_id, v_uid, 'seller', 'other', v_note, '{}', COALESCE(o.is_seed, false))
  RETURNING id INTO v_problem;
  PERFORM public.declutter_notify(t.helpr_id, 'warning', 'The seller says it didn''t come back',
    format('About "%s". Louisiana Helpr looks at it and tells you what it decides.', t.title), '/declutter?tab=deliver', v_uid);
  PERFORM public.declutter_notify(t.customer_id, 'warning', 'Your delivery is on hold',
    format('The seller says "%s" didn''t come back. Louisiana Helpr looks at it and tells you what it decides. The money stays held until then.', t.title),
    '/declutter?tab=buying', v_uid);
  -- Test stuff never reaches an admin (owner 2026-10-30; 20261030150104).
  IF NOT (t.is_seed OR o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id) OR public.is_test_subject(t.helpr_id)) THEN
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
        'A seller says a delivery a Helpr couldn''t finish didn''t come back. The money is held until you decide it.', '/admin');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('result', 'with_admin', 'problem_id', v_problem);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_seller_return_answer(p_task_id uuid, p_back boolean, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_seller_return_answer(p_task_id uuid, p_back boolean, p_note text) TO authenticated, service_role;

-- helpr_task_tip_start: restated from 20261101051951_tips_wait_for_helpr_id.sql.
CREATE OR REPLACE FUNCTION public.helpr_task_tip_start(p_task_id uuid, p_tip_cents integer, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  r public.helpr_task_tips;
  v_held boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_tip_cents IS NULL OR p_tip_cents < 300 OR p_tip_cents > 100000 OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'invalid_tip' USING ERRCODE = '22023', HINT = 'Tips are $3 to $1,000.';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  -- Only the delivery's own buyer: anyone else is told it does not exist.
  IF NOT FOUND OR t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM public.helpr_task_source_require_feature(t.source_kind);
  IF t.status <> 'confirmed' THEN
    RAISE EXCEPTION 'tip_not_yet' USING ERRCODE = '55000', HINT = 'You can add a tip once the delivery is done.';
  END IF;
  IF t.helpr_id IS NULL OR t.helpr_id = v_uid OR public.are_users_blocked(v_uid, t.helpr_id) THEN
    RAISE EXCEPTION 'tip_unavailable' USING ERRCODE = '55000', HINT = 'This delivery can''t take a tip.';
  END IF;
  -- Owner #3706: no payout account yet -> the tip is held with the delivery pay, which must still be waiting.
  v_held := NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL);
  IF v_held AND NOT EXISTS (SELECT 1 FROM public.helpr_task_payouts p
                             WHERE p.task_id = t.id AND p.status IN ('pending', 'failed', 'held_for_review')) THEN
    RAISE EXCEPTION 'tip_unavailable' USING ERRCODE = '55000', HINT = 'This delivery can''t take a tip.';
  END IF;
  -- BUY-43 (owner 2026-10-30): a tip waits until the Helpr has passed their one-time ID check, and no money is
  -- taken until then: refused here, before any tip row or Stripe page. payout_waits_on_identity is FALSE while
  -- the identity_check switch is off for the Helpr, or for an enrolled test account.
  IF public.payout_waits_on_identity(t.helpr_id) THEN
    RAISE EXCEPTION 'tip_waits_on_identity' USING ERRCODE = '55000',
      HINT = 'This Helpr can receive tips once verified. Nothing was charged.';
  END IF;
  INSERT INTO public.helpr_task_tips (task_id, tipper_id, helpr_id, tip_cents, attempt_id, held)
  VALUES (t.id, v_uid, t.helpr_id, p_tip_cents, p_attempt_id, v_held)
  ON CONFLICT (task_id, tipper_id, attempt_id, tip_cents) DO NOTHING;
  SELECT * INTO r FROM public.helpr_task_tips
   WHERE task_id = t.id AND tipper_id = v_uid AND attempt_id = p_attempt_id AND tip_cents = p_tip_cents;
  RETURN jsonb_build_object('tip_id', r.id, 'helpr_id', r.helpr_id, 'tip_cents', r.tip_cents, 'title', t.title,
    'payment_status', r.payment_status, 'stripe_session_id', r.stripe_session_id, 'held', r.held);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_tip_start(p_task_id uuid, p_tip_cents integer, p_attempt_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_tip_start(p_task_id uuid, p_tip_cents integer, p_attempt_id uuid) TO authenticated, service_role;

-- rentals_admin_lift_takedown: restated from 20261019071203_rentals_listing_photos_private.sql.
CREATE OR REPLACE FUNCTION public.rentals_admin_lift_takedown(p_property_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_p public.rental_properties%ROWTYPE;
  v_note text := btrim(coalesce(p_note, ''));
  v_ids uuid[];
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) < 5 OR char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_p FROM public.rental_properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND OR v_p.listings_taken_down_at IS NULL THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Round 3 #1 (purge vs lift): lock this property's queue entries first. A claim younger than 15 minutes
  -- means the purge cron may be deleting those objects right now: refuse (nothing changes; try again later)
  -- rather than restore listings whose photos are going. An older claim (a run that died part way, lead
  -- round 4 #2) may have removed some objects already: refuse too unless every claimed object is still in
  -- Storage (its storage.objects row; read only, never deleted here). Otherwise the entries are dropped.
  PERFORM 1 FROM public.rental_photo_purge_queue q
    JOIN public.rental_listings l ON l.id = public.rentals_photo_path_listing(q.storage_path)
   WHERE q.bucket_id = 'listing-photos' AND l.property_id = p_property_id
     FOR UPDATE OF q;
  IF EXISTS (SELECT 1 FROM public.rental_photo_purge_queue q
               JOIN public.rental_listings l ON l.id = public.rentals_photo_path_listing(q.storage_path)
              WHERE q.bucket_id = 'listing-photos' AND l.property_id = p_property_id
                AND (q.claimed_at > now() - interval '15 minutes'
                     OR (q.claimed_at IS NOT NULL
                         AND NOT EXISTS (SELECT 1 FROM storage.objects o
                                          WHERE o.bucket_id = 'listing-photos' AND o.name = q.storage_path)))) THEN
    RAISE EXCEPTION 'photos_purging' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.rental_photo_purge_queue q
   USING public.rental_listings l
   WHERE q.bucket_id = 'listing-photos' AND l.id = public.rentals_photo_path_listing(q.storage_path)
     AND l.property_id = p_property_id;
  UPDATE public.rental_properties SET listings_taken_down_at = NULL, listings_taken_down_reason = NULL WHERE id = p_property_id;
  WITH back AS (
    UPDATE public.rental_listings
       SET status = CASE WHEN removed_from_status = 'draft' THEN 'draft' ELSE 'paused' END,
           removed_by_admin = false, removed_reason = NULL, removed_from_status = NULL, updated_at = now()
     WHERE property_id = p_property_id AND removed_by_admin AND status = 'removed' AND removed_from_status IS NOT NULL
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM back;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'rentals_takedown_lifted', 'rental_property', p_property_id::text,
          jsonb_build_object('note', v_note, 'reason_was', v_p.listings_taken_down_reason, 'listings_restored', to_jsonb(v_ids)));
  PERFORM public.rentals_notify(v_p.owner_id, 'Listing back',
    'Louisiana Helpr lifted the removal of your listings at ' || v_p.label || '. Open them to publish again.', '/rentals', true, true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_lift_takedown(p_property_id uuid, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_lift_takedown(p_property_id uuid, p_note text) TO authenticated, service_role;

-- rentals_admin_remove_listing: restated from 20261019071203_rentals_listing_photos_private.sql.
CREATE OR REPLACE FUNCTION public.rentals_admin_remove_listing(p_listing_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_l public.rental_listings%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ids uuid[];
  v_paths text[];
BEGIN
  -- Moderation is never gated by the feature switch (review fix #7): an admin can take a listing down
  -- whatever the 'rentals' audience is.
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 5 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_l FROM public.rental_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Only a listing people can see or the owner can put back up (live or paused); history (sold, leased,
  -- removed) is not taken down (lead review must-fix 6).
  IF v_l.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'listing_not_live' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.rental_properties WHERE id = v_l.property_id FOR UPDATE;
  UPDATE public.rental_properties
     SET listings_taken_down_at = now(), listings_taken_down_reason = v_reason
   WHERE id = v_l.property_id;
  -- Every OPEN listing on the property goes, either kind, any unit (must-fix 2).
  WITH gone AS (
    UPDATE public.rental_listings
       SET removed_from_status = status, status = 'removed', removed_by_admin = true, removed_reason = v_reason,
           updated_at = now()
     WHERE property_id = v_l.property_id AND status IN ('draft', 'live', 'paused')
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM gone;
  -- Q2211 (round 3 #1, #2): the photos stay attached but unreachable (no ref resolves for a removed
  -- listing; the owner can no longer sign them), so a lift restores them. They are queued for the purge
  -- cron 30 days on; the cron skips (and drops) any whose listing was restored by a lift.
  -- Round 3 #4: EVERY object under each removed listing's folder is queued, attached or not (an upload never
  -- attached would otherwise stay forever: its owner can no longer read or delete it). Reading
  -- storage.objects is fine; only the cron deletes, through the Storage API.
  SELECT array_agg(DISTINCT x.path ORDER BY x.path) INTO v_paths
    FROM (SELECT ph.storage_path AS path FROM public.rental_listing_photos ph WHERE ph.listing_id = ANY (v_ids)
          UNION
          SELECT o.name FROM storage.objects o
            JOIN public.rental_listings l ON l.id = ANY (v_ids)
           WHERE o.bucket_id = 'listing-photos'
             AND split_part(o.name, '/', 1) = l.owner_id::text
             AND split_part(o.name, '/', 2) = 'rental-listings'
             AND split_part(o.name, '/', 3) = l.id::text) x;
  IF v_paths IS NOT NULL THEN
    INSERT INTO public.rental_photo_purge_queue (bucket_id, storage_path, due_at, reason)
    SELECT 'listing-photos', x, now() + interval '30 days', 'take-down of listing ' || p_listing_id::text FROM unnest(v_paths) x
    ON CONFLICT (bucket_id, storage_path) DO UPDATE SET due_at = EXCLUDED.due_at, reason = EXCLUDED.reason, claimed_at = NULL;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'rentals_listing_removed', 'rental_listing', p_listing_id::text,
          jsonb_build_object('reason', v_reason, 'kind', v_l.kind, 'status_before', v_l.status,
                             'property_id', v_l.property_id, 'listings_removed', to_jsonb(v_ids),
                             'photos_held', to_jsonb(coalesce(v_paths, ARRAY[]::text[])),
                             'photos_purge_after', now() + interval '30 days'));
  PERFORM public.rentals_notify(v_l.owner_id, 'Listing removed',
    'Louisiana Helpr removed your listing "' || v_l.headline || '": ' || v_reason, '/rentals', true, true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_remove_listing(p_listing_id uuid, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_remove_listing(p_listing_id uuid, p_reason text) TO authenticated, service_role;

-- rentals_file_request: restated from 20261017205605_rentals_maintenance_requests.sql.
CREATE OR REPLACE FUNCTION public.rentals_file_request(
  p_tenancy_id uuid,
  p_category text,
  p_description text,
  p_urgency text,
  p_access_windows text,
  p_pets_on_site boolean,
  p_ok_to_enter_alone boolean,
  p_access_notes text,
  p_photo_paths text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_p public.rental_properties%ROWTYPE;
  v_unit_label text;
  v_id uuid;
  v_auto boolean;
  v_leak text;
  v_path text;
  v_pos int := 0;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies
   WHERE id = p_tenancy_id AND tenant_id = v_uid AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO v_p FROM public.rental_properties WHERE id = v_t.property_id;
  SELECT label INTO v_unit_label FROM public.rental_units WHERE id = v_t.unit_id;
  IF p_urgency IS NULL OR p_urgency NOT IN ('emergency', 'soon', 'whenever') THEN
    RAISE EXCEPTION 'bad_urgency' USING ERRCODE = '22023';
  END IF;
  IF p_category IS NULL OR p_category !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'bad_category' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NULL OR char_length(btrim(p_description)) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'bad_description' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_access_windows, '')) > 300 OR char_length(coalesce(p_access_notes, '')) > 500 THEN
    RAISE EXCEPTION 'too_long' USING ERRCODE = '22023';
  END IF;
  -- The existing message filter rules (owner: maintenance uses them as-is).
  -- The private access notes (gate codes) are not scanned: digits there are
  -- codes, and only the landlord and the booked Helpr ever read them.
  v_leak := public.contact_leak_reason(p_description || ' ' || coalesce(p_access_windows, ''));
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION 'contact_info_not_allowed' USING ERRCODE = '22023', DETAIL = v_leak;
  END IF;
  IF coalesce(array_length(p_photo_paths, 1), 0) > 10 THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023';
  END IF;
  -- Rate limit: 20 requests a day per tenant, serialized per tenant (it also
  -- bounds emergency emails to the landlord; review #6).
  PERFORM pg_advisory_xact_lock(hashtext('rentals_file:' || v_uid::text));
  IF (SELECT count(*) FROM public.maintenance_requests
       WHERE tenant_id = v_uid AND created_at > now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION 'too_many_requests' USING ERRCODE = '22023';
  END IF;
  v_auto := p_urgency <> 'emergency' AND v_p.auto_approve_limit_cents IS NOT NULL;
  INSERT INTO public.maintenance_requests (
    tenancy_id, unit_id, property_id, tenant_id, landlord_id,
    property_label, unit_label, property_address,
    category, description, urgency, access_windows, pets_on_site, ok_to_enter_alone, access_notes,
    status, auto_approved, approved_budget_cents, decided_at)
  VALUES (
    v_t.id, v_t.unit_id, v_t.property_id, v_uid, v_t.landlord_id,
    v_p.label, coalesce(v_unit_label, ''), v_p.street_address || ', ' || v_p.city || ', LA ' || v_p.zip_code,
    p_category, btrim(p_description), p_urgency, btrim(coalesce(p_access_windows, '')),
    coalesce(p_pets_on_site, false), coalesce(p_ok_to_enter_alone, false), btrim(coalesce(p_access_notes, '')),
    CASE WHEN v_auto THEN 'approved' ELSE 'submitted' END, v_auto,
    CASE WHEN v_auto THEN v_p.auto_approve_limit_cents END,
    CASE WHEN v_auto THEN now() END)
  RETURNING id INTO v_id;
  IF p_photo_paths IS NOT NULL THEN
    FOREACH v_path IN ARRAY p_photo_paths LOOP
      IF v_path IS NULL OR v_path !~ format('^%s/rentals/requests/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$', v_uid) THEN
        RAISE EXCEPTION 'bad_photo_path' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.maintenance_request_photos (request_id, tenant_id, storage_path, position)
      VALUES (v_id, v_uid, v_path, v_pos);
      v_pos := v_pos + 1;
    END LOOP;
  END IF;
  IF p_urgency = 'emergency' THEN
    PERFORM public.rentals_notify(v_t.landlord_id, 'EMERGENCY maintenance request',
      'Your tenant at ' || v_p.label || ' reported an emergency. Open the request now.',
      '/rentals/requests/' || v_id::text, true);
  ELSIF v_auto THEN
    PERFORM public.rentals_notify(v_t.landlord_id, 'Repair ready to post',
      'A maintenance request at ' || v_p.label || ' was auto-approved. Post the job to send a Helpr.',
      '/rentals/requests/' || v_id::text, false);
  ELSE
    PERFORM public.rentals_notify(v_t.landlord_id, 'New maintenance request',
      'Your tenant at ' || v_p.label || ' sent a maintenance request.',
      '/rentals/requests/' || v_id::text, false);
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_file_request(p_tenancy_id uuid, p_category text, p_description text, p_urgency text, p_access_windows text, p_pets_on_site boolean, p_ok_to_enter_alone boolean, p_access_notes text, p_photo_paths text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_file_request(p_tenancy_id uuid, p_category text, p_description text, p_urgency text, p_access_windows text, p_pets_on_site boolean, p_ok_to_enter_alone boolean, p_access_notes text, p_photo_paths text[]) TO authenticated, service_role;

-- rentals_save_listing: restated from 20261019061241_rentals_sale_listings.sql.
CREATE OR REPLACE FUNCTION public.rentals_save_listing(p_listing_id uuid, p_unit_id uuid, p_fields jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_unit public.rental_units%ROWTYPE;
  v_prop_status text;
  v_l public.rental_listings%ROWTYPE;
  v_flags text[];
  v_id uuid;
  v_bad text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF NOT public.is_identity_verified(v_uid) THEN
    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'bad_listing' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_fields) AS k
   WHERE k NOT IN ('headline', 'description', 'rent_cents', 'rent_frequency', 'deposit_cents', 'beds', 'baths', 'sq_ft',
                   'available_on', 'lease_months_min', 'lease_months_max', 'pets', 'pet_rules', 'parking',
                   'utilities_included', 'accepts_vouchers', 'accessibility')
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'bad_listing' USING ERRCODE = '22023', DETAIL = v_bad;
  END IF;

  IF p_listing_id IS NULL THEN
    SELECT * INTO v_unit FROM public.rental_units WHERE id = p_unit_id AND owner_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'PT404';
    END IF;
  ELSE
    v_l := public.rentals_lock_own_listing(p_listing_id, v_uid);
    -- A sale listing is edited by rentals_save_sale_listing (20261019061241), never here.
    IF v_l.kind <> 'rent' THEN
      RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF v_l.status = 'removed' THEN
      RAISE EXCEPTION 'listing_not_editable' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_unit FROM public.rental_units WHERE id = v_l.unit_id;
  END IF;
  SELECT ownership_status INTO v_prop_status FROM public.rental_properties WHERE id = v_unit.property_id AND owner_id = v_uid;
  IF v_prop_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'ownership_not_approved' USING ERRCODE = '42501';
  END IF;

  v_flags := public.rentals_listing_wording_flags(
    concat_ws(' ', p_fields ->> 'headline', p_fields ->> 'description', p_fields ->> 'pet_rules'));
  -- A live listing never becomes discriminatory: an edit that adds a flagged phrase is refused.
  IF p_listing_id IS NOT NULL AND v_l.status = 'live' AND cardinality(v_flags) > 0 THEN
    RAISE EXCEPTION 'wording_flagged' USING ERRCODE = '22023', DETAIL = array_to_string(v_flags, ', ');
  END IF;

  BEGIN
    IF p_listing_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.rental_listings WHERE unit_id = v_unit.id AND status IN ('draft', 'live', 'paused')) THEN
        RAISE EXCEPTION 'unit_already_listed' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.rental_listings (
        unit_id, property_id, owner_id, headline, description, rent_cents, rent_frequency, deposit_cents, beds, baths,
        sq_ft, available_on, lease_months_min, lease_months_max, pets, pet_rules, parking, utilities_included,
        accepts_vouchers, accessibility, wording_flags)
      VALUES (
        v_unit.id, v_unit.property_id, v_uid,
        btrim(p_fields ->> 'headline'),
        COALESCE(btrim(p_fields ->> 'description'), ''),
        (p_fields ->> 'rent_cents')::integer,
        COALESCE(p_fields ->> 'rent_frequency', 'monthly'),
        (p_fields ->> 'deposit_cents')::integer,
        (p_fields ->> 'beds')::numeric,
        (p_fields ->> 'baths')::numeric,
        (p_fields ->> 'sq_ft')::integer,
        (p_fields ->> 'available_on')::date,
        (p_fields ->> 'lease_months_min')::smallint,
        (p_fields ->> 'lease_months_max')::smallint,
        COALESCE(p_fields ->> 'pets', 'ask'),
        COALESCE(btrim(p_fields ->> 'pet_rules'), ''),
        COALESCE(p_fields ->> 'parking', 'none'),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'utilities_included')), '{}'),
        COALESCE(p_fields ->> 'accepts_vouchers', 'ask'),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'accessibility')), '{}'),
        v_flags)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.rental_listings SET
        headline = btrim(p_fields ->> 'headline'),
        description = COALESCE(btrim(p_fields ->> 'description'), ''),
        rent_cents = (p_fields ->> 'rent_cents')::integer,
        rent_frequency = COALESCE(p_fields ->> 'rent_frequency', 'monthly'),
        deposit_cents = (p_fields ->> 'deposit_cents')::integer,
        beds = (p_fields ->> 'beds')::numeric,
        baths = (p_fields ->> 'baths')::numeric,
        sq_ft = (p_fields ->> 'sq_ft')::integer,
        available_on = (p_fields ->> 'available_on')::date,
        lease_months_min = (p_fields ->> 'lease_months_min')::smallint,
        lease_months_max = (p_fields ->> 'lease_months_max')::smallint,
        pets = COALESCE(p_fields ->> 'pets', 'ask'),
        pet_rules = COALESCE(btrim(p_fields ->> 'pet_rules'), ''),
        parking = COALESCE(p_fields ->> 'parking', 'none'),
        utilities_included = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'utilities_included')), '{}'),
        accepts_vouchers = COALESCE(p_fields ->> 'accepts_vouchers', 'ask'),
        accessibility = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'accessibility')), '{}'),
        wording_flags = v_flags,
        updated_at = now()
       WHERE id = p_listing_id
      RETURNING id INTO v_id;
    END IF;
  EXCEPTION
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range
         OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'bad_listing' USING ERRCODE = '22023';
    WHEN unique_violation THEN
      RAISE EXCEPTION 'unit_already_listed' USING ERRCODE = '22023';
  END;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_save_listing(p_listing_id uuid, p_unit_id uuid, p_fields jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_save_listing(p_listing_id uuid, p_unit_id uuid, p_fields jsonb) TO authenticated, service_role;

-- rentals_save_sale_listing: restated from 20261019061241_rentals_sale_listings.sql.
CREATE OR REPLACE FUNCTION public.rentals_save_sale_listing(p_listing_id uuid, p_property_id uuid, p_fields jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_property uuid;
  v_prop_status text;
  v_l public.rental_listings%ROWTYPE;
  v_flags text[];
  v_id uuid;
  v_bad text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF NOT public.is_identity_verified(v_uid) THEN
    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'bad_listing' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_fields) AS k
   WHERE k NOT IN ('headline', 'description', 'sale_price_cents', 'beds', 'baths', 'sq_ft', 'lot_sq_ft', 'year_built',
                   'parking', 'accessibility')
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'bad_listing' USING ERRCODE = '22023', DETAIL = v_bad;
  END IF;

  IF p_listing_id IS NULL THEN
    v_property := p_property_id;
  ELSE
    v_l := public.rentals_lock_own_listing(p_listing_id, v_uid);
    -- A rent listing is edited by rentals_save_listing; a stranger's id was already P0002.
    IF v_l.kind <> 'sale' THEN
      RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF v_l.status IN ('removed', 'sold') THEN
      RAISE EXCEPTION 'listing_not_editable' USING ERRCODE = '22023';
    END IF;
    v_property := v_l.property_id;
  END IF;
  SELECT ownership_status INTO v_prop_status FROM public.rental_properties WHERE id = v_property AND owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_prop_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'ownership_not_approved' USING ERRCODE = '42501';
  END IF;

  v_flags := public.homes_sale_wording_flags(concat_ws(' ', p_fields ->> 'headline', p_fields ->> 'description'));
  -- A live listing never gains a flagged phrase: such an edit is refused.
  IF p_listing_id IS NOT NULL AND v_l.status = 'live' AND cardinality(v_flags) > 0 THEN
    RAISE EXCEPTION 'sale_wording_flagged' USING ERRCODE = '22023', DETAIL = array_to_string(v_flags, ', ');
  END IF;

  BEGIN
    IF p_listing_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.rental_listings
                  WHERE property_id = v_property AND kind = 'sale' AND status IN ('draft', 'live', 'paused')) THEN
        RAISE EXCEPTION 'property_already_listed' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.rental_listings (
        kind, unit_id, property_id, owner_id, headline, description, sale_price_cents, beds, baths, sq_ft, lot_sq_ft,
        year_built, parking, accessibility, wording_flags)
      VALUES (
        'sale', NULL, v_property, v_uid,
        btrim(p_fields ->> 'headline'),
        COALESCE(btrim(p_fields ->> 'description'), ''),
        (p_fields ->> 'sale_price_cents')::bigint,
        (p_fields ->> 'beds')::numeric,
        (p_fields ->> 'baths')::numeric,
        (p_fields ->> 'sq_ft')::integer,
        (p_fields ->> 'lot_sq_ft')::integer,
        (p_fields ->> 'year_built')::smallint,
        COALESCE(p_fields ->> 'parking', 'none'),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'accessibility')), '{}'),
        v_flags)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.rental_listings SET
        headline = btrim(p_fields ->> 'headline'),
        description = COALESCE(btrim(p_fields ->> 'description'), ''),
        sale_price_cents = (p_fields ->> 'sale_price_cents')::bigint,
        beds = (p_fields ->> 'beds')::numeric,
        baths = (p_fields ->> 'baths')::numeric,
        sq_ft = (p_fields ->> 'sq_ft')::integer,
        lot_sq_ft = (p_fields ->> 'lot_sq_ft')::integer,
        year_built = (p_fields ->> 'year_built')::smallint,
        parking = COALESCE(p_fields ->> 'parking', 'none'),
        accessibility = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'accessibility')), '{}'),
        wording_flags = v_flags,
        updated_at = now()
       WHERE id = p_listing_id
      RETURNING id INTO v_id;
    END IF;
  EXCEPTION
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range
         OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'bad_listing' USING ERRCODE = '22023';
    WHEN unique_violation THEN
      RAISE EXCEPTION 'property_already_listed' USING ERRCODE = '22023';
  END;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_save_sale_listing(p_listing_id uuid, p_property_id uuid, p_fields jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_save_sale_listing(p_listing_id uuid, p_property_id uuid, p_fields jsonb) TO authenticated, service_role;

-- rentals_set_rent_plan: restated from 20261019073106_rentals_rent_tracker.sql.
CREATE OR REPLACE FUNCTION public.rentals_set_rent_plan(p_tenancy_id uuid, p_fields jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_amount integer;
  v_freq text;
  v_first date;
  v_grace integer;
  v_fee integer;
  v_methods text[];
  v_lease date;
  v_today date := public.shop_local_today();
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id FOR UPDATE;
  IF NOT FOUND OR v_t.landlord_id IS DISTINCT FROM v_uid OR v_t.status <> 'active' THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_fields) k
                 WHERE k NOT IN ('amount_cents', 'frequency', 'first_due_on', 'grace_days', 'late_fee_cents', 'pay_methods',
                                 'lease_ends_on')) THEN
    RAISE EXCEPTION 'bad_rent_plan' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_amount := (p_fields ->> 'amount_cents')::integer;
    v_freq := p_fields ->> 'frequency';
    v_first := (p_fields ->> 'first_due_on')::date;
    v_grace := COALESCE((p_fields ->> 'grace_days')::integer, 0);
    v_fee := COALESCE((p_fields ->> 'late_fee_cents')::integer, 0);
    v_methods := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'pay_methods')), '{}'::text[]);
    -- Omitted = keep the stored date; an explicit null clears it (lead review round 2 #7).
    v_lease := CASE WHEN p_fields ? 'lease_ends_on' THEN (p_fields ->> 'lease_ends_on')::date ELSE v_t.lease_ends_on END;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bad_rent_plan' USING ERRCODE = '22023';
  END;
  IF v_amount IS NULL OR v_amount NOT BETWEEN 100 AND 10000000
     OR v_freq IS NULL OR v_freq NOT IN ('weekly', 'biweekly', 'monthly')
     OR v_first IS NULL
     -- The first due date is today or later (no back-dated charges), and within a year.
     OR v_first < v_today OR v_first > v_today + 366
     OR (v_freq = 'monthly' AND extract(day FROM v_first) > 28)
     OR v_grace NOT BETWEEN 0 AND 30
     OR v_fee NOT BETWEEN 0 AND 10000000
     OR NOT (v_methods <@ ARRAY['zelle', 'venmo', 'cashapp', 'cash', 'check', 'money_order']::text[])
     OR cardinality(v_methods) = 0
     -- A NEW lease end date is at least 30 days out (an unchanged one may be closer): the landlord cannot
     -- set it to today and end the tenancy to read the tenant's forwarding address (lead review #4).
     OR (v_lease IS DISTINCT FROM v_t.lease_ends_on AND v_lease IS NOT NULL AND (v_lease < v_today + 30 OR v_lease > v_today + 3660)) THEN
    RAISE EXCEPTION 'bad_rent_plan' USING ERRCODE = '22023';
  END IF;
  IF v_lease IS DISTINCT FROM v_t.lease_ends_on THEN
    UPDATE public.rental_tenancies SET lease_ends_on = v_lease WHERE id = p_tenancy_id;
  END IF;
  INSERT INTO public.rental_rent_plans (tenancy_id, amount_cents, frequency, first_due_on, grace_days, late_fee_cents, pay_methods)
  VALUES (p_tenancy_id, v_amount, v_freq, v_first, v_grace, v_fee, v_methods)
  ON CONFLICT (tenancy_id) DO UPDATE SET
    amount_cents = EXCLUDED.amount_cents, frequency = EXCLUDED.frequency, first_due_on = EXCLUDED.first_due_on,
    grace_days = EXCLUDED.grace_days, late_fee_cents = EXCLUDED.late_fee_cents, pay_methods = EXCLUDED.pay_methods,
    -- reminded_for stays: an edit on a reminder day never sends that day's reminder twice (lead review #9).
    updated_at = now();
  PERFORM public.rentals_notify(v_t.tenant_id, 'Rent schedule set',
    'Your landlord set your rent schedule. See it under Homes -> Renting.', '/rentals', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_rent_plan(p_tenancy_id uuid, p_fields jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_rent_plan(p_tenancy_id uuid, p_fields jsonb) TO authenticated, service_role;

-- rentals_settle_deposit: restated from 20261019082216_rentals_deposit_tracker.sql.
CREATE OR REPLACE FUNCTION public.rentals_settle_deposit(p_tenancy_id uuid, p_returned_cents integer, p_deductions jsonb, p_returned_on date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_d public.rental_deposits%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_reason text;
  v_cents integer;
  v_kept bigint := 0;
  v_lines text := '';
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  IF NOT FOUND OR v_t.landlord_id IS DISTINCT FROM v_uid OR v_t.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO v_d FROM public.rental_deposits WHERE tenancy_id = p_tenancy_id FOR UPDATE;
  IF NOT FOUND OR v_d.amount_cents IS NULL THEN
    RAISE EXCEPTION 'deposit_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_d.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'deposit_settled' USING ERRCODE = '22023';
  END IF;
  -- Settled after the tenancy ends (the return clock starts then).
  IF v_t.status <> 'ended' THEN
    RAISE EXCEPTION 'tenancy_not_ended' USING ERRCODE = '22023';
  END IF;
  IF p_deductions IS NULL OR jsonb_typeof(p_deductions) <> 'array' OR jsonb_array_length(p_deductions) > 20 THEN
    RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_deductions) LOOP
    BEGIN
      v_reason := btrim(v_item ->> 'reason');
      v_cents := (v_item ->> 'amount_cents')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
    END;
    IF jsonb_typeof(v_item) <> 'object' OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 200
       OR v_cents IS NULL OR v_cents < 1 THEN
      RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
    END IF;
    v_kept := v_kept + v_cents;
    v_items := v_items || jsonb_build_array(jsonb_build_object('reason', v_reason, 'amount_cents', v_cents));
    v_lines := v_lines || E'\n- ' || v_reason || ': ' || to_char(v_cents / 100.0, 'FM$999,999,990.00');
  END LOOP;
  IF p_returned_cents IS NULL OR p_returned_cents < 0 OR p_returned_cents + v_kept <> v_d.amount_cents
     OR p_returned_on IS NULL OR p_returned_on > public.shop_local_today() OR p_returned_on < v_d.received_on THEN
    RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_deposits
     SET returned_cents = p_returned_cents, deductions = v_items, returned_on = p_returned_on, settled_at = now(), updated_at = now()
   WHERE tenancy_id = p_tenancy_id;
  PERFORM public.rentals_notify(v_t.tenant_id, 'Deposit statement',
    'Your landlord returned ' || to_char(p_returned_cents / 100.0, 'FM$999,999,990.00') || ' of your '
      || to_char(v_d.amount_cents / 100.0, 'FM$999,999,990.00') || ' deposit on ' || to_char(p_returned_on, 'FMMon FMDD, YYYY') || '.'
      || CASE WHEN v_kept > 0 THEN ' Kept, itemized:' || v_lines ELSE ' Nothing was kept.' END,
    '/rentals', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_settle_deposit(p_tenancy_id uuid, p_returned_cents integer, p_deductions jsonb, p_returned_on date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_settle_deposit(p_tenancy_id uuid, p_returned_cents integer, p_deductions jsonb, p_returned_on date) TO authenticated, service_role;

-- rpc_helper_mark_done: restated from 20261101034159_declutter_list_for_seller.sql.
CREATE OR REPLACE FUNCTION public.rpc_helper_mark_done(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- `record`, not `public.jobs`, so the function body does not bind the jobs
  -- rowtype at CREATE time (keeps this file creatable on a from-scratch replay
  -- before jobs exists, and matches the trigger's skip guard below).
  v_job record;
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: a double tap must not run two stamps against one row.
  SELECT * INTO v_job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404';
  END IF;

  IF v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_the_assigned_helper' USING ERRCODE = '42501';
  END IF;

  -- Already done: keep the FIRST stamp and report state.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'already_done', true,
      'helper_completed_at', v_job.helper_completed_at,
      'poster_completed_at', v_job.poster_completed_at
    );
  END IF;

  IF v_job.status::text NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_completable' USING ERRCODE = '42501',
      HINT = 'This job is no longer active (status=' || v_job.status::text || '), so it cannot be marked done.';
  END IF;

  -- The gate checks below mirror enforce_helper_completion_gates, which is
  -- AUTHORITATIVE: it fires on this UPDATE too (its trigger is BEFORE UPDATE OF
  -- helper_completed_at, status, and auth.uid() is still the Helpr inside this
  -- definer). These give the Helpr a clean, specific refusal before the write;
  -- if the two ever drift, the trigger still fails closed. Keep them in step.
  --
  -- Arrival established = the poster's confirmation, GPS or no GPS (owner,
  -- 2026-09-19; the exact predicate the trigger enforces on the write).
  IF v_job.poster_confirmed_arrival_at IS NULL
     AND v_job.helper_arrival_verified_at IS NULL THEN  -- GPS skips the tap (2026-10-08)
    RAISE EXCEPTION 'completion_requires_confirmed_arrival' USING ERRCODE = '23514',
      HINT = 'The person who posted this job has to tap Confirm They Arrived before you can mark it complete.';
  END IF;

  -- LEAD-LIST-FOR-SELLER: a Have-a-Helpr-list-it job waits until its listings are sent (the trigger's rule, said first).
  IF v_job.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_sent(v_job.id) THEN
    RAISE EXCEPTION 'completion_requires_listings_sent' USING ERRCODE = '23514',
      HINT = 'Send the listings to the seller for approval first, then mark the job done.';
  END IF;
  IF COALESCE(v_job.require_photo_proof, true)
     AND (COALESCE(array_length(v_job.proof_before_urls, 1), 0) = 0
          OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) = 0) THEN
    RAISE EXCEPTION 'completion_requires_proof_photos' USING ERRCODE = '23514',
      HINT = 'Add before and after photos before marking the job done.';
  END IF;

  -- From the Helpr's own arrival (audit 2026-10-28 F12), as the trigger.
  IF LEAST(v_job.poster_confirmed_working_at, v_job.helper_arrived_at) IS NOT NULL
     AND v_now - LEAST(v_job.poster_confirmed_working_at, v_job.helper_arrived_at) < interval '30 minutes' THEN
    RAISE EXCEPTION 'completion_min_work_time' USING ERRCODE = '23514',
      HINT = 'A job can be marked done 30 minutes after you arrived.';
  END IF;

  -- THE STAMP. The server clock, never a client-chosen time. Conditional on the
  -- live status and an unset stamp so a cancel / release / stamp that committed
  -- between the SELECT and here wins the race and this no-ops rather than
  -- reviving a job that moved on.
  UPDATE public.jobs
     SET helper_completed_at = v_now
   WHERE id = _job_id
     AND helper_completed_at IS NULL
     AND status IN ('accepted', 'in_progress', 'revision_requested');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_completable' USING ERRCODE = '42501',
      HINT = 'This job is no longer active, so it cannot be marked done.';
  END IF;

  RETURN jsonb_build_object(
    'already_done', false,
    'helper_completed_at', v_now,
    'poster_completed_at', v_job.poster_completed_at
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rpc_helper_mark_done(_job_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_helper_mark_done(_job_id uuid) TO authenticated, service_role;

-- rpc_poster_confirm_member_arrival: restated from 20260919192559_group_roster_per_member_lifecycle.sql.
CREATE OR REPLACE FUNCTION public.rpc_poster_confirm_member_arrival(_job_id uuid, _helper_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_customer uuid;
  v_status text;
  v_now timestamptz := now();
  v_stamp timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT j.customer_id, j.status::text INTO v_customer, v_status
    FROM public.jobs j WHERE j.id = _job_id;
  IF v_customer IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_the_poster' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514';
  END IF;

  v_slot := public.group_member_slot(_job_id, _helper_id);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = 'PT404';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;

  -- The poster confirms an arrival that EXISTS. Under the 2026-09-19 rule a
  -- Helpr can always record one, so there is no case where this is unreachable.
  IF v_row.helper_arrived_at IS NULL THEN
    RAISE EXCEPTION 'arrival_confirm_before_arrival' USING ERRCODE = '23514',
      HINT = 'That Helpr has not marked arrived yet.';
  END IF;

  UPDATE public.group_job_helpers
     SET poster_confirmed_arrival_at = COALESCE(poster_confirmed_arrival_at, v_now),
         poster_confirmed_working_at = COALESCE(poster_confirmed_working_at, v_now)
   WHERE id = v_slot
   RETURNING poster_confirmed_arrival_at INTO v_stamp;

  RETURN jsonb_build_object('poster_confirmed_arrival_at', v_stamp);
END;
$function$;
REVOKE ALL ON FUNCTION public.rpc_poster_confirm_member_arrival(_job_id uuid, _helper_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_poster_confirm_member_arrival(_job_id uuid, _helper_id uuid) TO authenticated, service_role;

-- shops_accept_order: restated from 20261018164442_shops_orders_checkout.sql.
CREATE OR REPLACE FUNCTION public.shops_accept_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_cap smallint;
  l record;
  v_block text;
  v_home_food bigint;
  v_cottage_cap bigint;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'accepted' THEN
    -- A retry after the capture step failed to answer: the edge function captures again (idempotent).
    -- Not re-checked for a block made since: the order was accepted (hired) before it, as for every hire.
    RETURN jsonb_build_object('result', 'already_accepted', 'order_id', o.id, 'captured', o.captured_at IS NOT NULL);
  END IF;
  IF o.status <> 'held' THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000', HINT = 'This order is no longer waiting for an answer.';
  END IF;
  IF now() > o.accept_by THEN
    RAISE EXCEPTION 'order_expired' USING ERRCODE = '55000', HINT = 'The 24 hours to accept have passed.';
  END IF;
  -- The maker must be able to be paid at handover (L3: payout setup) and in good standing.
  v_block := public.shop_owner_sell_block_reason(v_uid);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block USING ERRCODE = '42501';
  END IF;
  -- The buyer must still be able to buy from this maker (a block or a ban
  -- since the order was sent): the maker declines instead, and the hold drops.
  -- A block is refused on its own, before any write, with the code every hire
  -- RPC uses (Q345, hireRefusedAcrossBlock; its words never say who blocked).
  IF public.are_users_blocked(v_uid, o.buyer_id) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501',
      HINT = 'This order can no longer be accepted. Decline it so the buyer''s hold is released.';
  END IF;
  IF o.buyer_id IS NULL OR EXISTS (
       SELECT 1 FROM public.profiles pr
        WHERE pr.user_id = o.buyer_id
          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now())) THEN
    RAISE EXCEPTION 'buyer_unavailable' USING ERRCODE = '55000',
      HINT = 'This order can no longer be accepted. Decline it so the buyer''s hold is released.';
  END IF;
  -- Every accept of this shop is serialized on the shop row (FOR UPDATE), so
  -- two accepts at once cannot both take the day's last slot (L22) or both
  -- fit under the home-food yearly limit (L8). Only accepted orders count now.
  SELECT daily_order_cap INTO v_cap FROM public.shops WHERE id = o.shop_id FOR UPDATE;
  -- A shop Louisiana Helpr hid takes no money (lh-authz-rls review, 2026-10-18).
  IF EXISTS (SELECT 1 FROM public.shops WHERE id = o.shop_id AND hidden_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501',
      HINT = 'Louisiana Helpr hid your shop, so it cannot accept orders. Decline them so the buyers'' holds are released.';
  END IF;
  IF v_cap IS NOT NULL AND public.shop_day_count(v_uid, o.ready_date, ARRAY['accepted', 'handed_over']) >= v_cap THEN
    RAISE EXCEPTION 'day_full' USING ERRCODE = '55000', HINT = 'You already accepted your most orders for that day.';
  END IF;
  -- L8 at acceptance: sales already counted + accepted orders not yet charged
  -- + this order's home-food lines must stay within the yearly limit.
  SELECT COALESCE(sum(line_cents), 0) INTO v_home_food FROM public.shop_order_lines
   WHERE order_id = o.id AND kind = 'home_food';
  IF v_home_food > 0 THEN
    SELECT c.cap_cents INTO v_cottage_cap FROM public.shop_cottage_settings c WHERE c.id;
    IF v_cottage_cap IS NULL OR public.shop_cottage_sales_cents(v_uid)
         + (SELECT COALESCE(sum(ol.line_cents), 0) FROM public.shop_orders x
              JOIN public.shop_order_lines ol ON ol.order_id = x.id AND ol.kind = 'home_food'
             WHERE x.seller_id = v_uid AND x.status = 'accepted' AND x.captured_at IS NULL AND x.id <> o.id)
         + v_home_food > v_cottage_cap THEN
      RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
        HINT = 'Accepting this order would go over your yearly home-food sales limit. Decline it so the buyer''s hold is released.';
    END IF;
  END IF;
  -- L20: stock is taken at acceptance, items locked in id order (no deadlock between two accepts).
  FOR l IN
    SELECT ol.item_id, ol.quantity, i.stock_count, i.title
      FROM public.shop_order_lines ol JOIN public.shop_items i ON i.id = ol.item_id
     WHERE ol.order_id = o.id
     ORDER BY ol.item_id
       FOR UPDATE OF i
  LOOP
    IF l.stock_count IS NOT NULL AND l.stock_count < l.quantity THEN
      RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
        HINT = format('You have %s of "%s" left; this order needs %s.', l.stock_count, l.title, l.quantity);
    END IF;
  END LOOP;
  UPDATE public.shop_items i SET stock_count = i.stock_count - ol.quantity, updated_at = now()
    FROM public.shop_order_lines ol
   WHERE ol.order_id = o.id AND ol.item_id = i.id AND i.stock_count IS NOT NULL;
  UPDATE public.shop_orders SET status = 'accepted', accepted_at = now() WHERE id = o.id;
  RETURN jsonb_build_object('result', 'accepted', 'order_id', o.id, 'captured', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_accept_order(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_accept_order(p_order_id uuid) TO authenticated, service_role;

-- shops_admin_review_item: restated from 20261017061157_shops_items.sql.
CREATE OR REPLACE FUNCTION public.shops_admin_review_item(p_item_id uuid, p_approve boolean, p_note text, p_submitted_at timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_shop uuid;
  v_kind text;
  v_submitted timestamptz;
  v_status text;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required' USING ERRCODE = '22023',
      HINT = 'Say why the item is not approved.';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT owner_id, shop_id, kind, submitted_at INTO v_owner, v_shop, v_kind, v_submitted
    FROM public.shop_items WHERE id = p_item_id AND status = 'pending_review' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = '22023';
  END IF;
  IF v_submitted IS DISTINCT FROM p_submitted_at THEN
    RAISE EXCEPTION 'item_changed' USING ERRCODE = '22023',
      HINT = 'The owner changed this item after you opened it. Reload and review it again.';
  END IF;
  -- An admin never reviews their own item.
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '42501', HINT = 'Another admin must review your own item.';
  END IF;
  -- Approval puts the item in front of members NOW, so the owner must still
  -- be allowed to sell now (not banned, under 3 marketplace strikes, 18+,
  -- payouts set up), the shop must not be hidden, and a home-food item's
  -- owner must not be at the yearly limit.
  IF p_approve AND (
       public.shop_owner_sell_block_reason(v_owner) IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.shops s WHERE s.id = v_shop AND s.hidden_at IS NULL AND s.offers_selling)
       OR (v_kind = 'home_food' AND public.shop_cottage_cap_reached(v_owner))) THEN
    RAISE EXCEPTION 'owner_not_eligible' USING ERRCODE = '22023',
      HINT = 'The shop cannot sell right now (restricted, strikes, age, payouts, hidden or at the home-food limit). Reject it instead.';
  END IF;

  v_status := CASE WHEN p_approve THEN 'live' ELSE 'rejected' END;
  UPDATE public.shop_items
     SET status = v_status,
         admin_approved_at = CASE WHEN p_approve THEN now() ELSE admin_approved_at END,
         live_at = CASE WHEN p_approve THEN now() ELSE live_at END,
         updated_at = now()
   WHERE id = p_item_id AND status = 'pending_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_item_private
     SET review_note = v_note,
         admin_rejected_at = CASE WHEN p_approve THEN NULL ELSE now() END,
         updated_at = now()
   WHERE item_id = p_item_id;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'shop_item_approved' ELSE 'shop_item_rejected' END,
          'shop_item', p_item_id::text,
          -- owner_id is what shops_publish_item's 30-day hold reads.
          jsonb_build_object('note', v_note, 'owner_id', v_owner, 'shop_id', v_shop));
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_review_item(p_item_id uuid, p_approve boolean, p_note text, p_submitted_at timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_review_item(p_item_id uuid, p_approve boolean, p_note text, p_submitted_at timestamp with time zone) TO authenticated, service_role;

-- shops_buyer_cancel_order: restated from 20261019071055_shops_refunds_cancels_strikes.sql.
CREATE OR REPLACE FUNCTION public.shops_buyer_cancel_order(p_order_id uuid, p_expect text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_until timestamptz;
  v_free boolean;
  r public.shop_refunds;
  v_owed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_expect IS NULL OR p_expect NOT IN ('free', 'late') THEN
    RAISE EXCEPTION 'invalid_expect' USING ERRCODE = '22023';
  END IF;
  -- 1. The row lock FIRST (the ready tap and the clock take the same lock).
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.shop_lock_open_charged_order(o.id, false);
  -- 2. ONE reading of the window, under the lock.
  v_until := public.shop_order_free_cancel_until(o.id);
  v_free := v_until IS NOT NULL AND now() < v_until;
  IF (p_expect = 'free') IS DISTINCT FROM v_free THEN
    RAISE EXCEPTION 'cancel_terms_changed' USING ERRCODE = '55000',
      HINT = 'The free-cancel time for this order has changed. Look again before cancelling.';
  END IF;
  -- 3. Recorded on the order before commit; Stripe runs after it.
  IF v_free THEN
    UPDATE public.shop_orders SET status = 'refunded', close_reason = 'buyer_cancelled_free', closed_at = now()
     WHERE id = o.id AND status = 'accepted';
    r := public.shop_write_refund(o.id, 'buyer_cancelled', NULL);
    PERFORM public.shop_return_stock(o.id);
    PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order cancelled',
      format('The buyer cancelled the order for %s inside your free-cancel time. Do not make it.', to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order cancelled',
      format('$%s is on its way back to your card, less the card-processing cost%s. Card refunds usually show up in 5 to 10 business days.',
             to_char(r.refund_cents / 100.0, 'FM999999990.00'),
             CASE WHEN r.tax_kept_cents > 0 THEN ' and the sales tax on it' ELSE '' END),
      '/shops/orders', o.seller_id);
    RETURN jsonb_build_object('result', 'cancelled_free', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  v_owed := public.shop_owe_shop(o.id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Order cancelled late',
    format('The buyer cancelled the order for %s after your free-cancel time, so you are paid for it ($%s).',
           to_char(o.ready_date, 'FMMonth FMDD'), to_char(v_owed / 100.0, 'FM999999990.00')),
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order cancelled',
    'You cancelled after the shop''s free-cancel time, so nothing is refunded and the shop is paid.',
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'cancelled_late', 'order_id', o.id, 'refund_id', NULL, 'refund_cents', 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_buyer_cancel_order(p_order_id uuid, p_expect text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_buyer_cancel_order(p_order_id uuid, p_expect text) TO authenticated, service_role;

-- shops_mark_ready: restated from 20261018211820_shops_handover_payout.sql.
CREATE OR REPLACE FUNCTION public.shops_mark_ready(p_order_id uuid, p_photo_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_was_ready timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'The buyer''s card is not charged yet. Mark the order ready once it is.';
  END IF;
  IF p_photo_path IS NULL AND o.handover_mode = 'in_person' THEN
    NULL;  -- in person: the photo is optional
  ELSIF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'shops'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'shop-handover' AND so.name = p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023', HINT = 'Take a photo of the order first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'The buyer reported a problem with this order. Louisiana Helpr looks at it before anyone is paid.';
  END IF;
  SELECT h.ready_at INTO v_was_ready FROM public.shop_handovers h WHERE h.order_id = o.id;
  -- A retake replaces the photo but keeps the first ready time (the clock never moves later) and tells nobody again.
  INSERT INTO public.shop_handovers (order_id, ready_photo_path, ready_at) VALUES (o.id, p_photo_path, now())
  ON CONFLICT (order_id) DO UPDATE
    SET ready_photo_path = COALESCE(EXCLUDED.ready_photo_path, public.shop_handovers.ready_photo_path),
        ready_at = COALESCE(public.shop_handovers.ready_at, EXCLUDED.ready_at)
   WHERE public.shop_handovers.confirmed_at IS NULL;
  IF v_was_ready IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'ready', 'order_id', o.id);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your order is ready',
    CASE WHEN o.handover_mode = 'porch'
      THEN format('Your order for %s is left out for you. Tap "I got it" when you have it.', to_char(o.ready_date, 'FMMonth FMDD'))
      ELSE format('Your order for %s is ready to pick up at the shop. Tap "I got it" when you have it.', to_char(o.ready_date, 'FMMonth FMDD'))
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'ready', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_mark_ready(p_order_id uuid, p_photo_path text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_mark_ready(p_order_id uuid, p_photo_path text) TO authenticated, service_role;

-- shops_request_order: restated from 20261018164444_shops_own_strike_count.sql.
CREATE OR REPLACE FUNCTION public.shops_request_order(p_shop_id uuid, p_lines jsonb, p_ready_date date, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  s public.shops;
  v_today date := public.shop_local_today();
  v_line jsonb;
  v_item public.shop_items;
  v_qty integer;
  v_unit integer;
  v_items integer := 0;
  v_lead integer := 0;
  v_home_food boolean := false;
  v_order uuid;
  v_old_session text;
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
  v_seen uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501',
      HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  IF public.shop_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'shop_strikes_blocked' USING ERRCODE = '42501',
      HINT = 'You have 3 Shops strikes. Shops opens again when one expires.';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to order from Shops.';
  END IF;
  -- The RPC is callable straight through the API (past shop-checkout's rate
  -- limit), and each call writes an order row: at most 30 orders asked for in
  -- an hour per member (lh-authz-rls review, 2026-10-18).
  IF (SELECT count(*) FROM public.shop_orders x WHERE x.buyer_id = v_uid AND x.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'too_many_order_requests' USING ERRCODE = '54000',
      HINT = 'You have started a lot of orders in the last hour. Wait a while and try again.';
  END IF;

  -- The shop: locked so a pause or a close cannot slip between the checks and the insert.
  SELECT * INTO s FROM public.shops WHERE id = p_shop_id FOR SHARE;
  IF NOT FOUND OR NOT public.shop_visible_to(p_shop_id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF s.owner_id = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023', HINT = 'You cannot order from your own shop.';
  END IF;
  IF s.paused THEN
    RAISE EXCEPTION 'shop_paused' USING ERRCODE = '55000', HINT = 'This shop is taking a break and is not taking new orders.';
  END IF;
  IF NOT s.offers_selling OR public.shop_owner_sell_block_reason(s.owner_id) IS NOT NULL THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '55000', HINT = 'This shop is not taking orders right now.';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023', HINT = 'An order has 1 to 20 items.';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Keep the note under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;

  -- Every line: a live item of THIS shop, never a rental (S5), in stock.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_qty := (v_line ->> 'quantity')::integer;
      SELECT * INTO v_item FROM public.shop_items WHERE id = (v_line ->> 'item_id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023';
    END;
    IF v_qty IS NULL OR v_qty NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023', HINT = 'Order 1 to 20 of each item.';
    END IF;
    IF v_item.id IS NULL OR v_item.shop_id <> s.id OR v_item.status <> 'live' THEN
      RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000', HINT = 'An item in this order is no longer listed.';
    END IF;
    IF v_item.id = ANY (v_seen) THEN
      RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023', HINT = 'Each item once, with a quantity.';
    END IF;
    v_seen := v_seen || v_item.id;
    IF v_item.kind NOT IN ('made', 'home_food', 'farm') THEN
      RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000';
    END IF;
    IF v_item.stock_count IS NOT NULL AND v_item.stock_count < v_qty THEN
      RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
        HINT = format('Only %s of "%s" left.', v_item.stock_count, v_item.title);
    END IF;
    v_unit := public.shop_line_unit_cents(v_item.id, NULL);
    v_items := v_items + v_unit * v_qty;
    v_lead := greatest(v_lead, v_item.lead_time_days);
    v_home_food := v_home_food OR v_item.kind = 'home_food';
  END LOOP;

  -- The ready date (L21, D4): after every item's lead time, at most 90 days out, on an open day.
  IF p_ready_date IS NULL OR p_ready_date < v_today + v_lead THEN
    RAISE EXCEPTION 'ready_date_too_soon' USING ERRCODE = '22023',
      HINT = format('The earliest date for this order is %s.', to_char(v_today + v_lead, 'FMMonth FMDD'));
  END IF;
  IF p_ready_date > v_today + 90 THEN
    RAISE EXCEPTION 'ready_date_too_far' USING ERRCODE = '22023', HINT = 'Pick a date in the next 90 days.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shop_hours h WHERE h.shop_id = s.id AND h.weekday = extract(dow FROM p_ready_date)::smallint) THEN
    RAISE EXCEPTION 'shop_closed_that_day' USING ERRCODE = '22023', HINT = 'The shop does not fill orders on that day.';
  END IF;
  -- L22: a full day greys out (held orders take a slot until they are answered).
  IF s.daily_order_cap IS NOT NULL
     AND public.shop_day_count(s.owner_id, p_ready_date, ARRAY['held', 'accepted', 'handed_over']) >= s.daily_order_cap THEN
    RAISE EXCEPTION 'day_full' USING ERRCODE = '55000', HINT = 'That day is full. Pick another day.';
  END IF;
  -- L8: no new home-food orders once the yearly limit is reached.
  IF v_home_food AND public.shop_cottage_cap_reached(s.owner_id) THEN
    RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
      HINT = 'This home kitchen has reached its yearly sales limit and cannot take home-food orders this year.';
  END IF;

  -- Asking again before paying replaces the unpaid page (its page is expired by shop-checkout).
  UPDATE public.shop_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = s.owner_id AND status = 'awaiting_hold'
  RETURNING stripe_checkout_session_id INTO v_old_session;

  INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, ready_date, cancel_policy, note,
                                  items_cents, premium_cents, tax_cents, total_cents)
  VALUES (v_uid, s.owner_id, s.id, p_ready_date, s.cancel_policy, v_note,
          v_items, public.declutter_buyer_fee_cents(v_items), 0, v_items + public.declutter_buyer_fee_cents(v_items))
  RETURNING id INTO v_order;
  INSERT INTO public.shop_order_lines (order_id, item_id, title, kind, unit_cents, quantity, line_cents, is_seed)
  SELECT v_order, i.id, i.title, i.kind, public.shop_line_unit_cents(i.id, NULL), (l ->> 'quantity')::smallint,
         public.shop_line_unit_cents(i.id, NULL) * (l ->> 'quantity')::integer,
         (SELECT o.is_seed FROM public.shop_orders o WHERE o.id = v_order)
    FROM jsonb_array_elements(p_lines) l
    JOIN public.shop_items i ON i.id = (l ->> 'item_id')::uuid;

  RETURN jsonb_build_object('order_id', v_order, 'items_cents', v_items,
    'premium_cents', public.declutter_buyer_fee_cents(v_items),
    'ready_date', p_ready_date, 'superseded_session_id', v_old_session);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_request_order(p_shop_id uuid, p_lines jsonb, p_ready_date date, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_request_order(p_shop_id uuid, p_lines jsonb, p_ready_date date, p_note text) TO authenticated, service_role;
