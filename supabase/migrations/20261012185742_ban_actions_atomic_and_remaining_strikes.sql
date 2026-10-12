-- Two ban-review follow-ups from the lh-money-escrow reviews of Q1414 / Q1413
-- (docs/OPEN.md Q1494, Q1496).
--
-- 1. Q1494: an admin ban could half-write. BanDialog and the message-ban
--    review's Confirm read ban_settlement_queue first (Q1414), then wrote the
--    user_bans row, the user_violations strike and profiles.ban_status as
--    SEPARATE requests. A ban settlement review opened between the read and
--    the status write was refused only at that last write (ban_review_open),
--    leaving an active ban row and an extra strike behind. admin-user-actions'
--    formal_warning (strike, then standing) had the same two-request shape.
--    admin_apply_account_action does all of it in ONE transaction: it locks
--    the profile row FOR UPDATE and only then refuses an open review. The one
--    function that opens a review (enforce_retained_payment_ban) inserts the
--    queue row AND updates profiles in its own transaction, so it cannot
--    commit between this check and these writes: it either committed first
--    (the check sees the review) or waits for this call to commit. Any later
--    refusal (trg_refuse_unban_during_ban_review, ban_review_open) rolls the
--    whole call back. Order: the ban row, then the standing (the profile
--    update's trg_retain_ban_on_ban reads the newest active user_bans row for
--    the retained reason and type), then the strike and the audit row. A
--    warning that moves an account OUT of a ban first lifts a confirmed
--    review (lift_ban_settlement_review), as set_ban_status always did, so
--    its Q1324 payout hold and card/bank match are cleared. The strike insert fires auto_restrict_repeat_violators, which turns
--    app.trusted_ladder_write on for the rest of the transaction; the function
--    turns it off again, so nothing after the strike is mistaken for a ladder
--    write. service_role only: admin-user-actions checks the admin role and
--    passes p_admin_id, which is checked again here.
--
-- 2. Q1496: a deferred standing applied in full while ANY strike earned during
--    the review stood. The ladder escalates by count (one strike a final
--    warning, two a 7-day suspension, three a 30-day one), and the review row
--    kept only the HARSHEST standing reached, so an admin who reversed one of
--    two strikes still got the two-strike suspension. Each deferral is now
--    also kept with its BASIS (deferred_rungs): the ids of the strikes its
--    ladder counted to reach it, by that ladder's own rule (the strike that
--    earned it is the user's newest; auto_restrict_repeat_violators counts
--    its types over 7 days, every other ladder its own type for life), before
--    or during the review. A rung stands only while every strike in its basis
--    still stands; the lift and the confirm apply the harshest rung that
--    still stands. So reversing the strike that earned a rung, or one it was
--    counted on, drops that rung; reversing an unrelated strike does not; and
--    an earlier rung whose strikes all remain still applies (lh-money-escrow
--    reviews: a since-review count of every type kept a rung whose own strike
--    was gone; a 90-day any-type basis was both too wide and too short).
--    deferred_ban_status / deferred_suspended_until are still written for the
--    review list (admin_ban_settlement_reviews, unchanged).
--
-- Each function is restated from its LIVE definition (= its newest migration,
-- 20261007044339_ban_review_keeps_strikes.sql; md5(prosrc) read 2026-10-12:
-- refuse_unban_during_ban_review a5b1a3d2…, lift_ban_settlement_review
-- 4907f31c…, admin_confirm_ban_settlement ba07ce17…) with only the parts
-- named above changed. Grants restated as live. Replay-safe: IF NOT EXISTS /
-- CREATE OR REPLACE of functions an earlier migration defines.

ALTER TABLE public.ban_settlement_queue ADD COLUMN IF NOT EXISTS deferred_rungs jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The harshest deferred rung whose basis strikes all still stand. NULL: none.
-- A rung with an empty basis (no strike on record when it was set) stands
-- while any strike recorded since the review opened stands (the Q1413 rule).
-- p_skip_spent: a temporary rung whose end has passed is spent (the lift).
CREATE OR REPLACE FUNCTION public.ban_review_standing_rung(p_review_id uuid, p_skip_spent boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT x.rung
    FROM public.ban_settlement_queue r,
         LATERAL jsonb_array_elements(r.deferred_rungs) AS x(rung)
   WHERE r.id = p_review_id
     AND CASE
           WHEN jsonb_array_length(COALESCE(x.rung -> 'basis', '[]'::jsonb)) = 0 THEN
             EXISTS (SELECT 1 FROM public.user_violations v
                      WHERE v.user_id = r.user_id AND v.created_at >= r.created_at)
           ELSE
             NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(x.rung -> 'basis') AS b(id)
                          WHERE NOT EXISTS (SELECT 1 FROM public.user_violations v
                                             WHERE v.id = b.id::uuid))
         END
     AND NOT (p_skip_spent
              AND x.rung ->> 'ban_status' = 'temp_banned'
              AND COALESCE((x.rung ->> 'suspended_until')::timestamptz, '-infinity'::timestamptz) <= now())
   ORDER BY public.ban_standing_rank(x.rung ->> 'ban_status') DESC,
            (x.rung ->> 'suspended_until')::timestamptz DESC NULLS LAST
   LIMIT 1;
$function$;

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
    -- Q1496: every rung, with its basis (the strikes its ladder counted to
    -- reach it, this one included), so a lift or a confirm applies only a
    -- rung whose strikes all still stand.
    UPDATE public.ban_settlement_queue r
       SET deferred_rungs = r.deferred_rungs || jsonb_build_array(jsonb_build_object(
             'ban_status', NEW.ban_status,
             'suspended_until', CASE WHEN NEW.ban_status = 'temp_banned' THEN NEW.auto_suspended_until ELSE NULL END,
             -- The ladder's OWN count, read from the strike that earned this
             -- rung (the user's newest, inserted earlier in this transaction):
             -- auto_restrict_repeat_violators counts its types over 7 days;
             -- the others count their own type for life (job_denial without
             -- a forgiven Elite shield). Admin strikes earn no rung.
             'basis', (WITH n AS (
                         SELECT v.id, v.violation_type
                           FROM public.user_violations v
                          WHERE v.user_id = NEW.user_id
                          ORDER BY v.created_at DESC, v.id DESC
                          LIMIT 1)
                       SELECT COALESCE(jsonb_agg(v.id ORDER BY v.created_at), '[]'::jsonb)
                         FROM public.user_violations v, n
                        WHERE v.user_id = NEW.user_id
                          AND CASE
                                WHEN n.violation_type IN ('admin_action', 'admin_warning') THEN v.id = n.id
                                WHEN n.violation_type = 'job_denial' THEN
                                  v.violation_type = 'job_denial'
                                  AND COALESCE(v.action_taken, '') <> 'forgiven_elite_shield'
                                WHEN n.violation_type IN ('cancel_with_helper', 'off_platform', 'no_show') THEN
                                  v.violation_type = n.violation_type
                                ELSE
                                  v.violation_type NOT IN ('admin_action', 'admin_warning', 'cancel_with_helper',
                                                           'off_platform', 'job_denial', 'no_show')
                                  AND v.created_at >= now() - interval '7 days'
                              END),
             'at', now()))
     WHERE r.user_id = NEW.user_id
       AND r.review_state = 'open';
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
  v_rung   jsonb;
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
                             'applied_rung', v_rung));
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
                             'applied_rung', v_rung));
  RETURN jsonb_build_object('confirmed', true, 'ban_status', v_status, 'settlement', v_out);
END;
$function$;

-- Q1494: one transaction for an admin's warning / temporary / permanent ban.
CREATE OR REPLACE FUNCTION public.admin_apply_account_action(
  p_user_id uuid,
  p_admin_id uuid,
  p_action text,
  p_reason text,
  p_suspended_until timestamptz DEFAULT NULL,
  p_record_strike boolean DEFAULT true
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old     text;
  v_status  text;
  v_until   timestamptz;
  v_reason  text := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Admin action');
  v_ban_row boolean := false;
  v_lift    jsonb;
BEGIN
  IF p_admin_id IS NULL OR NOT COALESCE(public.has_role(p_admin_id, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_user_id = p_admin_id THEN
    RAISE EXCEPTION 'self_action' USING ERRCODE = '22023';
  END IF;
  -- warning / temporary / permanent: BanDialog. formal_warning /
  -- final_warning / suspension: the three strikes of admin-user-actions'
  -- formal_warning (no user_bans row; the suspension is 7 days).
  IF p_action IS NULL OR p_action NOT IN ('warning', 'temporary', 'permanent',
                                          'formal_warning', 'final_warning', 'suspension') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;
  IF p_action IN ('temporary', 'suspension')
     AND (p_suspended_until IS NULL OR p_suspended_until <= now() OR p_suspended_until > now() + interval '366 days') THEN
    RAISE EXCEPTION 'invalid_suspension_end' USING ERRCODE = '22023';
  END IF;

  -- One action per account at a time; a ladder strike or another admin waits.
  SELECT p.ban_status, p.auto_suspended_until INTO v_old, v_until
    FROM public.profiles p WHERE p.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ban_settlement_queue r
              WHERE r.user_id = p_user_id AND r.review_state = 'open') THEN
    RAISE EXCEPTION 'ban_review_open'
      USING ERRCODE = '42501',
            HINT = 'This account is under a ban settlement review. Confirm or lift it in the fraud console.';
  END IF;

  v_status := CASE p_action WHEN 'warning' THEN 'final_warning'
                            WHEN 'final_warning' THEN 'final_warning'
                            WHEN 'formal_warning' THEN 'warned'
                            WHEN 'temporary' THEN 'temp_banned'
                            WHEN 'suspension' THEN 'temp_banned'
                            ELSE 'permanently_banned' END;
  -- A warning leaves the suspension end alone (as the admin tools always did).
  v_until := CASE WHEN p_action IN ('temporary', 'suspension') THEN p_suspended_until
                  WHEN p_action = 'permanent' THEN NULL
                  ELSE v_until END;

  -- The ban row before the standing: the profile update's
  -- trg_retain_ban_on_ban reads the newest active user_bans row for the
  -- retained reason and type. Any refusal below rolls this back with it.
  IF p_action = 'temporary' THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by, expires_at)
    VALUES (p_user_id, 'temporary', v_reason, p_admin_id, p_suspended_until);
    v_ban_row := true;
  ELSIF p_action = 'permanent'
        AND NOT EXISTS (SELECT 1 FROM public.user_bans b
                         WHERE b.user_id = p_user_id AND b.ban_type = 'permanent' AND b.is_active) THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
    VALUES (p_user_id, 'permanent', v_reason, p_admin_id);
    v_ban_row := true;
  END IF;

  -- A warning out of a ban ends a CONFIRMED review the way set_ban_status
  -- always did (an open one was refused above): the lift clears its Q1324
  -- payout hold and card/bank match, and may keep a harsher standing the
  -- ladder earned during the review, which is then what is applied.
  IF COALESCE(v_old, 'active') IN ('banned', 'temp_banned', 'permanently_banned')
     AND v_status NOT IN ('banned', 'temp_banned', 'permanently_banned') THEN
    v_lift := public.lift_ban_settlement_review(p_user_id, p_admin_id, v_status);
    IF COALESCE((v_lift ->> 'lifted')::boolean, false) THEN
      v_status := v_lift ->> 'ban_status';
      v_until := (v_lift ->> 'suspended_until')::timestamptz;
    END IF;
  END IF;

  -- Never as a ladder write (that would keep the old standing silently).
  PERFORM set_config('app.trusted_ladder_write', 'off', true);
  UPDATE public.profiles
     SET ban_status = v_status, auto_suspended_until = v_until
   WHERE user_id = p_user_id;

  IF p_record_strike THEN
    INSERT INTO public.user_violations (user_id, violation_type, description, action_taken, reported_by)
    VALUES (p_user_id,
            CASE WHEN p_action IN ('temporary', 'permanent') THEN 'admin_action' ELSE 'admin_warning' END,
            v_reason,
            CASE p_action WHEN 'warning' THEN 'warning' WHEN 'formal_warning' THEN 'warning'
                          WHEN 'final_warning' THEN 'final_warning' WHEN 'suspension' THEN 'suspension'
                          WHEN 'temporary' THEN 'temp_ban' ELSE 'permanent_ban' END,
            p_admin_id);
    -- The strike's ladder trigger turned this on for the rest of the transaction.
    PERFORM set_config('app.trusted_ladder_write', 'off', true);
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (p_admin_id, 'set_ban_status', p_user_id::text, 'user',
          jsonb_build_object('ban_status', v_status, 'auto_suspended_until', v_until,
                             'action', p_action, 'ban_row_written', v_ban_row,
                             'strike_recorded', p_record_strike, 'previous_ban_status', v_old));

  RETURN jsonb_build_object('ban_status', v_status, 'suspended_until', v_until,
                            'ban_row_written', v_ban_row,
                            'state_changed', v_ban_row OR v_old IS DISTINCT FROM v_status);
END;
$function$;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.ban_review_standing_rung(uuid, boolean) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.ban_review_standing_rung(uuid, boolean) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.admin_apply_account_action(uuid, uuid, text, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_apply_account_action(uuid, uuid, text, text, timestamptz, boolean) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.refuse_unban_during_ban_review() FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.refuse_unban_during_ban_review() TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.lift_ban_settlement_review(uuid, uuid, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.lift_ban_settlement_review(uuid, uuid, text) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.admin_confirm_ban_settlement(uuid) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_confirm_ban_settlement(uuid) TO authenticated, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;
