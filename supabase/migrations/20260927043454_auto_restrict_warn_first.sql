-- auto_restrict_repeat_violators: warn first (docs/OPEN.md Q183, owner answer
-- 2026-09-27: option b).
--
-- Before (live pg_get_functiondef, 2026-09-26): the trigger skipped its six
-- self-managed types for the TRIGGERING row, but then counted every
-- user_violations row the user ever had (COUNT(*), no type filter, no time
-- window). So an old off_platform warning plus one later low_ratings row put a
-- new account straight into a 7-day temp_banned, with no human looking.
--
-- Now:
--   * it counts only the types it handles itself (everything except
--     admin_action, admin_warning, cancel_with_helper, off_platform,
--     job_denial, no_show — those have their own ladders);
--   * it counts only rows from the last 7 days;
--   * 1st trip in the window = final warning (notified every time, not only
--     when the account was still 'active', because a warning months ago no
--     longer protects anyone); 2nd trip within 7 days = 7-day suspension;
--     3rd within 7 days = 30-day suspension; 4th+ = admin alert only.
--   The 30-day tier is kept as the owner's existing rung, but note it is only
--   reachable when an admin lifts the 7-day suspension early without reversing
--   the strikes: a temp_banned user returns early, and by the time a 7-day
--   suspension expires, the trips that caused it have left the window.
--
-- Notification INSERT order is unchanged (admin alert, 30d own, 30d admin,
-- 7d own, 7d admin, warning own), which seedNeverNotifiesReal classifies by
-- position. Same columns written, same SECURITY DEFINER + search_path, same
-- nested log_cron_defect fallback. Replay-safe: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.auto_restrict_repeat_violators()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  violation_count integer;
  current_status text;
  user_label text;
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  IF NEW.violation_type IN (
    'admin_action', 'admin_warning',
    'cancel_with_helper', 'off_platform',
    'job_denial', 'no_show'
  ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Only this ladder's own types, only the last 7 days (Q183).
    SELECT COUNT(*)
    INTO violation_count
    FROM public.user_violations
    WHERE user_id = NEW.user_id
      AND violation_type NOT IN (
        'admin_action', 'admin_warning',
        'cancel_with_helper', 'off_platform',
        'job_denial', 'no_show'
      )
      AND created_at >= NOW() - INTERVAL '7 days';

    SELECT ban_status, COALESCE(NULLIF(full_name, ''), email, 'A user')
    INTO current_status, user_label
    FROM public.profiles
    WHERE user_id = NEW.user_id;

    IF current_status IN ('temp_banned', 'permanently_banned') THEN
      RETURN NEW;
    END IF;

    IF violation_count >= 4 THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT
        ur.user_id,
        'system_alert',
        format('Repeat offender: %s', user_label),
        format('%s now has %s violations in the last 7 days. Consider a permanent ban.', user_label, violation_count),
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
        NEW.user_id, 'system_alert', 'Account suspended — 30 days',
        format('You have %s violations in the last 7 days. Your account is suspended for 30 days. Reach out to support if you believe this is a mistake.', violation_count),
        '/account-banned', false
      );

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT ur.user_id, 'system_alert',
        format('Auto-restricted (30d): %s', user_label),
        format('%s hit %s violations in 7 days and was auto-temp-banned for 30 days. Review and reverse if mistaken.', user_label, violation_count),
        format('/admin?view=people&user=%s', NEW.user_id), false
      FROM public.user_roles ur WHERE ur.role = 'admin';

    ELSIF violation_count = 2 THEN
      UPDATE public.profiles
      SET ban_status = 'temp_banned',
          auto_suspended_until = NOW() + INTERVAL '7 days'
      WHERE user_id = NEW.user_id;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id, 'system_alert', 'Account suspended — 7 days',
        'This is your second violation in 7 days. Your account is suspended for 7 days. Reach out to support if you believe this is a mistake.',
        '/account-banned', false
      );

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT ur.user_id, 'system_alert',
        format('Auto-restricted (7d): %s', user_label),
        format('%s hit 2 violations in 7 days and was auto-temp-banned for 7 days. Review and reverse if mistaken.', user_label),
        format('/admin?view=people&user=%s', NEW.user_id), false
      FROM public.user_roles ur WHERE ur.role = 'admin';

    ELSIF violation_count = 1 THEN
      IF COALESCE(current_status, 'active') = 'active' THEN
        UPDATE public.profiles SET ban_status = 'final_warning'
        WHERE user_id = NEW.user_id;
      END IF;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id, 'system_alert', 'Final warning',
        'You have a violation on file. Another one within 7 days will result in a 7-day suspension.',
        '/profile?tab=warnings', false
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Nested so that a failure of the LOGGER can never propagate and break the
    -- ladder it is reporting on.
    BEGIN
      PERFORM public.log_cron_defect(
        'auto_restrict_repeat_violators', NEW.user_id::text, SQLERRM,
        jsonb_build_object(
          'violation_id', NEW.id,
          'violation_type', NEW.violation_type,
          'violation_count', violation_count,
          'current_status', current_status));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RAISE NOTICE 'auto_restrict_repeat_violators failed for violation %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- Live proacl before this migration: {postgres=X/postgres,service_role=X/postgres}.
-- Restated so CREATE OR REPLACE can never leave it callable by clients.
REVOKE ALL ON FUNCTION public.auto_restrict_repeat_violators() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_restrict_repeat_violators() TO service_role;
