-- PROPOSED — NOT APPLIED. Owner sign-off required before this lands.
--
-- This trigger auto-changes profiles.ban_status based on user_violations
-- count. It's the companion to auto_escalate_reports (which only sends
-- notifications). Touching ban_status is high blast radius — every
-- threshold here is a product/policy call, not an engineering one.
--
-- Current proposal:
--   3+ violations  →  ban_status = 'final_warning' (banner shown to user)
--   5+ violations  →  ban_status = 'temp_banned' + 7-day auto_suspended_until
--   8+ violations  →  (NOT auto — admin must permanent-ban manually)
--
-- Things to confirm before applying:
--   • Counts: should this be lifetime, last 12 months, or last 90 days?
--   • Reversibility: do we want a manual "reset to active" admin button
--     to clear ban_status if a violation gets reversed?
--   • Notification copy: above messages were drafted by Claude, not Lexi
--   • Does StrikeBanner (src/components/StrikeBanner.tsx) need updates
--     to handle the new automatic transitions cleanly?
--
-- Apply path once approved:
--   1. Adjust thresholds + copy here
--   2. supabase mcp apply_migration --name auto_restrict_repeat_violators
--   3. Move this file to supabase/migrations/<ts>_auto_restrict_repeat_violators.sql

CREATE OR REPLACE FUNCTION public.auto_restrict_repeat_violators()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  violation_count integer;
  current_status text;
BEGIN
  BEGIN
    SELECT COUNT(*)
    INTO violation_count
    FROM public.user_violations
    WHERE user_id = NEW.user_id;

    SELECT ban_status INTO current_status
    FROM public.profiles
    WHERE user_id = NEW.user_id;

    -- Order weakest → strongest:
    --   active < final_warning < temp_banned < permanently_banned
    -- Never downgrade from a stronger state.
    IF current_status = 'permanently_banned' THEN
      RETURN NEW;
    END IF;

    IF violation_count >= 5 AND current_status IS DISTINCT FROM 'temp_banned' THEN
      UPDATE public.profiles
      SET ban_status = 'temp_banned',
          auto_suspended_until = NOW() + INTERVAL '7 days'
      WHERE user_id = NEW.user_id;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id,
        'system_alert',
        'Account temporarily restricted',
        format('You have %s violations on file. Your account is suspended for 7 days. Reach out to support if you believe this is a mistake.', violation_count),
        '/account-banned',
        false
      );
    ELSIF violation_count >= 3
       AND COALESCE(current_status, 'active') = 'active' THEN
      UPDATE public.profiles
      SET ban_status = 'final_warning'
      WHERE user_id = NEW.user_id;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id,
        'system_alert',
        'Final warning',
        format('You have %s violations on file. One more will result in a temporary suspension.', violation_count),
        '/account',
        false
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'auto_restrict_repeat_violators failed for violation %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_restrict_repeat_violators_tg ON public.user_violations;
CREATE TRIGGER auto_restrict_repeat_violators_tg
  AFTER INSERT ON public.user_violations
  FOR EACH ROW EXECUTE FUNCTION public.auto_restrict_repeat_violators();
