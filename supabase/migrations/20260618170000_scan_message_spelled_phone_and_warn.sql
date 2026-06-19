-- F-TRUST-02 + F-TRUST-03: harden the off-platform message gate.
--
-- F-TRUST-02: the phone check matched ASCII digit groups only, so fullwidth
-- digits (５０４...) and spelled-out numbers ("five zero four ...") slipped past
-- the auto-suspend. We now (a) normalize fullwidth digits to ASCII before the
-- digit regex and (b) flag a sequence of 7+ consecutive spelled number-words.
-- The 7-in-a-row threshold means casual usage ("two cats, three dogs") can't
-- trip it -- only an actual spelled-out phone number does.
--
-- F-TRUST-03: previously a user's 2nd flag in 24h immediately auto-suspended
-- for 7 days, so a false-positive pair could suspend a good actor with no
-- notice. Now the FIRST flag sends a warning notification (a chance to course-
-- correct); suspension still kicks in on the 2nd flag for repeat offenders.
--
-- Replay-safe: CREATE OR REPLACE is idempotent; the trigger already exists.

CREATE OR REPLACE FUNCTION public.scan_message_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_matched boolean := false;
  v_reason text := null;
  v_recent_flag_count integer;
  -- Normalize fullwidth digits (U+FF10-U+FF19) to ASCII so they can't evade
  -- the phone regex. (F-TRUST-02)
  v_norm text := translate(
    NEW.content,
    '０１２３４５６７８９',
    '0123456789'
  );
BEGIN
  IF v_norm ~* '[0-9]{3}[^0-9]?[0-9]{3}[^0-9]?[0-9]{4}' THEN
    v_matched := true; v_reason := 'Phone number detected';
  -- Spelled-out phone number: 7+ consecutive number-words. (F-TRUST-02)
  ELSIF NEW.content ~* '(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}' THEN
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
    ELSE
      -- First strike in 24h: warn instead of suspend, so a one-off
      -- false positive gets notice and a chance to correct. (F-TRUST-03)
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.sender_id, '⚠️ Message hidden',
        'Your message was hidden because it looked like off-platform contact or payment info. Keep payments and contact on Helpr — repeated attempts can lead to a temporary suspension.',
        'warning', '/support');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
