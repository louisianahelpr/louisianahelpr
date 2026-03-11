
-- Drop old trigger
DROP TRIGGER IF EXISTS check_referral_bonus_on_job ON public.jobs;

-- Update function to only award on completion
CREATE OR REPLACE FUNCTION public.check_referral_bonus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_referral RECORD;
  v_user_to_check UUID;
BEGIN
  -- Only fire on job completion
  IF NOT (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') THEN
    RETURN NEW;
  END IF;

  -- Check both customer and helper
  FOR v_user_to_check IN
    SELECT unnest(ARRAY[NEW.customer_id, NEW.helper_id])
  LOOP
    IF v_user_to_check IS NULL THEN
      CONTINUE;
    END IF;

    -- Check if this user has a pending referral bonus (as the referred user)
    SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
    INTO v_referral
    FROM public.referrals r
    WHERE r.referred_id = v_user_to_check
      AND NOT EXISTS (
        SELECT 1 FROM public.referral_credits rc
        WHERE rc.user_id = v_user_to_check
          AND rc.referral_code_id = r.referral_code_id
      );

    IF FOUND THEN
      -- Credit the referred user
      INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
      VALUES (v_user_to_check, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id);

      -- Credit the referrer
      INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
      VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, v_user_to_check);

      -- Notify both
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES 
        (v_user_to_check, 'Referral bonus earned!', 'You completed your first job and earned a $5 referral credit!', 'payment', '/profile'),
        (v_referral.referrer_id, 'Referral bonus!', 'Your referral completed their first job. You earned a $5 credit!', 'payment', '/profile');
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Recreate trigger (only on UPDATE since we only care about completion)
CREATE TRIGGER check_referral_bonus_on_job
  AFTER UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.check_referral_bonus();
