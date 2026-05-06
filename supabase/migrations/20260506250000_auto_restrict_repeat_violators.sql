-- Auto-restrict trigger with admin-reverse safety net.
--
-- Thresholds (lifetime user_violations count):
--   3+ violations  →  ban_status='final_warning' (banner only, no functional restriction)
--   5+ violations  →  ban_status='temp_banned' + auto_suspended_until = NOW()+7d
--                     + admin notification fanned to every admin with a
--                       direct link for one-click reverse
--   8+ violations  →  no auto-action (permanent ban requires admin judgement)
--
-- Distinguishing auto-bans from manual bans: auto_suspended_until is set
-- ONLY by this trigger. Manual bans via AdminUsers.tsx flip ban_status
-- but leave auto_suspended_until null. The AdminUsers "Recently
-- auto-restricted" rail filters on (ban_status='temp_banned' AND
-- auto_suspended_until IS NOT NULL).
--
-- Reversal path: admin updates profiles.ban_status='active' and clears
-- auto_suspended_until. No special endpoint needed; existing AdminUsers
-- ban-management already handles status flips.
--
-- Owner-confirmed thresholds — Lexi 2026-05-06.

CREATE OR REPLACE FUNCTION public.auto_restrict_repeat_violators()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  violation_count integer;
  current_status text;
  user_label text;
BEGIN
  BEGIN
    SELECT COUNT(*)
    INTO violation_count
    FROM public.user_violations
    WHERE user_id = NEW.user_id;

    SELECT ban_status, COALESCE(NULLIF(full_name, ''), email, 'A user')
    INTO current_status, user_label
    FROM public.profiles
    WHERE user_id = NEW.user_id;

    -- Never downgrade from a stronger state. Order weakest -> strongest:
    --   active < final_warning < temp_banned < permanently_banned
    IF current_status = 'permanently_banned' THEN
      RETURN NEW;
    END IF;

    IF violation_count >= 5 AND current_status IS DISTINCT FROM 'temp_banned' THEN
      UPDATE public.profiles
      SET ban_status = 'temp_banned',
          auto_suspended_until = NOW() + INTERVAL '7 days'
      WHERE user_id = NEW.user_id;

      -- Notify the user.
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id,
        'system_alert',
        'Account temporarily restricted',
        format('You have %s violations on file. Your account is suspended for 7 days. Reach out to support if you believe this is a mistake.', violation_count),
        '/account-banned',
        false
      );

      -- Fan to every admin so the reverse-if-mistaken loop is fast.
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT
        ur.user_id,
        'system_alert',
        format('Auto-restricted: %s', user_label),
        format('%s hit %s violations and was auto-temp-banned for 7 days. Review and reverse if mistaken.', user_label, violation_count),
        format('/admin/users/%s', NEW.user_id),
        false
      FROM public.user_roles ur
      WHERE ur.role = 'admin';
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

REVOKE ALL ON FUNCTION public.auto_restrict_repeat_violators() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS auto_restrict_repeat_violators_tg ON public.user_violations;
CREATE TRIGGER auto_restrict_repeat_violators_tg
  AFTER INSERT ON public.user_violations
  FOR EACH ROW EXECUTE FUNCTION public.auto_restrict_repeat_violators();
