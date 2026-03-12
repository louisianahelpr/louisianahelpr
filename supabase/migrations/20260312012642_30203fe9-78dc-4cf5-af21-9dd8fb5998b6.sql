
-- Update check_referral_bonus to ONLY award credits on job completion, not on posting
CREATE OR REPLACE FUNCTION public.check_referral_bonus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_referral RECORD;
BEGIN
  -- Only trigger on job completion
  IF NOT (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') THEN
    RETURN NEW;
  END IF;

  -- Check helper (worker) referral bonus
  IF NEW.helper_id IS NOT NULL THEN
    SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
    INTO v_referral
    FROM public.referrals r
    WHERE r.referred_id = NEW.helper_id
      AND NOT EXISTS (
        SELECT 1 FROM public.referral_credits rc
        WHERE rc.referred_user_id = NEW.helper_id
          AND rc.referral_code_id = r.referral_code_id
      );

    IF FOUND THEN
      INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
      VALUES (NEW.helper_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id);

      INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
      VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.helper_id)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES 
        (NEW.helper_id, 'Referral bonus earned!', 'You completed your first job as a helper and earned a $5 referral credit!', 'payment', '/profile'),
        (v_referral.referrer_id, 'Referral bonus!', 'Your referral completed their first job as a helper. You earned a $5 credit!', 'payment', '/profile');
    END IF;
  END IF;

  -- Check customer (poster) referral bonus
  SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
  INTO v_referral
  FROM public.referrals r
  WHERE r.referred_id = NEW.customer_id
    AND NOT EXISTS (
      SELECT 1 FROM public.referral_credits rc
      WHERE rc.referred_user_id = NEW.customer_id
        AND rc.referral_code_id = r.referral_code_id
    );

  IF FOUND THEN
    INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
    VALUES (NEW.customer_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id);

    INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
    VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.customer_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES 
      (NEW.customer_id, 'Referral bonus earned!', 'Your first posted job was completed — you earned a $5 referral credit!', 'payment', '/profile'),
      (v_referral.referrer_id, 'Referral bonus!', 'Your referral''s first posted job was completed. You earned a $5 credit!', 'payment', '/profile');
  END IF;

  RETURN NEW;
END;
$$;
