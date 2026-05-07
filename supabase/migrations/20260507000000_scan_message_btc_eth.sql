-- Hotfix: align scan_message_content regex with src/lib/messageScanner.ts
--
-- The client-side scanner catches 'btc' and 'eth' as standalone tokens
-- (cryptocurrency abbreviations) but the server-side trigger only
-- caught 'crypto' and 'bitcoin'. Result: a sender typing
-- "send to my btc wallet 0x1234..." would see the client warning,
-- send anyway, and the server would NOT create a fraud_flag → no
-- auto-suspend after 2 flags in 24h, no admin visibility.
--
-- Fix: add \b btc \b and \b eth \b to the payment-service regex.
-- Word boundaries (\m / \M in PostgreSQL POSIX) prevent false
-- positives from words containing those substrings (e.g. "ethics",
-- "method", "depth"). Case-insensitive via the existing ~* operator.
--
-- Same module otherwise — preserves the layered defense (containment
-- + fraud_flag + auto-suspend at 2 flags in 24h).

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
  ELSIF NEW.content ~* '(pay me direct|off the app|outside the app|skip the fee|avoid the fee|cash only|in cash)' THEN
    v_matched := true; v_reason := 'Off-platform payment intent detected';
  END IF;

  IF v_matched THEN
    -- Containment: hide from recipient
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;

    -- Log fraud flag
    INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
    VALUES (NEW.sender_id, 'off_platform_contact',
      v_reason || ' — message: ' || left(NEW.content, 200),
      NEW.job_id);

    -- Auto-suspend after 2 flags in rolling 24h
    SELECT count(*) INTO v_recent_flag_count
    FROM public.fraud_flags
    WHERE user_id = NEW.sender_id
      AND flag_type = 'off_platform_contact'
      AND created_at > now() - interval '24 hours';

    -- (count includes the row we're about to insert via the prior INSERT; threshold = 2)
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
