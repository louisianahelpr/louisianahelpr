
-- 1. Update process_referral to only record the referral, no credits
CREATE OR REPLACE FUNCTION public.process_referral(p_referral_code text, p_new_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_code_record RECORD;
BEGIN
  -- Look up the referral code
  SELECT id, user_id INTO v_code_record
  FROM public.referral_codes
  WHERE code = UPPER(p_referral_code);

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Don't allow self-referral
  IF v_code_record.user_id = p_new_user_id THEN
    RETURN FALSE;
  END IF;

  -- Check if already referred
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = p_new_user_id) THEN
    RETURN FALSE;
  END IF;

  -- Create referral record (no credits yet - credits awarded when user posts or completes a job)
  INSERT INTO public.referrals (referrer_id, referred_id, referral_code_id)
  VALUES (v_code_record.user_id, p_new_user_id, v_code_record.id);

  RETURN TRUE;
END;
$$;

-- 2. Create function to check and award referral credits when a job is posted or completed
CREATE OR REPLACE FUNCTION public.check_referral_bonus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_referral RECORD;
  v_acting_user UUID;
BEGIN
  -- Determine the acting user
  IF TG_OP = 'INSERT' THEN
    -- Job posted: the customer
    v_acting_user := NEW.customer_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Job completed: check both customer and helper
    -- Check helper first
    IF NEW.helper_id IS NOT NULL THEN
      -- Check if helper has a pending referral bonus
      SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
      INTO v_referral
      FROM public.referrals r
      WHERE (r.referred_id = NEW.helper_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.referral_credits rc
          WHERE rc.referred_user_id = NEW.helper_id
            AND rc.referral_code_id = r.referral_code_id
        );

      IF FOUND THEN
        -- Credit the referred user (helper)
        INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
        VALUES (NEW.helper_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id);

        -- Credit the referrer
        INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
        VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.helper_id)
        ON CONFLICT DO NOTHING;

        -- Notify both
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES 
          (NEW.helper_id, 'Referral bonus earned!', 'You completed your first job and earned a $5 referral credit!', 'payment', '/profile'),
          (v_referral.referrer_id, 'Referral bonus!', 'Your referral completed their first job. You earned a $5 credit!', 'payment', '/profile');
      END IF;
    END IF;

    -- Now check customer
    v_acting_user := NEW.customer_id;
  ELSE
    RETURN NEW;
  END IF;

  -- Check if the acting user has a pending referral bonus (as referred user)
  SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
  INTO v_referral
  FROM public.referrals r
  WHERE r.referred_id = v_acting_user
    AND NOT EXISTS (
      SELECT 1 FROM public.referral_credits rc
      WHERE rc.referred_user_id = v_acting_user
        AND rc.referral_code_id = r.referral_code_id
    );

  IF FOUND THEN
    -- Credit the referred user
    INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
    VALUES (v_acting_user, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id);

    -- Credit the referrer
    INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
    VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, v_acting_user)
    ON CONFLICT DO NOTHING;

    -- Notify both
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES 
      (v_acting_user, 'Referral bonus earned!', 'You posted your first job and earned a $5 referral credit!', 'payment', '/profile'),
      (v_referral.referrer_id, 'Referral bonus!', 'Your referral posted their first job. You earned a $5 credit!', 'payment', '/profile');
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Create trigger on jobs table
CREATE TRIGGER check_referral_bonus_on_job
  AFTER INSERT OR UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.check_referral_bonus();
