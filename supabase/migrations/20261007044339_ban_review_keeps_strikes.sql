-- Q1413 (docs/OPEN.md; lh-money-escrow review of fbdfa47c7 #1): a strike
-- earned while a ban settlement review is OPEN was dropped. The ladder's write
-- keeps the account's standing during the review (the review decides it,
-- 20261006035830), so a final warning or a 7-day suspension earned meanwhile
-- was simply lost after a lift, while the ladder still told the person and the
-- admins it had applied.
--
-- Now:
--   * the open review row keeps the HARSHEST standing the ladder tried to set
--     during the review (deferred_ban_status / deferred_suspended_until);
--   * lift_ban_settlement_review applies the harsher of the admin's choice and
--     that deferred standing (a spent suspension is ignored, and so is one
--     whose strikes an admin has since reversed), so the notice the ladder
--     sent comes true when the review ends; it returns the standing it set,
--     which admin-user-actions now writes instead of its own choice;
--   * admin_confirm_ban_settlement applies it when harsher than the retained
--     judgment, and a later suspension end extends a confirmed temporary ban;
--   * admin_ban_settlement_reviews lists the deferred standing and every strike
--     recorded since the review opened, so the admin deciding can reverse a
--     no-show on a job that started while the account was banned.
--
-- Each function is restated from its LIVE definition (pg_get_functiondef,
-- 2026-10-07; md5(prosrc): refuse_unban_during_ban_review c1b8e357…,
-- lift_ban_settlement_review ae36243d…, admin_confirm_ban_settlement c9528eb0…,
-- admin_ban_settlement_reviews 42703b13…) with only the Q1413 parts added.
-- Grants restated as live. Replay-safe: IF NOT EXISTS / CREATE OR REPLACE.

ALTER TABLE public.ban_settlement_queue ADD COLUMN IF NOT EXISTS deferred_ban_status text;
ALTER TABLE public.ban_settlement_queue ADD COLUMN IF NOT EXISTS deferred_suspended_until timestamptz;
ALTER TABLE public.ban_settlement_queue ADD COLUMN IF NOT EXISTS deferred_at timestamptz;

-- How harsh a standing is: never lower one with a softer one.
CREATE OR REPLACE FUNCTION public.ban_standing_rank(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE COALESCE(p_status, 'active')
           WHEN 'permanently_banned' THEN 4
           WHEN 'banned' THEN 3
           WHEN 'temp_banned' THEN 2
           WHEN 'final_warning' THEN 1
           ELSE 0
         END;
$$;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.ban_standing_rank(text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.ban_standing_rank(text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.refuse_unban_during_ban_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old_rank int;
  v_new_rank int;
BEGIN
  -- 0. Q1413: a STRIKE the ladder earns while a ban settlement review is open
  --    does not change the standing now (the review decides it, rules 1 and
  --    2 below), but it is not dropped either: the harsher standing it would
  --    have set is kept on the open review row, and the lift and the confirm
  --    apply the harsher of it and the admin's choice. Only the ladder's own
  --    writes (app.trusted_ladder_write); a retained-ban match is the review.
  IF COALESCE(current_setting('app.trusted_ladder_write', true), '') = 'on'
     -- A later end on the same suspension counts too (lh-authz-rls review).
     AND (NEW.ban_status IS DISTINCT FROM OLD.ban_status
          OR NEW.auto_suspended_until IS DISTINCT FROM OLD.auto_suspended_until)
     AND COALESCE(NEW.ban_status, 'active') IN ('final_warning', 'temp_banned', 'banned', 'permanently_banned') THEN
    UPDATE public.ban_settlement_queue r
       SET deferred_ban_status = NEW.ban_status,
           deferred_suspended_until = CASE WHEN NEW.ban_status = 'temp_banned' THEN NEW.auto_suspended_until ELSE NULL END,
           deferred_at = now()
     WHERE r.user_id = NEW.user_id
       AND r.review_state = 'open'
       AND (
         public.ban_standing_rank(NEW.ban_status) > public.ban_standing_rank(r.deferred_ban_status)
         OR (NEW.ban_status = 'temp_banned' AND r.deferred_ban_status = 'temp_banned'
             AND NEW.auto_suspended_until > COALESCE(r.deferred_suspended_until, '-infinity'::timestamptz))
       );
  END IF;

  -- 1. The strike ladder and a retained-ban re-application never lower a ban
  --    (any review state).
  IF (COALESCE(current_setting('app.trusted_ladder_write', true), '') = 'on'
      OR COALESCE(current_setting('app.retained_ban_reapply', true), '') = 'on')
     AND COALESCE(OLD.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned') THEN
    v_old_rank := CASE OLD.ban_status WHEN 'permanently_banned' THEN 3 WHEN 'banned' THEN 2 ELSE 1 END;
    v_new_rank := CASE COALESCE(NEW.ban_status, 'active')
                    WHEN 'permanently_banned' THEN 3 WHEN 'banned' THEN 2 WHEN 'temp_banned' THEN 1 ELSE 0 END;
    IF v_new_rank < v_old_rank
       OR (v_new_rank = 1 AND v_old_rank = 1
           AND (OLD.auto_suspended_until IS NULL
                OR NEW.auto_suspended_until < OLD.auto_suspended_until)) THEN
      NEW.ban_status := OLD.ban_status;
      NEW.auto_suspended_until := OLD.auto_suspended_until;
      RETURN NEW;
    END IF;
  END IF;

  -- 2. During an OPEN review the review alone decides the standing.
  IF COALESCE(OLD.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned')
     AND NEW.ban_status IS DISTINCT FROM OLD.ban_status
     AND COALESCE(current_setting('app.ban_review_lift', true), '') <> 'on'
     AND EXISTS (SELECT 1 FROM public.ban_settlement_queue r
                  WHERE r.user_id = NEW.user_id AND r.review_state = 'open') THEN
    IF COALESCE(current_setting('app.trusted_ladder_write', true), '') = 'on'
       OR COALESCE(current_setting('app.retained_ban_reapply', true), '') = 'on' THEN
      -- The review decides the standing; the strike / the match stays recorded.
      NEW.ban_status := OLD.ban_status;
      NEW.auto_suspended_until := OLD.auto_suspended_until;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ban_review_open'
      USING ERRCODE = '42501',
            HINT = 'This account is under a ban settlement review. Confirm or lift it in the fraud console.';
  END IF;
  RETURN NEW;
END;
$function$;

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
  v_status := p_ban_status;
  v_until := NULL;
  -- Only while a strike recorded during the review still stands: an admin
  -- who reversed them (admin_reverse_violation deletes the row) reversed
  -- what they earned (lh-authz-rls review of Q1413).
  IF v_review.deferred_ban_status IS NOT NULL
     AND NOT (v_review.deferred_ban_status = 'temp_banned'
              AND COALESCE(v_review.deferred_suspended_until, '-infinity'::timestamptz) <= now())
     AND public.ban_standing_rank(v_review.deferred_ban_status) > public.ban_standing_rank(p_ban_status)
     AND EXISTS (SELECT 1 FROM public.user_violations v
                  WHERE v.user_id = p_user_id AND v.created_at >= v_review.created_at) THEN
    v_status := v_review.deferred_ban_status;
    v_until := CASE WHEN v_status = 'temp_banned' THEN v_review.deferred_suspended_until ELSE NULL END;
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
                             'deferred_suspended_until', v_review.deferred_suspended_until));
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
  IF v_review.deferred_ban_status IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_violations v
                  WHERE v.user_id = p_user_id AND v.created_at >= v_review.created_at)
     AND public.ban_standing_rank(v_review.deferred_ban_status) > public.ban_standing_rank(v_final) THEN
    v_final := v_review.deferred_ban_status;
    v_review.original_expires_at := v_review.deferred_suspended_until;
  ELSIF v_final = 'temp_banned' AND v_review.deferred_ban_status = 'temp_banned'
        AND EXISTS (SELECT 1 FROM public.user_violations v
                     WHERE v.user_id = p_user_id AND v.created_at >= v_review.created_at)
        AND v_review.deferred_suspended_until > COALESCE(v_review.original_expires_at, '-infinity'::timestamptz) THEN
    v_review.original_expires_at := v_review.deferred_suspended_until;
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
          jsonb_build_object('ban_status', v_status, 'as_of', v_review.created_at, 'settlement', v_out));
  RETURN jsonb_build_object('confirmed', true, 'ban_status', v_status, 'settlement', v_out);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_ban_settlement_reviews()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'review_id', r.id,
             'user_id', r.user_id,
             'email', p.email,
             'full_name', p.full_name,
             'ban_status', p.ban_status,
             'matched_on', r.matched_on,
             'original_ban_status', r.original_ban_status,
             'original_expires_at', r.original_expires_at,
             'created_at', r.created_at,
             -- Q1413: what a lift or a confirm will also apply, and the strikes
             -- recorded since the review opened (an admin can reverse a no-show
             -- on a job that started while this account was banned).
             'deferred_ban_status', r.deferred_ban_status,
             'deferred_suspended_until', r.deferred_suspended_until,
             'strikes_during_review', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', v.id, 'violation_type', v.violation_type, 'description', v.description,
                        'job_id', v.job_id, 'action_taken', v.action_taken, 'created_at', v.created_at)
                        ORDER BY v.created_at)
                 FROM public.user_violations v
                WHERE v.user_id = r.user_id AND v.created_at >= r.created_at), '[]'::jsonb),
             'matches', COALESCE((
               SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at)
                 FROM public.ban_evasion_matches m
                WHERE m.user_id = r.user_id AND m.cleared_at IS NULL), '[]'::jsonb),
             'jobs', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', j.id, 'title', j.title, 'status', j.status::text,
                        'payment_status', j.payment_status,
                        'role', CASE WHEN j.customer_id = r.user_id THEN 'poster' ELSE 'helpr' END)
                        ORDER BY j.created_at)
                 FROM public.jobs j
                WHERE (
                        (j.customer_id = r.user_id OR j.helper_id = r.user_id
                         OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                                     WHERE g.job_id = j.id AND g.helper_id = r.user_id))
                        AND j.status::text NOT IN ('completed', 'cancelled')
                      )
                   OR (j.helper_id = r.user_id
                       AND j.status::text IN ('completed', 'cancelled')
                       AND j.payment_status IN ('escrow', 'payout_pending'))
                   OR (j.is_group_job IS TRUE
                       AND j.status::text IN ('completed', 'cancelled')
                       AND j.payment_status IN ('escrow', 'payout_pending')
                       AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                                    WHERE g.job_id = j.id AND g.helper_id = r.user_id)
                       AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt
                                        WHERE pt.job_id = j.id AND pt.helper_id = r.user_id AND pt.status = 'paid'))), '[]'::jsonb)
           ) ORDER BY r.created_at)
      FROM public.ban_settlement_queue r
      LEFT JOIN public.profiles p ON p.user_id = r.user_id
     WHERE r.review_state = 'open'), '[]'::jsonb);
END;
$function$;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.refuse_unban_during_ban_review() FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.refuse_unban_during_ban_review() TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.lift_ban_settlement_review(uuid, uuid, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.lift_ban_settlement_review(uuid, uuid, text) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.admin_confirm_ban_settlement(uuid) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_confirm_ban_settlement(uuid) TO authenticated, service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.admin_ban_settlement_reviews() FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_ban_settlement_reviews() TO authenticated, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;
