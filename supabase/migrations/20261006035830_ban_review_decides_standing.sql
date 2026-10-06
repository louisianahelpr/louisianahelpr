-- Q1324 follow-ups from the final lh-authz-rls and lh-money-escrow reviews
-- (2026-10-06). While a ban settlement review is OPEN, the review alone
-- decides the account's standing; and an unban after a CONFIRMED review always
-- finishes the review's cleanup.
--
-- 1. The strike ladder (apply_consequence_ladder: report_helper_no_show,
--    apply_job_denial_consequence) writes ban_status as a trusted server write
--    (app.trusted_ladder_write). Its final_warning rung omitted 'banned' from
--    the never-downgrade list, so during an open review the write hit
--    refuse_unban_during_ban_review and raised 42501 ban_review_open, whose
--    HINT told the POSTER the Helpr was under review, and the no-show report
--    failed. Its suspend rung moved 'banned' to 'temp_banned' with an end
--    date, which sweep_expired_auto_bans then tried to end every run. Now a
--    ladder write during an open review keeps the account's current standing
--    (the strike itself is still recorded by the ladder); no error, no leak.
--    The ladder never LOWERS a ban at all, review or not (lh-authz-rls review
--    of fbdfa47c7, measured on live definitions): apply_job_denial_consequence
--    runs the ladder unclamped, so a temp-banned Helpr with one prior denial
--    strike could decline an offer and move themselves to final_warning, and
--    its suspend rung shortened a permanent ban to 7 days. A ladder write that
--    would lower a ban (ban -> not a ban, permanent -> anything less,
--    banned -> temp_banned, or an earlier suspension end) keeps the old
--    standing; a ladder write that raises it still applies.
-- 2. Any OTHER change of standing during an open review (an admin's second
--    ban, a message-ban confirm) is refused: the admin confirms or lifts the
--    review first. Before, a second ban to permanently_banned fired the
--    settlement triggers at once, priced as of now, and the later confirm
--    overwrote the status with the retained judgment.
--    Allowed: admin_confirm_ban_settlement (it closes the review first) and
--    lift_ban_settlement_review (app.ban_review_lift). enforce_retained_ban
--    (app.retained_ban_reapply) keeps the current standing instead of failing:
--    its identity match is still recorded for the admin deciding the review,
--    and stripe-idv-webhook / complete-signup no longer fail on it.
-- 3. After a CONFIRMED review, an unban by any other path
--    (admin_reverse_violation, sweep_expired_auto_bans at a confirmed
--    temporary ban's end) left the Q1324 system payout hold and the card/bank
--    match in place: payouts stayed held with nothing prompting a release.
--    Now an ADMIN's unban closes the review as lifted, clears the match and
--    releases the system hold, attributed to that admin, exactly as the lift
--    does. The expiry sweep (no caller) releases the hold and closes the
--    review but KEEPS the card/bank match and the confirming admin's name, and
--    logs a system row. Anyone else (the strike ladder, a non-admin) finishes
--    nothing: before this, a ladder write after a confirm lifted the review
--    in the banned person's own name. A system hold an admin refused to
--    release (denied_by) is never deleted. (An OPEN review cannot be unbanned
--    that way at all: rule 2 refuses it.)

CREATE OR REPLACE FUNCTION public.refuse_unban_during_ban_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_old_rank int;
  v_new_rank int;
BEGIN
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
$fn$;

REVOKE ALL ON FUNCTION public.refuse_unban_during_ban_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refuse_unban_during_ban_review ON public.profiles;
CREATE TRIGGER trg_refuse_unban_during_ban_review
  BEFORE UPDATE OF ban_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_unban_during_ban_review();

CREATE OR REPLACE FUNCTION public.finish_confirmed_ban_review_on_unban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_review record;
  v_actor uuid := auth.uid();
BEGIN
  IF COALESCE(OLD.ban_status, 'active') NOT IN ('banned', 'temp_banned', 'permanently_banned')
     OR COALESCE(NEW.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned')
     OR COALESCE(current_setting('app.ban_review_lift', true), '') = 'on'
     OR COALESCE(current_setting('app.trusted_ladder_write', true), '') = 'on' THEN
    RETURN NULL; -- not an unban, the lift is doing this itself, or the ladder (never an approval)
  END IF;
  -- Only an admin, or the expiry sweep (which says so), finishes a review.
  -- Any other caller-less unban (a service-role edge write, an admin action
  -- through the service key) finishes nothing: logging it as an expiry hid
  -- the admin and left the match live (both reviews of f2644839e).
  IF v_actor IS NOT NULL AND NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RETURN NULL;
  END IF;
  -- A NULL uid alone is not the server: an anon request has one too
  -- (20260915101102). Only a real server context that IS the sweep finishes.
  IF v_actor IS NULL
     AND NOT (public.is_server_context()
              AND COALESCE(current_setting('app.ban_expiry_sweep', true), '') = 'on') THEN
    RETURN NULL;
  END IF;
  SELECT r.id INTO v_review
    FROM public.ban_settlement_queue r
   WHERE r.user_id = NEW.user_id AND r.review_state = 'confirmed'
   ORDER BY r.created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- An admin refused to release this hold: it stays for that decision.
  DELETE FROM public.payout_holds h
   WHERE h.helper_id = NEW.user_id AND h.held_by IS NULL AND h.denied_by IS NULL
     AND h.reason LIKE 'Q1324: %';
  IF v_actor IS NULL THEN
    -- The confirmed TEMPORARY ban ran out. The card/bank match stays (a later
    -- ban of the original account still re-bans this one), and the review
    -- keeps the confirming admin's name.
    UPDATE public.ban_settlement_queue SET review_state = 'lifted', decided_at = now()
     WHERE id = v_review.id;
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (NULL, 'ban_settlement_lifted', NEW.user_id::text, 'user',
            jsonb_build_object('review_state_was', 'confirmed', 'ban_status', NEW.ban_status, 'via', 'expiry'));
    RETURN NULL;
  END IF;
  UPDATE public.ban_settlement_queue
     SET review_state = 'lifted', decided_at = now(), decided_by = v_actor
   WHERE id = v_review.id;
  UPDATE public.ban_evasion_matches
     SET cleared_at = now(), resolved = true
   WHERE user_id = NEW.user_id AND matched_on IN ('card', 'bank') AND cleared_at IS NULL;
  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (v_actor, 'ban_settlement_lifted', NEW.user_id::text, 'user',
          jsonb_build_object('review_state_was', 'confirmed', 'ban_status', NEW.ban_status, 'via', 'unban'));
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.finish_confirmed_ban_review_on_unban() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_finish_confirmed_ban_review_on_unban ON public.profiles;
CREATE TRIGGER trg_finish_confirmed_ban_review_on_unban
  AFTER UPDATE OF ban_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.finish_confirmed_ban_review_on_unban();

-- The expiry sweep, restated from 20260831193039 (prosrc md5 equal to prod,
-- read 2026-10-06) plus the one line that names it.
CREATE OR REPLACE FUNCTION public.sweep_expired_auto_bans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  released integer := 0;
BEGIN
  FOR rec IN
    SELECT user_id, COALESCE(NULLIF(full_name, ''), email, 'A user') AS label
    FROM public.profiles
    WHERE ban_status = 'temp_banned'
      AND auto_suspended_until IS NOT NULL
      AND auto_suspended_until < NOW()
    LIMIT 200
  LOOP
    BEGIN
      -- Q1324: names itself to finish_confirmed_ban_review_on_unban, the one
      -- caller-less unban allowed to close a confirmed review.
      PERFORM set_config('app.ban_expiry_sweep', 'on', true);
      UPDATE public.profiles
      SET ban_status = 'active',
          auto_suspended_until = NULL
      WHERE user_id = rec.user_id
        AND ban_status = 'temp_banned'
        AND auto_suspended_until IS NOT NULL
        AND auto_suspended_until < NOW();

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.user_id,
        'system_alert',
        'Restriction lifted',
        'Your suspension window has ended. Welcome back — please review the rules to avoid further violations.',
        '/profile',
        false
      );

      released := released + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_expired_auto_bans', rec.user_id::text, SQLERRM,
        jsonb_build_object('user_id', rec.user_id));
      RAISE NOTICE 'sweep_expired_auto_bans: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN released;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_expired_auto_bans', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'released_before_failure', released));
  RETURN released;
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_expired_auto_bans() FROM PUBLIC, anon, authenticated;
