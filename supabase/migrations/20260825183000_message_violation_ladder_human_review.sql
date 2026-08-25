-- Message-scanner escalation moves SERVER-side, and a permanent ban stops
-- being something a client can hand itself (owner, 2026-08-25):
--
--   "Keep warnings automatic, but a permanent ban has to be a person's
--    decision — put it in the admin queue."
--
-- BEFORE: src/pages/messages/logViolation.ts ran the whole ladder on the
-- OFFENDER'S OWN CLIENT. It counted prior `off_platform` rows, and on the
-- SECOND blocked attempt it inserted a `permanent` row into user_bans and set
-- profiles.ban_status='permanently_banned' — with `banned_by` pointing at the
-- offender themselves. That is:
--   * bypassable  — a modified client simply doesn't run it;
--   * unreviewable — nothing landed in front of a human, ever;
--   * brittle     — two scanner false positives (or one retry that slipped the
--                   client-side dedupe) permanently killed a real account.
--
-- AFTER, one server-owned ladder, mirroring apply_job_denial_consequence
-- (20260824243000) — same SECURITY DEFINER shape, same violation-row +
-- notification conventions:
--   1st strike  — recorded, courtesy warning
--   2nd strike  — FINAL WARNING (ban_status = 'final_warning')  [still automatic]
--   3rd+ strike — recorded as `pending_ban_review`, a REVERSIBLE 7-day
--                 suspension (temp_banned + auto_suspended_until, lifted on
--                 schedule by sweep_expired_auto_bans), and the case is put in
--                 front of an admin at /admin?view=banreview. NO automatic
--                 permanent ban — a human confirms or dismisses it.
--
-- The contraband block itself is untouched: the client scanner still refuses
-- the send, and the scan_message_content trigger still hides + fraud-flags
-- anything that reaches the messages table. This migration only changes what
-- HAPPENS TO THE ACCOUNT afterwards.

-- ── The canonical message-violation ladder ──
-- Acts on auth.uid() only: the caller cannot escalate (or absolve) anyone but
-- themselves, so a modified client gains nothing by lying about a user id.
CREATE OR REPLACE FUNCTION public.apply_message_violation_consequence(
  p_description text,
  p_content text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_desc text;
  v_prior_count int;
  v_action text;
  v_status text;
  v_dupe uuid;
BEGIN
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
$$;

-- Callable by the offender's own session (it can only ever act on auth.uid()),
-- which is the whole point — the client reports, the server decides.
REVOKE ALL ON FUNCTION public.apply_message_violation_consequence(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_message_violation_consequence(text, text) TO authenticated;

-- Replay-safety: this REVOKE targets a function defined by an EARLIER
-- migration, but a from-scratch rebuild of a partially-applied tree can reach
-- here first. Guard it so the rebuild never aborts.
DO $$
BEGIN
  IF to_regprocedure('public.apply_job_denial_consequence(uuid,uuid,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- The queue an admin reads is just user_violations filtered on this
-- action_taken value; admins already have FOR ALL on the table
-- ("Admins can manage violations", 20260311015019). Index the lookup so the
-- Ban Review view stays cheap as the violation log grows.
CREATE INDEX IF NOT EXISTS idx_user_violations_pending_review
  ON public.user_violations (created_at DESC)
  WHERE action_taken = 'pending_ban_review';
