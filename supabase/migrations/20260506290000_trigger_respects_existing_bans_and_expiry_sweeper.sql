-- Two fixes in one migration:
--
-- 1. Trigger now skips auto-action when the user is already in a stronger
--    state (temp_banned or permanently_banned) from any source. Without
--    this, a user with a manual admin temp_ban (custom duration, no
--    auto_suspended_until) who later accumulates a system strike at
--    count=2 had their state overwritten by the trigger's 7-day window.
--    The row still inserts; just no auto-action.
--
-- 2. Expired auto-bans now auto-release. Hourly pg_cron flips
--    profiles.ban_status from 'temp_banned' back to 'active' and clears
--    auto_suspended_until once the suspension window has passed. Manual
--    bans (which leave auto_suspended_until NULL) are NOT affected — the
--    sweeper only matches rows the trigger itself wrote.

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

    -- Don't override an existing stronger ban from any source. Counting
    -- still happens (the row is in user_violations), but the trigger
    -- defers to whatever's already in place.
    IF current_status IN ('temp_banned', 'permanently_banned') THEN
      RETURN NEW;
    END IF;

    IF violation_count >= 4 THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT
        ur.user_id,
        'system_alert',
        format('Repeat offender: %s', user_label),
        format('%s now has %s violations on file. Consider a permanent ban.', user_label, violation_count),
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

-- ── Expiry sweeper ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_expired_auto_bans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  released integer := 0;
BEGIN
  FOR rec IN
    SELECT user_id, COALESCE(NULLIF(full_name, ''), email, 'A user') AS label
    FROM public.profiles
    WHERE ban_status = 'temp_banned'
      AND auto_suspended_until IS NOT NULL
      AND auto_suspended_until < NOW()
    LIMIT 200
  LOOP
    BEGIN
      UPDATE public.profiles
      SET ban_status = 'active',
          auto_suspended_until = NULL
      WHERE user_id = rec.user_id
        AND ban_status = 'temp_banned'
        AND auto_suspended_until IS NOT NULL
        AND auto_suspended_until < NOW();

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.user_id,
        'system_alert',
        'Restriction lifted',
        'Your suspension window has ended. Welcome back — please review the rules to avoid further violations.',
        '/profile',
        false
      );

      released := released + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sweep_expired_auto_bans: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN released;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_expired_auto_bans() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('sweep-expired-auto-bans');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- Hourly: catches expirations within an hour of the actual time, which
-- is fine for a 7-day or 30-day window. Daily would be too coarse if a
-- user is sitting refreshing waiting for unlock.
SELECT cron.schedule(
  'sweep-expired-auto-bans',
  '0 * * * *',
  $cron$SELECT public.sweep_expired_auto_bans();$cron$
);
