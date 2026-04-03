CREATE OR REPLACE FUNCTION public.enforce_referral_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  credit_count integer;
BEGIN
  SELECT count(*) INTO credit_count
  FROM public.referral_credits
  WHERE user_id = NEW.user_id AND reason IN ('referrer_bonus', 'first_job_bonus');

  IF credit_count >= 5 THEN
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    VALUES (NEW.user_id, 'referral_abuse', 'User hit referral credit cap (5). Credit blocked.');
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;