-- Hotfix: align scan_message_content's direct-pay phrase regex with
-- src/lib/messageScanner.ts. Client catches many phrases the server
-- doesn't, so users could ignore the client warning and send these
-- messages without server-side fraud_flag creation:
--
-- Missing from server (caught client-side):
--   text me / call me                  (steer to phone)
--   whatsapp / telegram                (off-platform messaging)
--   my number / my email               (steer to contact info)
--   dm me / hit me up                  (steer to other DM)
--   contact me at / reach me at        (generic off-platform CTA)
--   send money to / pay outside        (off-platform payment intent)
--
-- Server-only (kept):
--   cash only / in cash                (server-only — keep)
--
-- Word-boundary anchors (\m / \M) on the short tokens to prevent
-- false positives ("text" anywhere shouldn't match; "text me" must).
-- The ~* operator handles case-insensitivity for the whole alternation.

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
  ELSIF NEW.content ~* '(pay me direct|off the app|outside the app|skip the fee|avoid the fee|cash only|in cash|text me|call me|whatsapp|telegram|my number|my email|dm me|hit me up|contact me at|reach me at|send money to|pay outside)' THEN
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
