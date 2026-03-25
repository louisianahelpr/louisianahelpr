
-- 1. Referral abuse: Cap referral credits at 10 per user
CREATE OR REPLACE FUNCTION public.enforce_referral_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  credit_count integer;
BEGIN
  SELECT count(*) INTO credit_count
  FROM public.referral_credits
  WHERE user_id = NEW.user_id AND reason IN ('referrer_bonus', 'first_job_bonus');

  IF credit_count >= 10 THEN
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    VALUES (NEW.user_id, 'referral_abuse', 'User hit referral credit cap (10). Credit blocked.');
    RETURN NULL; -- silently block the insert
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_referral_cap BEFORE INSERT ON public.referral_credits FOR EACH ROW EXECUTE FUNCTION public.enforce_referral_cap();

-- 2. Application spam: Max 15 applications per day per helper
CREATE OR REPLACE FUNCTION public.enforce_application_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  daily_count integer;
BEGIN
  SELECT count(*) INTO daily_count
  FROM public.applications
  WHERE helper_id = NEW.helper_id
    AND created_at > now() - interval '24 hours';

  IF daily_count >= 15 THEN
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    VALUES (NEW.helper_id, 'application_spam', 'Helper exceeded 15 applications in 24h.');
    RAISE EXCEPTION 'You have reached the daily application limit (15). Please try again tomorrow.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_application_limit BEFORE INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.enforce_application_limit();

-- 3. Review manipulation: Flag reviews on jobs with budget < 20 or completed in < 30 min
CREATE OR REPLACE FUNCTION public.flag_suspicious_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_job RECORD;
  v_duration interval;
BEGIN
  SELECT budget, created_at, updated_at, status INTO v_job
  FROM public.jobs WHERE id = NEW.job_id;

  IF v_job IS NULL OR v_job.status != 'completed' THEN
    RETURN NEW;
  END IF;

  v_duration := v_job.updated_at - v_job.created_at;

  IF v_job.budget < 20 AND v_duration < interval '30 minutes' THEN
    INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
    VALUES (NEW.reviewer_id, 'review_manipulation',
      'Review on low-budget ($' || v_job.budget || ') job completed in ' || extract(epoch from v_duration)/60 || ' min',
      NEW.job_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER flag_suspicious_review AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.flag_suspicious_review();

-- 4. Job posting abuse: Max 5 open jobs per user
CREATE OR REPLACE FUNCTION public.enforce_open_job_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  open_count integer;
BEGIN
  SELECT count(*) INTO open_count
  FROM public.jobs
  WHERE customer_id = NEW.customer_id
    AND status = 'open';

  IF open_count >= 5 THEN
    RAISE EXCEPTION 'You can have a maximum of 5 open jobs at a time. Please wait for existing jobs to be accepted or close them first.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_open_job_limit BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_open_job_limit();

-- 5. Message flooding: Max 30 messages per hour per sender
CREATE OR REPLACE FUNCTION public.enforce_message_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  msg_count integer;
BEGIN
  SELECT count(*) INTO msg_count
  FROM public.messages
  WHERE sender_id = NEW.sender_id
    AND created_at > now() - interval '1 hour';

  IF msg_count >= 30 THEN
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    VALUES (NEW.sender_id, 'message_flooding', 'User sent 30+ messages in 1 hour.');
    RAISE EXCEPTION 'You are sending messages too quickly. Please slow down.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_message_rate BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.enforce_message_rate();
