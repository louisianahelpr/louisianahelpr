-- Hotfix to 20260507010000: remove the 2 ambiguous phrases that
-- could trigger server-side fraud_flags on legitimate conversations.
--
-- "my number" and "my email" are caught client-side because the
-- client warning is non-destructive (yellow toast banner, user can
-- still send). On the SERVER side, a fraud_flag has real consequences:
-- 2 flags in 24h triggers a 7-day auto-suspend.
--
-- A user typing "Could you please update my email address?" (an
-- entirely legitimate request inside chat) would server-side trigger
-- a fraud_flag. Two such legitimate messages in a day = 7-day
-- suspension. That's a real risk.
--
-- Resolution: server keeps the unambiguous phrases (text me, call
-- me, whatsapp, telegram, dm me, hit me up, contact me at, reach me
-- at, send money to, pay outside) but drops the two ambiguous ones.
-- Client still catches them as a softer warning — the layered
-- defense (client-warn for ambiguous, server-flag for unambiguous)
-- is the right asymmetry.

CREATE OR REPLACE FUNCTION public.scan_message_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_matched boolean := false;
  v_reason text := null;
  v_recent_flag_count integer;
BEGIN
  IF NEW.content ~* '[0-9]{3}[^0-9]?[0-9]{3}[^0-9]?[0-9]{4}' THEN
    v_matched := true; v_reason := 'Phone number detected';
  ELSIF NEW.content ~* '[a-z0-9._]+@[a-z0-9]+\.[a-z]{2,}' THEN
    v_matched := true; v_reason := 'Email address detected';
  ELSIF NEW.content ~* '(venmo|cashapp|cash app|zelle|paypal|apple\s*pay|google\s*pay|crypto|bitcoin|\mbtc\M|\meth\M)' THEN
    v_matched := true; v_reason := 'Off-platform payment service mentioned';
  ELSIF NEW.content ~* '(pay me direct|off the app|outside the app|skip the fee|avoid the fee|cash only|in cash|text me|call me|whatsapp|telegram|dm me|hit me up|contact me at|reach me at|send money to|pay outside)' THEN
    v_matched := true; v_reason := 'Off-platform payment intent detected';
  END IF;

  IF v_matched THEN
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;

    INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
    VALUES (NEW.sender_id, 'off_platform_contact',
      v_reason || ' — message: ' || left(NEW.content, 200),
      NEW.job_id);

    SELECT count(*) INTO v_recent_flag_count
    FROM public.fraud_flags
    WHERE user_id = NEW.sender_id
      AND flag_type = 'off_platform_contact'
      AND created_at > now() - interval '24 hours';

    IF v_recent_flag_count >= 2 THEN
      UPDATE public.profiles
      SET auto_suspended_until = now() + interval '7 days'
      WHERE user_id = NEW.sender_id
        AND (auto_suspended_until IS NULL OR auto_suspended_until < now());

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.sender_id, '🚫 Account temporarily suspended',
        'Your account has been auto-suspended for 7 days due to repeated attempts to share off-platform contact info. Contact support if you believe this is an error.',
        'warning', '/support');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.scan_message_content() FROM PUBLIC, anon, authenticated;
