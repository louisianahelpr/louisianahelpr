-- Contact scanner residual #3 (docs/OPEN.md queue #1, found by the
-- 2026-09-14/15 fix, not fixed there): the admin "Ban review needed"
-- notification says "%s has %s blocked messages on file", but the count it
-- fills in (p_prior_count + 1, every off_platform row for the user) mixes
-- two different things — messages the app's own scanner REFUSED to send
-- (nothing saved) and messages that WERE saved and hidden from the
-- recipient by scan_message_content. An admin reading "3 blocked messages"
-- and going looking for 3 blocked sends will find some rows that were
-- delivered-and-hidden instead. "Flagged" covers both truthfully.
--
-- message_violation_ladder is the only thing that formats this notice (the
-- other consequence ladders — reliability strikes, cancellations, no-shows —
-- have their own nouns, untouched). Renamed consistently with the admin UI
-- text (src/components/admin/AdminBanReview.tsx's "blocked message(s)"
-- badge/copy, same commit).
--
-- Every other branch is byte-for-byte the live body (20260915020258).
--
-- REPLAY-SAFETY: CREATE OR REPLACE, same signature as live, grants restated
-- to match live proacl, no DDL on tables. plpgsql body resolves tables and
-- auth.uid() at call time, so this applies on a database of any age, any
-- number of times.

CREATE OR REPLACE FUNCTION public.message_violation_ladder(p_description text, p_content text, p_message_saved boolean)
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
  v_copy jsonb;
BEGIN
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Same shape the client used to write, so old and new rows read alike.
  v_desc := COALESCE(p_description, 'Off-platform contact attempt')
            || ' | Message: "' || left(COALESCE(p_content, ''), 300) || '"';

  -- IDEMPOTENCE / DEDUPE. Retrying the identical flagged message is ONE
  -- offence, not a new strike. A same-text re-report inside 24h returns the
  -- standing verdict unchanged.
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

  IF p_message_saved THEN
    -- The row exists (flagged_hidden): the sender still sees it in their own
    -- thread, the other person does not. Never say "blocked" here.
    v_copy := jsonb_build_array(
      jsonb_build_object(
        'title', 'Warning — keep it on Helpr',
        'message', 'Your message was hidden from the other person because it looked like contact info or taking the job off-platform. This is a warning; a second one is a final warning.'),
      jsonb_build_object(
        'title', 'Final warning',
        'message', 'Your message was hidden from the other person. That is your second flagged message; one more and your account is restricted for 7 days while an admin reviews it.'),
      jsonb_build_object(
        'title', 'Account restricted for 7 days',
        'message', 'Your message was hidden from the other person. That is your third flagged message, so your account is restricted for 7 days and an admin is reviewing it. If you think the filter got this wrong, email admin@louisianahelpr.com.')
    );
  ELSE
    -- The app refused the send: nothing was saved, so "blocked" is accurate.
    v_copy := jsonb_build_array(
      jsonb_build_object(
        'title', 'Warning — keep it on Helpr',
        'message', 'That message was blocked for sharing contact info or taking the job off-platform. This is a warning; a second one is a final warning.'),
      jsonb_build_object(
        'title', 'Final warning',
        'message', 'This is your second blocked message. One more and your account is restricted for 7 days while an admin reviews it.'),
      jsonb_build_object(
        'title', 'Account restricted for 7 days',
        'message', 'Third blocked message — your account is restricted for 7 days and an admin is reviewing it. If you think the filter got this wrong, email admin@louisianahelpr.com.')
    );
  END IF;

  RETURN public.apply_consequence_ladder(
    p_user                      => v_user,
    p_violation_type            => 'off_platform',
    p_description               => v_desc,
    p_job_id                    => null,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'final_warning', 'pending_ban_review'],
    p_effects                   => ARRAY['notify', 'final_warning', 'permanent'],
    p_copy                      => v_copy,
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has %s flagged messages on file and is restricted for 7 days pending your decision.',
    p_ban_reason                => null
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.message_violation_ladder(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_violation_ladder(text, text, boolean) TO service_role;
