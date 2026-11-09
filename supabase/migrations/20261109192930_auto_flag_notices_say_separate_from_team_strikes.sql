-- F191 (owner UI audit 11-09, Part 3 message review; lead plan approved 11-09: WORDING ONLY, no rule changes).
-- Members are told two strike rules, and both are real, as two separate counts:
--   * strikes from our team (admin-user-actions formal_warning): 1 warning, 2 final warning, 3 a 7-day suspension;
--   * automatic flags (this trigger): only its own violation types, over the last 7 days: 1 final warning, 2 a 7-day
--     suspension, 3 a 30-day suspension, 4+ an admin review alert.
-- Neither message said the other count exists, so a member on strike 1 who got an automatic flag read the opposite of
-- their email. The three MEMBER notices here now say they come from the automatic rule, which runs alongside the 3-strike
-- rule for warnings from our team (review 11-09: the team count reads every warning row, automatic ones too, so the
-- two are NOT separate counts; "alongside" is the true word). The admin notices, every count, window, status, link and action are unchanged.
--
-- The body below is the LIVE definition (pg_get_functiondef on prod, 11-09, md5 7c83c709a82d98cf69e4f2e6402a89b8,
-- the same as 20261002055040's) with ONLY the three member notice strings changed. Replay-safe: CREATE OR REPLACE;
-- REVOKE/GRANT restated (live proacl {postgres=X/postgres,service_role=X/postgres}).
-- Proof: src/test/pglite/autoFlagNoticeWording.pglite.mjs (3x replay; same ladder, new words; --before red).

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
  suspended_rows integer;
  profile_found boolean;
  warned_rows integer;
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
    -- Q744: one ladder step per user at a time. Two violations inserted in
    -- separate transactions used to each count only themselves (1), so both
    -- sent a final warning and neither suspended. The lock is held to commit,
    -- and the COUNT below takes a fresh snapshot after it, so the second
    -- transaction waits and then sees the first one's row.
    PERFORM pg_advisory_xact_lock(hashtextextended('auto_restrict_repeat_violators:' || NEW.user_id::text, 0));

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
    profile_found := FOUND;

    IF current_status IN ('temp_banned', 'permanently_banned') THEN
      RETURN NEW;
    END IF;

    IF violation_count >= 4 THEN
      -- Q834: no profile row means no account to review; send the admins
      -- nothing (user_label would be NULL) and log the miss, as Q820 does.
      IF NOT profile_found THEN
        BEGIN
          PERFORM public.log_cron_defect(
            'auto_restrict_repeat_violators', NEW.user_id::text,
            'repeat offender: no profiles row; admin notice skipped',
            jsonb_build_object('violation_id', NEW.id, 'violation_count', violation_count));
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        RETURN NEW;
      END IF;

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
      GET DIAGNOSTICS suspended_rows = ROW_COUNT;

      -- Q745: no profile row means nothing was suspended; say nothing to the
      -- user or the admins, and log the miss instead.
      IF suspended_rows = 0 THEN
        BEGIN
          PERFORM public.log_cron_defect(
            'auto_restrict_repeat_violators', NEW.user_id::text,
            'suspension (30d) updated 0 profiles rows; notices skipped',
            jsonb_build_object('violation_id', NEW.id, 'violation_count', violation_count));
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        RETURN NEW;
      END IF;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id, 'system_alert', 'Account suspended — 30 days',
        format('Our system flagged %s problems on your account within 7 days, so it is suspended for 30 days. This automatic rule runs alongside the 3-strike rule for warnings from our team. Reach out to support if you think this is a mistake.', violation_count),
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
      GET DIAGNOSTICS suspended_rows = ROW_COUNT;

      -- Q745: no profile row means nothing was suspended; say nothing to the
      -- user or the admins, and log the miss instead.
      IF suspended_rows = 0 THEN
        BEGIN
          PERFORM public.log_cron_defect(
            'auto_restrict_repeat_violators', NEW.user_id::text,
            'suspension (7d) updated 0 profiles rows; notices skipped',
            jsonb_build_object('violation_id', NEW.id, 'violation_count', violation_count));
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        RETURN NEW;
      END IF;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id, 'system_alert', 'Account suspended — 7 days',
        'Our system flagged a 2nd problem on your account within 7 days, so it is suspended for 7 days. This automatic rule runs alongside the 3-strike rule for warnings from our team. Reach out to support if you think this is a mistake.',
        '/account-banned', false
      );

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT ur.user_id, 'system_alert',
        format('Auto-restricted (7d): %s', user_label),
        format('%s hit 2 violations in 7 days and was auto-temp-banned for 7 days. Review and reverse if mistaken.', user_label),
        format('/admin?view=people&user=%s', NEW.user_id), false
      FROM public.user_roles ur WHERE ur.role = 'admin';

    ELSIF violation_count = 1 THEN
      -- Q820: no profile row means there is no strike state to warn about;
      -- say nothing and log the miss (as Q745 does for the suspensions).
      IF NOT profile_found THEN
        BEGIN
          PERFORM public.log_cron_defect(
            'auto_restrict_repeat_violators', NEW.user_id::text,
            'final warning: no profiles row; notice skipped',
            jsonb_build_object('violation_id', NEW.id, 'violation_count', violation_count));
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        RETURN NEW;
      END IF;

      IF COALESCE(current_status, 'active') = 'active' THEN
        UPDATE public.profiles SET ban_status = 'final_warning'
        WHERE user_id = NEW.user_id;
        GET DIAGNOSTICS warned_rows = ROW_COUNT;
        IF warned_rows = 0 THEN
          BEGIN
            PERFORM public.log_cron_defect(
              'auto_restrict_repeat_violators', NEW.user_id::text,
              'final warning updated 0 profiles rows; notice skipped',
              jsonb_build_object('violation_id', NEW.id, 'violation_count', violation_count));
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
          RETURN NEW;
        END IF;
      END IF;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id, 'system_alert', 'Final warning',
        'Our system flagged a problem on your account. If it flags another within 7 days, your account is suspended for 7 days. This automatic rule runs alongside the 3-strike rule for warnings from our team.',
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
$function$
;

REVOKE ALL ON FUNCTION public.auto_restrict_repeat_violators() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_restrict_repeat_violators() TO service_role;
