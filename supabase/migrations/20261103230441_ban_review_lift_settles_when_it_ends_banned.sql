-- Q1415 (f2) (lh-authz-rls re-review of f2644839e, PRE-EXISTING): a ban review's LIFT whose result is still a ban
-- (a retained identity judgment or a standing strike rung kept the account 'banned' or 'permanently_banned') never
-- settled the account's jobs. The profile is pinned 'banned' while the review is open, so 'banned' over 'banned' fires no
-- settlement trigger and the jobs stayed unsettled once the freeze ended; 'banned' -> 'permanently_banned' fired the
-- triggers, which settle as of now, not as of the review.
--
-- Fix: lift_ban_settlement_review keeps the settlement triggers aside during its profile write
-- (app.ban_settlement_review, as admin_confirm_ban_settlement does) and, when the account ends banned or permanently
-- banned, runs the confirm's explicit settlement as of the review's start (app.ban_settlement_as_of,
-- settle_one_off_jobs_for_banned_account, end_series_for_banned_account). A lift that ends unbanned or suspended changes
-- no job, as before. The settlement result goes into the audit row and the answer.
--
-- Restated verbatim from 20261013001155_ban_review_confirm_keeps_strictest_retained_judgment.sql (prod prosrc md5
-- 0cf5b1384731afa866f45d56855b2018, 2026-11-03); only the marked lines change. Grants restated as live.
-- Proof: src/test/pglite/banReviewLiftSettlesWhenBanned.pglite.mjs.

CREATE OR REPLACE FUNCTION public.lift_ban_settlement_review(p_user_id uuid, p_admin_id uuid, p_ban_status text DEFAULT 'active'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_review record;
  v_status text;
  v_until  timestamptz;
  v_rung   jsonb;
  v_floor  jsonb;
  v_now    text;
  v_settle jsonb := NULL;
BEGIN
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_ban_status IS NULL OR p_ban_status IN ('banned', 'temp_banned', 'permanently_banned') THEN
    RAISE EXCEPTION 'lift_needs_an_unbanned_status' USING ERRCODE = '22023';
  END IF;

  SELECT r.id, r.review_state, r.created_at, r.deferred_ban_status, r.deferred_suspended_until INTO v_review
    FROM public.ban_settlement_queue r
   WHERE r.user_id = p_user_id AND r.review_state IN ('open', 'confirmed')
   ORDER BY r.created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('lifted', false);
  END IF;

  UPDATE public.ban_settlement_queue
     SET review_state = 'lifted', decided_at = now(), decided_by = p_admin_id
   WHERE id = v_review.id;
  UPDATE public.ban_evasion_matches
     SET cleared_at = now(), resolved = true
   WHERE user_id = p_user_id AND matched_on IN ('card', 'bank') AND cleared_at IS NULL;
  -- A system hold an admin explicitly refused to release stays for that
  -- admin's decision (lh-money-escrow F3, 2026-10-06).
  DELETE FROM public.payout_holds h
   WHERE h.helper_id = p_user_id AND h.held_by IS NULL AND h.denied_by IS NULL
     AND h.reason LIKE 'Q1324: %';

  -- Q1413: a strike earned during the review stands: the harsher of the
  -- admin's choice and the standing the ladder deferred (a suspension whose
  -- end has passed is spent and ignored).
  -- Q1496: the harshest rung whose strikes all still stand (an admin who
  -- reversed one, admin_reverse_violation deletes the row, reversed every rung
  -- counted on it), not the harshest one ever reached.
  v_status := p_ban_status;
  v_until := NULL;
  v_rung := public.ban_review_standing_rung(v_review.id, true);
  IF v_rung IS NOT NULL
     AND public.ban_standing_rank(v_rung ->> 'ban_status') > public.ban_standing_rank(p_ban_status) THEN
    v_status := v_rung ->> 'ban_status';
    v_until := CASE WHEN v_status = 'temp_banned' THEN (v_rung ->> 'suspended_until')::timestamptz ELSE NULL END;
  END IF;
  -- Q1415 (f): a retained judgment applied during this review by another
  -- identity signal (an exact ID, phone or email match) is not the card or
  -- bank match being lifted, so it stands, as it does on a confirm.
  -- After the card/bank matches above are cleared, so they never count here.
  v_floor := public.ban_review_retained_floor(p_user_id, v_review.created_at);
  IF v_floor IS NOT NULL THEN
    IF public.ban_standing_rank(v_floor ->> 'ban_status') > public.ban_standing_rank(v_status) THEN
      v_status := v_floor ->> 'ban_status';
      v_until := CASE WHEN v_status = 'temp_banned' THEN (v_floor ->> 'suspended_until')::timestamptz ELSE NULL END;
    ELSIF v_status = 'temp_banned' AND v_floor ->> 'ban_status' = 'temp_banned' AND v_until IS NOT NULL
          AND ((v_floor ->> 'suspended_until') IS NULL OR (v_floor ->> 'suspended_until')::timestamptz > v_until) THEN
      v_until := (v_floor ->> 'suspended_until')::timestamptz;
    END IF;
  END IF;

  -- Q1415 (f2): the settlement triggers stand aside (they would settle as of now, or not at all when the profile is
  -- already 'banned'); a lift that ends banned settles below as of the review, the way a confirm does.
  PERFORM set_config('app.ban_review_lift', 'on', true);
  PERFORM set_config('app.ban_settlement_review', 'on', true);
  UPDATE public.profiles
     SET ban_status = v_status, auto_suspended_until = v_until
   WHERE user_id = p_user_id;
  PERFORM set_config('app.ban_settlement_review', 'off', true);
  PERFORM set_config('app.ban_review_lift', 'off', true);
  SELECT p.ban_status INTO v_now FROM public.profiles p WHERE p.user_id = p_user_id;

  -- A temporary judgment never settled jobs (the triggers fire only for these two), so a lift that ends there or
  -- unbanned changes no job.
  IF v_now IN ('banned', 'permanently_banned') THEN
    PERFORM set_config('app.ban_settlement_as_of', v_review.created_at::text, true);
    v_settle := public.settle_one_off_jobs_for_banned_account(p_user_id);
    PERFORM public.end_series_for_banned_account(p_user_id);
    PERFORM set_config('app.ban_settlement_as_of', '', true);
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (p_admin_id, 'ban_settlement_lifted', p_user_id::text, 'user',
          jsonb_build_object('review_state_was', v_review.review_state, 'ban_status', v_status,
                             'admin_choice', p_ban_status, 'deferred_ban_status', v_review.deferred_ban_status,
                             'deferred_suspended_until', v_review.deferred_suspended_until,
                             'applied_rung', v_rung, 'retained_floor', v_floor, 'settlement', v_settle));
  RETURN jsonb_build_object('lifted', true, 'review_state_was', v_review.review_state,
                            'ban_status', v_status, 'suspended_until', v_until, 'settlement', v_settle);
END;
$function$;

REVOKE ALL ON FUNCTION public.lift_ban_settlement_review(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lift_ban_settlement_review(uuid, uuid, text) TO service_role;
