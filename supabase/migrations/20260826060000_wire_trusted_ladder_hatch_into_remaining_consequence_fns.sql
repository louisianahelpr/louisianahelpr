-- Wire the trusted-ladder escape hatch into the remaining consequence functions.
--
-- THE BUG, in plain language: `prevent_self_escalation()` is a BEFORE UPDATE
-- trigger on `profiles` that force-reverts server-owned columns (ban_status,
-- auto_suspended_until, approval_status, credential statuses, ...) unless the
-- caller is an admin or has no JWT at all. SECURITY DEFINER changes the
-- executing ROLE, not `auth.uid()` — the caller's JWT claim survives into the
-- function body. So every "trusted ladder" RPC invoked from a normal user
-- session had its account-status write SILENTLY REVERTED: no error, no clue.
--
-- The ladders LOOKED like they worked, because the `user_violations` row and
-- the notification both landed. Only the account status — the part that
-- actually restricts anyone — never changed. Warnings, final warnings and
-- suspensions have therefore never applied in production.
--
-- THE FIX: migration 20260826040000 added a transaction-local GUC escape hatch
-- (`app.trusted_ladder_write`) that `prevent_self_escalation()` (and the new
-- jobs field-lock trigger) honour. This migration wires that hatch into every
-- OTHER trusted ladder function. Each body is otherwise byte-identical to the
-- live definition; the only change is the added `set_config` line.
--
-- Safety: the GUC is set with is_local = true, so it expires when the calling
-- statement's transaction ends, and PostgREST exposes RPCs rather than raw
-- SQL, so a client can never set it itself.
--
-- Replay-safe: CREATE OR REPLACE throughout — each function is created by an
-- earlier migration, so on a from-scratch replay this file simply replaces it,
-- and re-running is a no-op. CREATE OR REPLACE preserves existing GRANT/REVOKE
-- ACLs, and every signature below is reproduced exactly (verified against
-- p.oid::regprocedure), so no second overload is ever created.
--
-- NOT wired, deliberately: `review_credential(uuid,text,text,text)` writes
-- pinned credential columns but is admin-gated (`has_role(auth.uid(),'admin')`
-- raises otherwise), and `prevent_self_escalation()` already returns early for
-- admins — it was never affected by this bug.

-- 1. apply_job_denial_consequence(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prior_count int;
  v_action text;
  v_is_elite boolean;
  v_shield_available boolean := false;
BEGIN
  -- Trusted ladder: this function is the server deciding a consequence, so its
  -- writes to profiles must survive prevent_self_escalation(). The GUC is
  -- transaction-local (is_local = true) and dies with this transaction.
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Shielded strikes don't count toward escalation.
  SELECT count(*) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = p_helper
     AND violation_type = 'job_denial'
     AND COALESCE(action_taken, '') <> 'forgiven_elite_shield';

  -- Active Elite + no shield used in the rolling window?
  SELECT (p.subscription_tier = 'elite'
          AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now()))
    INTO v_is_elite
    FROM public.profiles p WHERE p.user_id = p_helper;

  IF COALESCE(v_is_elite, false) THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.user_violations
       WHERE user_id = p_helper
         AND action_taken = 'forgiven_elite_shield'
         AND created_at > now() - interval '180 days'
    ) INTO v_shield_available;
  END IF;

  IF v_shield_available THEN
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (p_helper, 'job_denial', p_description, p_job, 'forgiven_elite_shield');
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (p_helper, 'Your Elite shield absorbed this one',
            'As an Elite member, your first reliability strike every 6 months is forgiven. This one''s on the house — the next one counts.',
            'info', '/warnings');
    RETURN jsonb_build_object('action', 'shielded', 'prior_count', v_prior_count);
  END IF;

  v_action := CASE
    WHEN v_prior_count >= 3 THEN 'permanent_ban'
    WHEN v_prior_count = 2 THEN 'temp_ban'
    WHEN v_prior_count = 1 THEN 'warning'
    ELSE 'none'
  END;

  INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
  VALUES (p_helper, 'job_denial', p_description, p_job, v_action);

  IF v_action = 'warning' THEN
    UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = p_helper;
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (p_helper, 'Final warning',
            'This is your second reliability strike. One more — declining, ignoring, or cancelling a job you committed to — and your account is suspended for 7 days.',
            'warning', '/warnings');
  ELSIF v_action = 'temp_ban' THEN
    UPDATE public.profiles
       SET ban_status = 'temp_banned',
           auto_suspended_until = now() + interval '7 days'
     WHERE user_id = p_helper;
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (p_helper, 'Account suspended for 7 days',
            'Third reliability strike — your account is suspended for 7 days. A fourth strike is a permanent ban.',
            'warning', '/warnings');
  ELSIF v_action = 'permanent_ban' THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
    VALUES (p_helper, 'permanent',
            'Fourth reliability strike (declined, ignored, or cancelled committed jobs)', p_helper);
    UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = p_helper;
  END IF;

  RETURN jsonb_build_object('action', v_action, 'prior_count', v_prior_count);
END;
$function$;

-- 2. apply_message_violation_consequence(text,text)
CREATE OR REPLACE FUNCTION public.apply_message_violation_consequence(p_description text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_desc text;
  v_prior_count int;
  v_action text;
  v_status text;
  v_dupe uuid;
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Same shape the client used to write, so old and new rows read alike.
  v_desc := COALESCE(p_description, 'Off-platform contact attempt')
            || ' | Message: "' || left(COALESCE(p_content, ''), 300) || '"';

  -- IDEMPOTENCE / DEDUPE. Retrying the identical blocked message is ONE
  -- offence, not a new strike — the client already guards this per session,
  -- but the guard has to live where it cannot be bypassed or lost to a reload.
  -- A same-text re-report inside 24h returns the standing verdict unchanged.
  SELECT id INTO v_dupe
    FROM public.user_violations
   WHERE user_id = v_user
     AND violation_type = 'off_platform'
     AND description = v_desc
     AND created_at > now() - interval '24 hours'
   LIMIT 1;

  IF v_dupe IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'duplicate', 'violation_id', v_dupe);
  END IF;

  SELECT count(*) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = v_user AND violation_type = 'off_platform';

  v_action := CASE
    WHEN v_prior_count >= 2 THEN 'pending_ban_review'
    WHEN v_prior_count = 1 THEN 'final_warning'
    ELSE 'warning'
  END;

  INSERT INTO public.user_violations (user_id, violation_type, description, action_taken)
  VALUES (v_user, 'off_platform', v_desc, v_action);

  SELECT ban_status INTO v_status FROM public.profiles WHERE user_id = v_user;

  IF v_action = 'warning' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user, 'Warning — keep it on Helpr',
            'That message was blocked for sharing contact info or taking the job off-platform. This is a warning; a second one is a final warning.',
            'warning', '/warnings');

  ELSIF v_action = 'final_warning' THEN
    -- Never downgrade a harsher standing status into 'final_warning'.
    UPDATE public.profiles
       SET ban_status = 'final_warning'
     WHERE user_id = v_user
       AND COALESCE(ban_status, 'active') NOT IN ('temp_banned', 'permanently_banned');
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user, 'Final warning',
            'This is your second blocked message. One more and your account is restricted for 7 days while an admin reviews it.',
            'warning', '/warnings');

  ELSIF v_action = 'pending_ban_review' THEN
    -- A REVERSIBLE restriction, not a ban: the account is suspended for 7 days
    -- (and sweep_expired_auto_bans lifts it automatically) so the user cannot
    -- keep sending while a human looks at the case. If the admin confirms, the
    -- permanent ban replaces it; if the admin dismisses, nothing irreversible
    -- ever happened. A user already permanently banned is left alone.
    IF COALESCE(v_status, 'active') <> 'permanently_banned' THEN
      UPDATE public.profiles
         SET ban_status = 'temp_banned',
             auto_suspended_until = GREATEST(
               COALESCE(auto_suspended_until, now()), now() + interval '7 days')
       WHERE user_id = v_user;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (v_user, 'Account restricted for 7 days',
              'Third blocked message — your account is restricted for 7 days and an admin is reviewing it. If you think the filter got this wrong, email admin@louisianahelpr.com.',
              'warning', '/warnings');
    END IF;

    -- Put the case where a person will actually see it. Same admin-fanout
    -- pattern auto_restrict_repeat_violators already uses.
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    SELECT ur.user_id,
           'system_alert',
           'Ban review needed',
           format('%s has %s blocked messages on file and is restricted for 7 days pending your decision.',
                  COALESCE(NULLIF(p.full_name, ''), p.email, 'A user'), v_prior_count + 1),
           '/admin?view=banreview',
           false
      FROM public.user_roles ur
      CROSS JOIN LATERAL (
        SELECT full_name, email FROM public.profiles WHERE user_id = v_user
      ) p
     WHERE ur.role = 'admin';
  END IF;

  RETURN jsonb_build_object('action', v_action, 'prior_count', v_prior_count);
END;
$function$;

-- 3. report_helper_no_show(uuid)
CREATE OR REPLACE FUNCTION public.report_helper_no_show(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_helper_id uuid;
  v_job_title text;
  v_payment_status text;
  v_date_needed date;
  v_start_time time;
  v_starts_at timestamptz;
  v_prior_count int;
  v_action text;
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  -- (Also releases the jobs field-lock for the server-owned unassign below.)
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Lock the job row.
  SELECT j.customer_id, j.helper_id, j.title, j.payment_status, j.date_needed, j.start_time
    INTO v_customer_id, v_helper_id, v_job_title, v_payment_status, v_date_needed, v_start_time
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the job's poster may report a no-show.
  IF v_customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_helper_id IS NULL THEN
    RAISE EXCEPTION 'no_helper_assigned';
  END IF;

  -- GUARD 1 — the job must be funded. Closes the throwaway-job ban attack.
  IF v_payment_status IS NULL OR v_payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'job_not_funded'
      USING HINT = 'A no-show can only be reported on a funded job.';
  END IF;

  -- GUARD 2 — the scheduled start must have passed.
  v_starts_at := (v_date_needed + COALESCE(v_start_time, '00:00'::time))
                   AT TIME ZONE 'America/Chicago';
  IF v_starts_at IS NULL OR now() < v_starts_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = 'Wait until the scheduled start time before reporting a no-show.';
  END IF;

  -- GUARD 3a — one report per job.
  IF EXISTS (
    SELECT 1 FROM public.user_violations
    WHERE job_id = p_job_id AND violation_type = 'no_show'
  ) THEN
    RAISE EXCEPTION 'already_reported'
      USING HINT = 'This job already has a no-show report.';
  END IF;

  -- GUARD 3b — escalate on DISTINCT reporters, so one poster acting alone
  -- can warn but never ban.
  SELECT count(DISTINCT reported_by) INTO v_prior_count
  FROM public.user_violations
  WHERE user_id = v_helper_id
    AND violation_type = 'no_show'
    AND reported_by IS DISTINCT FROM auth.uid();

  v_action := CASE WHEN v_prior_count >= 1 THEN 'permanent_ban' ELSE 'warning' END;

  INSERT INTO public.user_violations (user_id, violation_type, description, job_id, reported_by, action_taken)
  VALUES (v_helper_id, 'no_show',
          'No-show for job: ' || COALESCE(v_job_title, 'Unknown'),
          p_job_id, auth.uid(), v_action);

  IF v_action = 'permanent_ban' THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
    VALUES (v_helper_id, 'permanent', 'Repeated no-show violations', auth.uid());
    UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = v_helper_id;
  ELSE
    UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = v_helper_id;
  END IF;

  UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'action', v_action,
    'prior_count', v_prior_count,
    'helper_id', v_helper_id,
    'job_title', v_job_title
  );
END;
$function$;

-- 4. auto_restrict_repeat_violators()  [trigger on user_violations]
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
    SELECT COUNT(*)
    INTO violation_count
    FROM public.user_violations
    WHERE user_id = NEW.user_id;

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
        NEW.user_id, 'system_alert', 'Account suspended — 30 days',
        format('You now have %s violations on file. Your account is suspended for 30 days. Reach out to support if you believe this is a mistake.', violation_count),
        '/account-banned', false
      );

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT ur.user_id, 'system_alert',
        format('Auto-restricted (30d): %s', user_label),
        format('%s hit %s violations and was auto-temp-banned for 30 days. Review and reverse if mistaken.', user_label, violation_count),
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
        format('You now have %s violations on file. Your account is suspended for 7 days. Reach out to support if you believe this is a mistake.', violation_count),
        '/account-banned', false
      );

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT ur.user_id, 'system_alert',
        format('Auto-restricted (7d): %s', user_label),
        format('%s hit %s violations and was auto-temp-banned for 7 days. Review and reverse if mistaken.', user_label, violation_count),
        format('/admin?view=people&user=%s', NEW.user_id), false
      FROM public.user_roles ur WHERE ur.role = 'admin';

    ELSIF violation_count = 1
       AND COALESCE(current_status, 'active') = 'active' THEN
      UPDATE public.profiles SET ban_status = 'final_warning'
      WHERE user_id = NEW.user_id;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        NEW.user_id, 'system_alert', 'Final warning',
        'You have a violation on file. One more will result in a 7-day suspension.',
        '/profile', false
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'auto_restrict_repeat_violators failed for violation %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- 5. sync_credential_from_check()  [trigger; writes profiles.background_check_status]
CREATE OR REPLACE FUNCTION public.sync_credential_from_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  -- background_check_status is pinned by prevent_self_escalation(); this
  -- trigger is the server writing it from a verified check result.
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  IF NEW.status = 'passed' THEN
    UPDATE helper_credentials
    SET status = 'verified',
        verified_at = now(),
        expiration_date = NEW.expires_at::date
    WHERE id = NEW.credential_id;
  ELSIF NEW.status = 'failed' THEN
    UPDATE helper_credentials
    SET status = 'rejected',
        rejection_reason = NEW.failure_reason
    WHERE id = NEW.credential_id;
  ELSIF NEW.status = 'expired' THEN
    UPDATE helper_credentials
    SET status = 'expired'
    WHERE id = NEW.credential_id;
  END IF;

  IF NEW.check_type = 'background' THEN
    IF NEW.status = 'passed' THEN
      UPDATE profiles SET background_check_status = 'verified' WHERE user_id = NEW.user_id;
    ELSIF NEW.status IN ('failed', 'expired') THEN
      UPDATE profiles SET background_check_status = 'failed' WHERE user_id = NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
