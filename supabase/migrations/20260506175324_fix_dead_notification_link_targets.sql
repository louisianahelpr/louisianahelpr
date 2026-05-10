-- Bridge fix #2: notification links pointed at routes that don't exist.
--   /admin/users/<id>  →  Admin app only has /admin (with internal view state)
--   /account           →  only /account-pending|denied|banned + /profile exist
--
-- Repoint to working URLs. Admin links now use ?view=people&user=<id>
-- which Admin.tsx + AdminUsers.tsx both honor (Admin reads ?view= to pick
-- the sub-view, AdminUsers reads ?user= to openProfile automatically).
-- /account becomes /profile so the final-warning banner CTA actually
-- goes somewhere.

CREATE OR REPLACE FUNCTION public.auto_escalate_reports()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  open_count integer;
  user_label text;
BEGIN
  IF NEW.reported_type IS DISTINCT FROM 'user' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT COUNT(*)
    INTO open_count
    FROM public.reports r
    WHERE r.reported_type = 'user'
      AND r.reported_id = NEW.reported_id
      AND r.created_at > NOW() - INTERVAL '90 days'
      AND COALESCE(r.status, 'open') NOT IN ('dismissed', 'invalid', 'resolved');

    IF open_count < 3 THEN
      RETURN NEW;
    END IF;

    -- Carpet-bomb prevention: skip if any admin already has an unread
    -- alert for this user from the last 7 days. Match on the new link
    -- prefix so prior pre-fix /admin/users/<id> rows don't false-match.
    IF EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.type = 'system_alert'
        AND n.created_at > NOW() - INTERVAL '7 days'
        AND n.link LIKE format('/admin?view=people&user=%s%%', NEW.reported_id)
    ) THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(NULLIF(full_name, ''), email, 'unknown user')
    INTO user_label
    FROM public.profiles
    WHERE user_id = NEW.reported_id;

    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    SELECT
      ur.user_id,
      'system_alert',
      'User flagged — 3+ reports',
      format('%s has %s open reports in the last 90 days. Review the account.', COALESCE(user_label, 'A user'), open_count),
      format('/admin?view=people&user=%s', NEW.reported_id),
      false
    FROM public.user_roles ur
    WHERE ur.role = 'admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'auto_escalate_reports failed for report %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_escalate_reports() FROM PUBLIC, anon, authenticated;

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
  IF NEW.violation_type IN ('admin_action', 'admin_warning') THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT COUNT(*)
    INTO violation_count
    FROM public.user_violations
    WHERE user_id = NEW.user_id;

    SELECT ban_status, COALESCE(NULLIF(full_name, ''), email, 'A user')
    INTO current_status, user_label
    FROM public.profiles
    WHERE user_id = NEW.user_id;

    IF current_status = 'permanently_banned' THEN
      RETURN NEW;
    END IF;

    IF violation_count >= 4 THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT
        ur.user_id,
        'system_alert',
        format('Repeat offender: %s', user_label),
        format('%s now has %s violations on file (currently auto-temp-banned). Consider a permanent ban.', user_label, violation_count),
        format('/admin?view=people&user=%s', NEW.user_id),
        false
      FROM public.user_roles ur
      WHERE ur.role = 'admin';

    ELSIF violation_count = 3 THEN
      UPDATE public.profiles
      SET ban_status = 'temp_banned',
          auto_suspended_until = NOW() + INTERVAL '30 days'
      WHERE user_id = NEW.user_id;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id,
        'system_alert',
        'Account suspended — 30 days',
        format('You now have %s violations on file. Your account is suspended for 30 days. Reach out to support if you believe this is a mistake.', violation_count),
        '/account-banned',
        false
      );

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT
        ur.user_id,
        'system_alert',
        format('Auto-restricted (30d): %s', user_label),
        format('%s hit %s violations and was auto-temp-banned for 30 days. Review and reverse if mistaken.', user_label, violation_count),
        format('/admin?view=people&user=%s', NEW.user_id),
        false
      FROM public.user_roles ur
      WHERE ur.role = 'admin';

    ELSIF violation_count = 2 THEN
      UPDATE public.profiles
      SET ban_status = 'temp_banned',
          auto_suspended_until = NOW() + INTERVAL '7 days'
      WHERE user_id = NEW.user_id;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id,
        'system_alert',
        'Account suspended — 7 days',
        format('You now have %s violations on file. Your account is suspended for 7 days. Reach out to support if you believe this is a mistake.', violation_count),
        '/account-banned',
        false
      );

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT
        ur.user_id,
        'system_alert',
        format('Auto-restricted (7d): %s', user_label),
        format('%s hit %s violations and was auto-temp-banned for 7 days. Review and reverse if mistaken.', user_label, violation_count),
        format('/admin?view=people&user=%s', NEW.user_id),
        false
      FROM public.user_roles ur
      WHERE ur.role = 'admin';

    ELSIF violation_count = 1
       AND COALESCE(current_status, 'active') = 'active' THEN
      UPDATE public.profiles
      SET ban_status = 'final_warning'
      WHERE user_id = NEW.user_id;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id,
        'system_alert',
        'Final warning',
        'You have a violation on file. One more will result in a 7-day suspension.',
        '/profile',
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
