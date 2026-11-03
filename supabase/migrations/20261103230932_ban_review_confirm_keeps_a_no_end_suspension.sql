-- Q1415 (f3) (lh-authz-rls re-review of f2644839e, PRE-EXISTING): admin_confirm_ban_settlement compared a standing
-- strike rung's suspension end with COALESCE(original_expires_at, '-infinity'), so a dated rung REPLACED a review
-- suspension with no end (the account came out with an end date it never had), and a rung with no end never outlasted a
-- dated one (NULL > x is not true). Now the same rule as ban_review_retained_floor: between two suspensions the later
-- end; one with no end outlasts any.
--
-- Restated verbatim from 20261013001155_ban_review_confirm_keeps_strictest_retained_judgment.sql (prod prosrc md5
-- 288fe7775e2e72e9293345fc013febfb, 2026-11-03); only the marked condition changes. Grants restated as live.
-- Proof: src/test/pglite/banReviewConfirmNoEndSuspension.pglite.mjs.

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
    RAISE EXCEPTION 'no_open_review' USING ERRCODE = 'P0002';
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
REVOKE ALL ON FUNCTION public.admin_confirm_ban_settlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_ban_settlement(uuid) TO authenticated, service_role;
