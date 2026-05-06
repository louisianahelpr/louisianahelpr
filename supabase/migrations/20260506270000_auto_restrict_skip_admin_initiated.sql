-- Bridge fix: the trigger was firing on every user_violations insert,
-- including rows AdminUsers creates as part of a manual ban
-- (violation_type 'admin_action' or 'admin_warning'). When that happened
-- on a user who already had 1 prior strike, the trigger's auto-ban (7d)
-- clobbered the admin's intended duration AND made the user appear in
-- the auto-restricted rail as if they were auto-banned.
--
-- Fix: skip the auto-action branch when the inserted row is
-- admin-initiated. Lifetime count still includes admin rows so future
-- non-admin strikes still escalate correctly.

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
  -- Admin-initiated inserts mean an admin is already taking explicit
  -- action via AdminUsers / admin-user-actions. The trigger must not
  -- second-guess that — auto-action only on system-detected strikes
  -- (cancel_with_helper, off_platform, low_ratings, job_denial, no_show, …).
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
        format('/admin/users/%s', NEW.user_id),
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
        format('/admin/users/%s', NEW.user_id),
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
        format('/admin/users/%s', NEW.user_id),
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
