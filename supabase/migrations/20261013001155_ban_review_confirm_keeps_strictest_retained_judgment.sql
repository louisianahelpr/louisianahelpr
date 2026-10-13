-- A ban review's decision never weakens a stricter retained judgment applied
-- during the review (Q1415 (f); lh-authz-rls re-review of f2644839e,
-- 2026-10-06, and its review of the first build of this fix, 2026-10-12).
--
-- While a card/bank ban settlement review is open, another identity signal can
-- re-apply a retained ban to the same account: enforce_retained_ban (an exact
-- verified-ID, phone or email match) records it in ban_evasion_matches with
-- auto_banned and writes a self-issued user_bans row, while
-- refuse_unban_during_ban_review pins profiles at the review's 'banned'. Then:
--   * admin_confirm_ban_settlement wrote the REVIEW's judgment over profiles
--     and every self-issued user_bans row, so a permanent identity ban could
--     come out of a confirm as a temporary one;
--   * lift_ban_settlement_review applied only the admin's choice (or the
--     deferred ladder rung), so lifting the CARD match also erased the
--     identity judgment, and the unban released its retained rows.
--
-- ban_review_retained_floor(user, review opened at) returns the strictest
-- standing retained judgment applied during the review, or NULL. It counts a
-- match only when: auto_banned, not cleared (a lift clears the card/bank ones
-- first), its retained row still exists and has not expired, it was recorded
-- since the review opened OR its retained row was re-applied since (an older
-- doubt-check row turned into a ban keeps its created_at), and it is not a
-- spent suspension. Between two suspensions the later end wins and one with no
-- end outlasts any dated one, whatever order the rows are read in. Both
-- decisions take it as a floor under their own result (the rung's rule).
--
-- Bodies = 20261012185742's (prosrc md5: lift d5838f0493ffe105f5bee0be86e4f477,
-- confirm 47b6bb30ae91bbd3c68ab0394b656a81, equal to prod, read 2026-10-12)
-- plus the floor and its audit field. Same signatures, SECURITY DEFINER,
-- search_path ''. Measured 2026-10-12: 0 ban_settlement_queue rows on prod.
-- Replay-safe: CREATE OR REPLACE; grants restated as prod has them.

CREATE OR REPLACE FUNCTION public.ban_review_retained_floor(p_user_id uuid, p_since timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_m      record;
  v_status text := NULL;
  v_until  timestamptz := NULL;
BEGIN
  FOR v_m IN
    SELECT m.original_ban_status AS st, m.original_expires_at AS ex
      FROM public.ban_evasion_matches m
      JOIN public.retained_bans rb ON rb.id = m.retained_ban_id
     WHERE m.user_id = p_user_id
       AND m.auto_banned
       AND m.cleared_at IS NULL
       AND m.original_ban_status IN ('temp_banned', 'banned', 'permanently_banned')
       -- A live judgment: its retained row still exists and has not expired
       -- (an unban releases it; a match row outlives its retained row).
       AND (rb.expires_at IS NULL OR rb.expires_at > now())
       -- Applied during this review: recorded since it opened, or an older
       -- doubt-check row that enforce_retained_ban turned into a ban since
       -- (it stamps the retained row's reapplied_at, not the match's).
       AND (m.created_at >= p_since OR rb.reapplied_at >= p_since)
       -- A suspension already over is spent.
       AND NOT (m.original_ban_status = 'temp_banned' AND m.original_expires_at IS NOT NULL AND m.original_expires_at <= now())
  LOOP
    IF v_status IS NULL OR public.ban_standing_rank(v_m.st) > public.ban_standing_rank(v_status) THEN
      v_status := v_m.st;
      v_until := v_m.ex;
    ELSIF v_status = 'temp_banned' AND v_m.st = 'temp_banned' AND v_until IS NOT NULL
          AND (v_m.ex IS NULL OR v_m.ex > v_until) THEN
      -- Between two suspensions the later end; one with no end outlasts any.
      v_until := v_m.ex;
    END IF;
  END LOOP;
  IF v_status IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('ban_status', v_status,
                            'suspended_until', CASE WHEN v_status = 'temp_banned' THEN v_until ELSE NULL END);
END;
$function$;

REVOKE ALL ON FUNCTION public.ban_review_retained_floor(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ban_review_retained_floor(uuid, timestamptz) TO service_role;

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

  PERFORM set_config('app.ban_review_lift', 'on', true);
  UPDATE public.profiles
     SET ban_status = v_status, auto_suspended_until = v_until
   WHERE user_id = p_user_id;
  PERFORM set_config('app.ban_review_lift', 'off', true);

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (p_admin_id, 'ban_settlement_lifted', p_user_id::text, 'user',
          jsonb_build_object('review_state_was', v_review.review_state, 'ban_status', v_status,
                             'admin_choice', p_ban_status, 'deferred_ban_status', v_review.deferred_ban_status,
                             'deferred_suspended_until', v_review.deferred_suspended_until,
                             'applied_rung', v_rung, 'retained_floor', v_floor));
  RETURN jsonb_build_object('lifted', true, 'review_state_was', v_review.review_state,
                            'ban_status', v_status, 'suspended_until', v_until);
END;
$function$;

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
        AND (v_rung ->> 'suspended_until')::timestamptz > COALESCE(v_review.original_expires_at, '-infinity'::timestamptz) THEN
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

REVOKE ALL ON FUNCTION public.lift_ban_settlement_review(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lift_ban_settlement_review(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_confirm_ban_settlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_ban_settlement(uuid) TO authenticated, service_role;
