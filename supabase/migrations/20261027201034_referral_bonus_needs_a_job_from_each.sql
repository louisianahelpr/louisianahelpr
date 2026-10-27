-- Referral bonus: NEITHER person gets their $5 until BOTH the referrer and the
-- referred member have a completed job of their own, posted or worked; then
-- both are paid together (owner 2026-10-27: "they both have to post a job or
-- work a job before either one gets it").
--
-- Before (check_referral_bonus, prod body read 2026-10-27): when the referred
-- member's first job completed, BOTH the referred member and the referrer got
-- $5 at once, even if the referrer had never posted or worked a job.
-- Now, on every job that completes, for each party (Helpr and poster), every
-- referral they are part of (either side) is checked: once both people have a
-- completed job, both halves are paid in the same step.
-- Same credit rows, reasons, amounts and the one-per-reason unique index as
-- before (ON CONFLICT DO NOTHING), so the cap and eligibility triggers on
-- referral_credits still apply unchanged.

CREATE OR REPLACE FUNCTION public.referral_member_has_completed_job(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.status = 'completed' AND (j.helper_id = p_user OR j.customer_id = p_user));
$fn$;
REVOKE ALL ON FUNCTION public.referral_member_has_completed_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_member_has_completed_job(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.referral_settle_for(p_user uuid, p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ref RECORD;
  v_new int;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  -- Every referral p_user is part of, on either side. Both halves are paid
  -- together, and only once BOTH people have a completed job of their own.
  FOR v_ref IN
    SELECT r.referrer_id, r.referred_id, r.referral_code_id
      FROM public.referrals r
     WHERE (r.referred_id = p_user OR r.referrer_id = p_user)
       AND r.referrer_id IS NOT NULL AND r.referred_id IS NOT NULL
  LOOP
    CONTINUE WHEN NOT (public.referral_member_has_completed_job(v_ref.referrer_id)
                       AND public.referral_member_has_completed_job(v_ref.referred_id));
    INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
    VALUES (v_ref.referred_id, 5, 'first_job_bonus', v_ref.referral_code_id, v_ref.referrer_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;
    IF v_new > 0 THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (v_ref.referred_id, 'Referral bonus earned!',
              'You and the friend who invited you have both finished a job, so you each earned a $5 credit!', 'payment', '/profile?tab=referral', p_job_id);
    END IF;
    INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
    VALUES (v_ref.referrer_id, 5, 'referrer_bonus', v_ref.referral_code_id, v_ref.referred_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;
    IF v_new > 0 THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (v_ref.referrer_id, 'Referral bonus earned!',
              'You and the friend you invited have both finished a job, so you each earned a $5 credit!', 'payment', '/profile?tab=referral', p_job_id);
    END IF;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.referral_settle_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_settle_for(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.check_referral_bonus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') THEN
    RETURN NEW;
  END IF;
  -- Each party separately; a deleted account (NULL) is skipped.
  PERFORM public.referral_settle_for(NEW.helper_id, NEW.id);
  IF NEW.customer_id IS DISTINCT FROM NEW.helper_id THEN
    PERFORM public.referral_settle_for(NEW.customer_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;
