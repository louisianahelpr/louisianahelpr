-- Elite reliability shield (owner, 2026-08-24 membership-perk round):
-- an active Elite helper's FIRST reliability strike in any rolling 6 months
-- is absorbed — recorded for the books, but it neither counts on the ladder
-- nor escalates. Ties the paid tier to the thing helpers fear most, and
-- costs the platform nothing out of pocket.
--
-- Mechanics inside apply_job_denial_consequence (the ONE ladder):
--   * prior_count now ignores previously-shielded strikes;
--   * before escalating, an active Elite with no shield use in 180 days gets
--     this strike recorded as action 'forgiven_elite_shield' and a
--     notification that names the perk — no ban_status change;
--   * everyone else, and Elite's second strike inside the window, climbs the
--     ladder exactly as before (warn → final warning → 7-day → permanent).

CREATE OR REPLACE FUNCTION public.apply_job_denial_consequence(
  p_helper uuid,
  p_job uuid,
  p_description text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prior_count int;
  v_action text;
  v_is_elite boolean;
  v_shield_available boolean := false;
BEGIN
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
$$;
REVOKE ALL ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
