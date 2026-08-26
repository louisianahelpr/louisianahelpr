-- One parameterized consequence ladder behind three UNCHANGED wrappers.
--
-- THE PROBLEM. Three near-identical escalation ladders had each grown their own
-- copy of the same machinery: count priors -> pick a rung -> write
-- `user_violations` -> set `profiles.ban_status` / `auto_suspended_until` ->
-- notify -> return `{action, prior_count}`. All three are SECURITY DEFINER and
-- all three punch through `prevent_self_escalation()` with the
-- `app.trusted_ladder_write` GUC:
--
--   apply_job_denial_consequence(uuid, uuid, text)
--   apply_message_violation_consequence(text, text)
--   apply_cancellation_violation_consequence(uuid)
--
-- This is exactly the shape that already drifted once: the user-facing copy
-- promised a 5-strike ladder while the SQL enforced 4. Three copies of a rule
-- is three chances to edit one and forget the others.
--
-- WHAT THIS MIGRATION DOES. It extracts the shared machinery into
-- `apply_consequence_ladder(...)` and rewrites the three functions as thin
-- wrappers that keep their EXACT signatures and EXACT return shapes, so every
-- caller (client RPCs plus decline_job_offer, expire_unanswered_offers,
-- helper_cancel_booking, helper_abort_job, block_user_and_settle) is untouched.
--
-- THE ONE DELIBERATE BEHAVIOUR CHANGE. Every threshold, every action string on
-- rungs 1-3, and every line of copy is preserved exactly. ONE rung moves, on
-- the owner's explicit decision:
--
--   apply_job_denial_consequence, strike 4+ :  permanent_ban -> pending_ban_review
--
-- The reliability ladder used to be the ONLY one that auto-wrote a permanent
-- `user_bans` row with nobody in the loop and no notification to the user,
-- while the message and cancellation ladders escalated to a REVERSIBLE 7-day
-- restriction plus an admin "Ban review needed" notification. That
-- inconsistency was surfaced during this consolidation and the owner resolved
-- it: one policy everywhere, permanent bans always go through a person. The
-- legal Community page already described the reviewed behaviour, so this also
-- closes a copy-vs-code drift rather than opening one.
--
-- Downstream of that, three client surfaces that branched on
-- `action === "permanent_ban"` now also handle "pending_ban_review"
-- (useOfferHandlers, ConfirmedSection, ActiveJobSection), the rung-3
-- notification no longer promises "A fourth strike is a permanent ban", and
-- reliabilityLadder.ts says the same thing the SQL now does.
--
-- WHAT IT DELIBERATELY DOES *NOT* DO. It does not otherwise homogenise the
-- three ladders. The remaining real differences are now explicit PARAMETERS
-- rather than accidents of three separate copy-pastes:
--
--   1. p_permanent_requires_review -- all three callers now pass TRUE. The
--      parameter stays because the 'permanent' effect it gates is still the
--      only direct path to an automatic ban, and a future admin-initiated or
--      zero-tolerance ladder (a confirmed no-show, say) may legitimately want
--      it. Flipping it is a POLICY change and the parity test says so.
--
--   2. p_clamp_to_worse_status -- message/cancellation never downgrade a
--      harsher standing status into 'final_warning', and GREATEST() their
--      suspension so an existing longer one is never shortened. Job denial
--      does neither on rungs 2-3 (it overwrites unconditionally), and that is
--      preserved: job passes false, the other two pass true. The 'review'
--      effect is ALWAYS guarded regardless, because a reversible restriction
--      must never overwrite a standing permanent ban or shorten an existing
--      suspension -- which is what the other two ladders already did, and is
--      new-behaviour-only for job denial.
--
--   3. p_rungs / p_effects / p_copy -- the job ladder has FOUR rungs starting
--      with a silent 'none', and its own action vocabulary
--      ('none'/'warning'/'temp_ban'/'pending_ban_review'); the other two have
--      THREE ('warning'/'final_warning'/'pending_ban_review'). Both the action
--      STRINGS (which callers switch on) and every line of user-facing copy
--      stay per ladder -- no wording was homogenised.
--
-- The wrappers keep whatever is genuinely theirs: the Elite reliability shield
-- and its 180-day window (job denial), the 24h same-text dedupe (message), and
-- the job-row authorization + per-job dedupe (cancellation).
--
-- REPLAY-SAFETY: everything here is CREATE OR REPLACE on functions whose
-- dependencies (`user_violations`, `profiles`, `notifications`, `user_bans`,
-- `user_roles`, `jobs`) all exist well before this file. No DROP, so the
-- existing ACLs survive; the grants at the bottom re-assert the CURRENT posture
-- verbatim (verified live via pg_proc.proacl) so a from-scratch rebuild lands
-- in the same place.

-- ---------------------------------------------------------------------------
-- The shared core.
-- ---------------------------------------------------------------------------
-- Not callable by `authenticated`: it takes the target user as a parameter and
-- would be a ban-anyone primitive in the wrong hands. Only the SECURITY DEFINER
-- wrappers (which run as the owner) reach it.
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
    VALUES (p_user, v_title, v_message, 'warning', '/warnings');
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

REVOKE ALL ON FUNCTION public.apply_consequence_ladder(
  uuid, text, text, uuid, int, text[], text[], jsonb, boolean, int, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_consequence_ladder(
  uuid, text, text, uuid, int, text[], text[], jsonb, boolean, int, boolean, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Wrapper 1 -- reliability strikes (job denial). SIGNATURE UNCHANGED.
-- ---------------------------------------------------------------------------
-- This ladder's 4th rung MOVED, on the owner's decision: it used to be
-- 'permanent_ban' (an automatic, irreversible `user_bans` row) and is now
-- 'pending_ban_review' -- the same reversible 7-day restriction plus admin
-- fan-out the other two ladders serve. Rungs 1-3 are untouched.
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
            'info', '/warnings');
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

-- ---------------------------------------------------------------------------
-- Wrapper 2 -- off-platform contact in messages. SIGNATURE UNCHANGED.
-- ---------------------------------------------------------------------------
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
  v_dupe uuid;
BEGIN
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Same shape the client used to write, so old and new rows read alike.
  v_desc := COALESCE(p_description, 'Off-platform contact attempt')
            || ' | Message: "' || left(COALESCE(p_content, ''), 300) || '"';

  -- IDEMPOTENCE / DEDUPE. Retrying the identical blocked message is ONE
  -- offence, not a new strike -- the client already guards this per session,
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

  RETURN public.apply_consequence_ladder(
    p_user                      => v_user,
    p_violation_type            => 'off_platform',
    p_description               => v_desc,
    p_job_id                    => null,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'final_warning', 'pending_ban_review'],
    p_effects                   => ARRAY['notify', 'final_warning', 'permanent'],
    p_copy                      => jsonb_build_array(
      jsonb_build_object(
        'title', 'Warning — keep it on Helpr',
        'message', 'That message was blocked for sharing contact info or taking the job off-platform. This is a warning; a second one is a final warning.'),
      jsonb_build_object(
        'title', 'Final warning',
        'message', 'This is your second blocked message. One more and your account is restricted for 7 days while an admin reviews it.'),
      jsonb_build_object(
        'title', 'Account restricted for 7 days',
        'message', 'Third blocked message — your account is restricted for 7 days and an admin is reviewing it. If you think the filter got this wrong, email admin@louisianahelpr.com.')
    ),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has %s blocked messages on file and is restricted for 7 days pending your decision.',
    p_ban_reason                => null
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Wrapper 3 -- cancelling a job a Helpr had committed to. SIGNATURE UNCHANGED.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_cancellation_violation_consequence(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_job record;
  v_desc text;
  v_prior_count int;
  v_dupe uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.cancelled_by
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the poster of the job, and only for a job that has actually been
  -- cancelled. The client cancels the job row first and reports afterwards;
  -- checking the row means a caller cannot invent strikes against themselves
  -- (harmless) or, more importantly, spend someone else's.
  IF v_job.customer_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'job_not_cancelled';
  END IF;

  -- No helper was committed -> no strike. Cancelling a job nobody accepted
  -- costs nobody anything, which is why the ladder only counts these.
  IF v_job.helper_id IS NULL THEN
    RETURN jsonb_build_object('action', 'none', 'prior_count', 0);
  END IF;

  v_desc := 'Cancelled job with Helpr assigned: "' || COALESCE(v_job.title, 'Unknown') || '"';

  -- IDEMPOTENCE. One cancelled job is ONE offence however many times the
  -- dialog retries or the tab reloads -- the strike is keyed to the job.
  SELECT id INTO v_dupe
    FROM public.user_violations
   WHERE user_id = v_user
     AND violation_type = 'cancel_with_helper'
     AND job_id = p_job_id
   LIMIT 1;

  IF v_dupe IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'duplicate', 'violation_id', v_dupe);
  END IF;

  SELECT count(*) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = v_user AND violation_type = 'cancel_with_helper';

  RETURN public.apply_consequence_ladder(
    p_user                      => v_user,
    p_violation_type            => 'cancel_with_helper',
    p_description               => v_desc,
    p_job_id                    => p_job_id,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'final_warning', 'pending_ban_review'],
    p_effects                   => ARRAY['notify', 'final_warning', 'permanent'],
    p_copy                      => jsonb_build_array(
      jsonb_build_object(
        'title', 'Cancellation warning (1 of 2)',
        'message', 'You cancelled a job after a Helpr had already committed to it. This is a warning; a second one is a final warning.'),
      jsonb_build_object(
        'title', 'Final warning',
        'message', 'That is your second cancellation after a Helpr committed. One more and your account is restricted for 7 days while an admin reviews it.'),
      jsonb_build_object(
        'title', 'Account restricted for 7 days',
        'message', 'Third cancellation after a Helpr committed — your account is restricted for 7 days and an admin is reviewing it. If you think this is wrong, email admin@louisianahelpr.com.')
    ),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has cancelled %s jobs with a Helpr committed and is restricted for 7 days pending your decision.',
    p_ban_reason                => null
  );
END;
$function$;

-- Re-assert the EXACT grant posture the three wrappers carry in production
-- (verified live via pg_proc.proacl). CREATE OR REPLACE preserves ACLs, so
-- these are no-ops against prod; they exist so a from-scratch replay of the
-- migration set lands on the same posture.
REVOKE ALL ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_message_violation_consequence(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_message_violation_consequence(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.apply_cancellation_violation_consequence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_cancellation_violation_consequence(uuid) TO authenticated, service_role;
