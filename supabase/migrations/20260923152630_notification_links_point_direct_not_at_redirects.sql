-- Q194 (owner, 2026-09-23): "The old address shouldn't be redirects, it should
-- be direct." Every link the database produces must name the CURRENT page, and
-- the <Navigate>-only legacy routes in src/App.tsx are deleted in the same
-- change — so a stored or freshly written old address would now be a 404.
--
-- Measured on prod before writing this (read-only, 2026-09-23):
--   * live function bodies (pg_get_functiondef, all non-system schemas) that
--     write a legacy address in CODE: notify_helper_on_tip() and
--     notify_on_payment_escrowed(), both '/earnings' (the "Payout released" and
--     tip notifications). notify_helper_on_direct_offer() only names
--     '/activity?tab=offers' in a comment; its code already writes /jobs.
--   * stored links on a legacy path: notifications.link 75 rows ('/earnings',
--     no query), notification_dedupe_suppressions.link 19 rows ('/earnings').
--     Zero rows on every other legacy path or short-link shape.
--
-- Part 1 re-creates the two producers verbatim from their live bodies with only
-- the link changed. Part 2 rewrites stored rows for EVERY retired path (not only
-- the one with rows today), keeping any query string, so a row written by an
-- older build between measurement and deploy is caught too. Replay-safe: both
-- functions are CREATE OR REPLACE, the UPDATEs match nothing on a second run,
-- and each table is guarded with to_regclass.

-- ── Part 1: producers ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_helper_on_tip()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_job_title text;
BEGIN
  IF NEW.payment_status = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid') THEN
    SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;
    v_title := 'You got a $' || NEW.amount || ' tip!';
    v_msg := 'A poster left you a $' || NEW.amount || ' tip for "' || COALESCE(v_job_title, 'your work') || '". Thanks for going above and beyond.';

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;

    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.helper_id, v_title, v_msg, 'financial_alerts', '/profile?tab=earnings');
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.job_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_payment_escrowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
BEGIN
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow') THEN
    v_title := 'Payment secured in escrow';
    v_msg := 'Your payment for "' || NEW.title || '" is safely held in escrow and will release after the job is completed.';

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.customer_id;

    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id, v_title, v_msg, 'financial_alerts', '/posts?job=' || NEW.id::text);
      PERFORM public.log_notification(NEW.customer_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.id);
    END IF;

    -- Also notify helper their job is funded
    IF NEW.helper_id IS NOT NULL THEN
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = NEW.helper_id;
      IF COALESCE(v_pref, true) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.helper_id, 'Job funded', 'Payment for "' || NEW.title || '" is now in escrow. Get to work!', 'financial_alerts', '/jobs?job=' || NEW.id::text);
        PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Job funded', NEW.id);
      END IF;
    END IF;
  END IF;

  -- Payout released
  IF NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released' AND NEW.helper_id IS NOT NULL THEN
    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;
    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.helper_id, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings');
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger functions: nobody but the owner and the service role executes them.
-- Restated by role name (FROM PUBLIC alone leaves anon's explicit grant).
REVOKE ALL ON FUNCTION public.notify_helper_on_tip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_payment_escrowed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_helper_on_tip() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_on_payment_escrowed() TO service_role;

-- ── Part 1b: the two consequence-ladder functions ─────────────────────────
-- Live prod ALREADY writes /profile?tab=warnings here: 20260831232514 rewrote
-- both bodies in place with regexp_replace over pg_get_functiondef. But the
-- newest TEXTUAL definition in migration history (20260829030000) still says
-- /warnings, so a replay onto a fresh database, or any guard that reads the
-- newest definition, sees the retired address. Restated byte-for-byte from
-- 20260829030000 with only the link changed; the bodies were compared against
-- live pg_get_functiondef on 2026-09-23 and match apart from that link.

CREATE OR REPLACE FUNCTION public.apply_consequence_ladder(
  p_user uuid,
  p_violation_type text,
  p_description text,
  p_job_id uuid,
  p_prior_count int,
  -- Parallel arrays, indexed by prior-strike count (element 1 = 0 priors). The
  -- last element repeats for every count beyond it.
  p_rungs text[],      -- the action string RETURNED and stored in action_taken
  p_effects text[],    -- 'record' | 'notify' | 'final_warning' | 'suspend' | 'permanent'
  p_copy jsonb,        -- array parallel to p_rungs: {"title":..,"message":..} or null
  p_permanent_requires_review boolean,
  p_suspension_days int,
  p_clamp_to_worse_status boolean,
  p_admin_message_format text,   -- two %s: user label, strike number
  p_ban_reason text              -- reason recorded on an auto permanent ban
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_idx int;
  v_action text;
  v_effect text;
  v_status text;
  v_copy jsonb;
  v_title text;
  v_message text;
  v_interval interval := (p_suspension_days || ' days')::interval;
BEGIN
  -- Rung selection: prior count is 0-based, arrays are 1-based, and the top
  -- rung is open-ended (a 6th strike gets the same treatment as the 4th).
  v_idx := LEAST(GREATEST(COALESCE(p_prior_count, 0), 0), array_length(p_rungs, 1) - 1);
  v_action := p_rungs[v_idx + 1];
  v_effect := p_effects[v_idx + 1];

  -- The single policy switch. A ladder whose top rung is a permanent ban but
  -- which requires human review serves a REVERSIBLE restriction instead and
  -- puts the case in front of an admin.
  IF v_effect = 'permanent' AND p_permanent_requires_review THEN
    v_effect := 'review';
  END IF;

  v_copy := p_copy -> v_idx;
  v_title := v_copy ->> 'title';
  v_message := v_copy ->> 'message';

  INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
  VALUES (p_user, p_violation_type, p_description, p_job_id, v_action);

  SELECT ban_status INTO v_status FROM public.profiles WHERE user_id = p_user;

  -- Trusted ladder: this function is the SERVER deciding a consequence, so its
  -- writes to profiles must survive prevent_self_escalation(). The GUC is
  -- transaction-local (is_local = true) and dies with this transaction.
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  IF v_effect IN ('record', 'notify') THEN
    -- No status change on these rungs. 'record' additionally has no copy, so
    -- nothing is sent; 'notify' sends its warning below.
    NULL;

  ELSIF v_effect = 'final_warning' THEN
    IF p_clamp_to_worse_status THEN
      -- Never downgrade a harsher standing status into 'final_warning'.
      UPDATE public.profiles
         SET ban_status = 'final_warning'
       WHERE user_id = p_user
         AND COALESCE(ban_status, 'active') NOT IN ('temp_banned', 'permanently_banned');
    ELSE
      UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = p_user;
    END IF;

  ELSIF v_effect IN ('suspend', 'review') THEN
    -- 'review' is ALWAYS guarded: a reversible restriction pending a human
    -- decision must never overwrite a standing permanent ban, and must never
    -- shorten a suspension the user is already serving.
    IF p_clamp_to_worse_status OR v_effect = 'review' THEN
      -- A user already permanently banned is left alone (and told nothing new),
      -- and an existing longer suspension is never shortened.
      IF COALESCE(v_status, 'active') <> 'permanently_banned' THEN
        UPDATE public.profiles
           SET ban_status = 'temp_banned',
               auto_suspended_until = GREATEST(
                 COALESCE(auto_suspended_until, now()), now() + v_interval)
         WHERE user_id = p_user;
      ELSE
        v_title := NULL;
      END IF;
    ELSE
      UPDATE public.profiles
         SET ban_status = 'temp_banned',
             auto_suspended_until = now() + v_interval
       WHERE user_id = p_user;
    END IF;

  ELSIF v_effect = 'permanent' THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
    VALUES (p_user, 'permanent', p_ban_reason, p_user);
    UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = p_user;
  END IF;

  IF v_title IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (p_user, v_title, v_message, 'warning', '/profile?tab=warnings');
  END IF;

  -- Put the case where a person will actually see it.
  IF v_effect = 'review' AND p_admin_message_format IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    SELECT ur.user_id,
           'system_alert',
           'Ban review needed',
           format(p_admin_message_format,
                  COALESCE(NULLIF(p.full_name, ''), p.email, 'A user'), p_prior_count + 1),
           '/admin?view=banreview',
           false
      FROM public.user_roles ur
      CROSS JOIN LATERAL (
        SELECT full_name, email FROM public.profiles WHERE user_id = p_user
      ) p
     WHERE ur.role = 'admin';
  END IF;

  RETURN jsonb_build_object('action', v_action, 'prior_count', p_prior_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prior_count int;
  v_is_elite boolean;
  v_shield_available boolean := false;
BEGIN
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
            'info', '/profile?tab=warnings');
    RETURN jsonb_build_object('action', 'shielded', 'prior_count', v_prior_count);
  END IF;

  RETURN public.apply_consequence_ladder(
    p_user                      => p_helper,
    p_violation_type            => 'job_denial',
    p_description               => p_description,
    p_job_id                    => p_job,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['none', 'warning', 'temp_ban', 'pending_ban_review'],
    p_effects                   => ARRAY['record', 'final_warning', 'suspend', 'permanent'],
    p_copy                      => jsonb_build_array(
      -- Rung 1 is recorded SILENTLY: no notification. Cast is required —
      -- jsonb_build_array is VARIADIC "any" and cannot resolve a bare NULL.
      null::jsonb,
      jsonb_build_object(
        'title', 'Final warning',
        'message', 'This is your second reliability strike. One more — declining, ignoring, or cancelling a job you committed to — and your account is suspended for 7 days.'),
      jsonb_build_object(
        'title', 'Account suspended for 7 days',
        'message', 'Third reliability strike — your account is suspended for 7 days. A fourth strike restricts your account again while an admin decides whether to ban it permanently.'),
      jsonb_build_object(
        'title', 'Account restricted for 7 days',
        'message', 'Fourth reliability strike — your account is restricted for 7 days and an admin is reviewing it for a permanent ban. If you think this is wrong, email admin@louisianahelpr.com.')
    ),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => false,
    p_admin_message_format      => '%s has %s reliability strikes on file (declined, ignored, or abandoned committed jobs) and is restricted for 7 days pending your decision.',
    -- Unused while p_permanent_requires_review is true; kept so the direct-ban
    -- path stays fully specified if that policy is ever revisited.
    p_ban_reason                => 'Fourth reliability strike (declined, ignored, or cancelled committed jobs)'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_consequence_ladder(
  uuid, text, text, uuid, int, text[], text[], jsonb, boolean, int, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_consequence_ladder(
  uuid, text, text, uuid, int, text[], text[], jsonb, boolean, int, boolean, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) TO service_role;

-- ── Part 2: stored links ────────────────────────────────────────────────────
-- (retired path, current address). A query string on the old link is kept:
-- appended with '&' when the new address already has one, else as-is.
DO $$
DECLARE
  m record;
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['notifications', 'notification_dedupe_suppressions']) LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR m IN
      SELECT * FROM (VALUES
        ('/earnings',      '/profile?tab=earnings'),
        ('/warnings',      '/profile?tab=warnings'),
        ('/schedule',      '/profile?tab=schedule'),
        ('/availability',  '/profile?tab=availability'),
        ('/saved-helprs',  '/profile?tab=saved_helpers'),
        ('/saved-helpers', '/profile?tab=saved_helpers'),
        ('/gift-card',     '/profile?tab=gift_card'),
        ('/settings',      '/profile'),
        ('/help-center',   '/help'),
        -- /activity: the helper side only for its offer/applied tabs, as the
        -- deleted ActivityLegacyRedirect did; the tab has done its job then.
        ('/activity?tab=offers',  '/jobs?filter=direct_offer'),
        ('/activity?tab=applied', '/jobs'),
        ('/activity',             '/posts')
      ) AS v(old_path, new_path)
    LOOP
      EXECUTE format(
        $q$UPDATE public.%I
              SET link = %L || CASE
                    WHEN substr(link, length(%L) + 1) = '' THEN ''
                    WHEN substr(link, length(%L) + 1) LIKE '?%%' AND %L LIKE '%%?%%'
                      THEN '&' || substr(link, length(%L) + 2)
                    WHEN substr(link, length(%L) + 1) LIKE '&%%' AND %L NOT LIKE '%%?%%'
                      THEN '?' || substr(link, length(%L) + 2)
                    ELSE substr(link, length(%L) + 1)
                  END
            WHERE link = %L
               OR link LIKE %L || '?%%'
               OR link LIKE %L || '&%%'
               OR link LIKE %L || '#%%'$q$,
        t, m.new_path,
        m.old_path, m.old_path, m.new_path, m.old_path,
        m.old_path, m.new_path, m.old_path, m.old_path,
        m.old_path, m.old_path, m.old_path, m.old_path);
    END LOOP;
  END LOOP;
END;
$$;
