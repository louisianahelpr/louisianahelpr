-- Q2337 (lh-authz-rls review of the SMS slice, third pass, 2026-10-22; finding lh-authz-rls@d885772f08#1):
-- a text-alert confirmation could be answered for the WRONG account.
--
-- What was wrong: when two accounts ask for texts to the same number (E, the phone's owner, and C, who typed E's
-- number), E's phone gets two confirmation texts that read the same apart from the 4-digit code. A "YES <C's code>"
-- from E's phone opted C in, and E's phone then got C's alerts until it replied STOP. Measured in PGlite on
-- d885772f08 (E code 2065, C code 4298, "YES 4298" from E's phone opted in C).
--
-- What this does (lead 11-02, option B: keeps the "Reply YES <code>" opt-in flow Twilio's review was told about):
--   1. sms_inbound_keyword (restated from 20261023181442, the newest body; only the START code match changes):
--      a YES <code> confirms only when exactly ONE account holds a live confirmation (sent in the last 24 hours,
--      still pending) for that number, and the code is that account's. Two or more live confirmations: a YES
--      confirms nobody. The bare-START re-subscribe branch and STOP are unchanged.
--   2. confirm_sms_code(p_code) (new, signed-in members): the member types the code from their own text into the
--      app. It confirms only auth.uid()'s own pending request, so whichever code the phone's owner types, only
--      their own account is opted in. At most 5 wrong codes per account in 24 hours (a 4-digit code: 5 in
--      10,000 a day). Every miss answers the same 'wrong_code', whether or not a text was ever sent, so the app
--      never says whether a confirmation went out (no "number in use" oracle). The code is never shown in the app.
--   3. sms_consent gains confirm_tries / confirm_tries_since (the wrong-code counter). They move only on the
--      member's own calls, so exporting them reveals nothing about a send.
-- Behind the same switch as asking for texts: confirm_sms_code refuses with 'feature_disabled' when sms_alerts is
-- not on for the caller, and a banned account cannot confirm (as it cannot ask).
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE; grants re-run.

ALTER TABLE public.sms_consent ADD COLUMN IF NOT EXISTS confirm_tries integer NOT NULL DEFAULT 0;
ALTER TABLE public.sms_consent ADD COLUMN IF NOT EXISTS confirm_tries_since timestamptz;

-- 1. ------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sms_inbound_keyword(p_phone text, p_action text, p_code text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_phone text := public.sms_normalize_phone(p_phone);
  v_count integer := 0;
  v_user uuid;
BEGIN
  IF v_phone IS NULL THEN
    RETURN 0;
  END IF;
  IF p_action = 'stop' THEN
    INSERT INTO public.sms_consent_events (user_id, event, phone_e164, source)
    SELECT user_id, 'opt_out', phone_e164, 'sms_stop'
      FROM public.sms_consent WHERE phone_e164 = v_phone AND sms_opt_in;
    UPDATE public.sms_consent
       SET sms_opt_in = false, opted_out_at = now(), opt_out_source = 'sms_stop', updated_at = now()
     WHERE phone_e164 = v_phone AND sms_opt_in;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    -- A STOP also cancels any pending request for this number, and any text
    -- still waiting for it.
    UPDATE public.sms_consent SET pending_phone = NULL, pending_since = NULL, updated_at = now()
     WHERE pending_phone = v_phone;
    UPDATE public.sms_messages m SET status = 'skipped', reason = 'no_consent'
      FROM public.sms_consent s
     WHERE m.user_id = s.user_id AND s.phone_e164 = v_phone AND m.status = 'pending';
  ELSIF p_action = 'start' THEN
    IF EXISTS (SELECT 1 FROM public.sms_consent WHERE phone_e164 = v_phone AND sms_opt_in) THEN
      RETURN 0;
    END IF;
    -- The account whose confirmation text carried this code to this number,
    -- and ONLY when it is the one live confirmation for this number (Q2337).
    -- Two live confirmations to one number read the same apart from the code,
    -- so the phone's owner can answer the wrong one: when more than one
    -- account holds a live confirmation for this number, a YES confirms
    -- nobody, whatever its code. Each account can still confirm in the app
    -- with the code from its own text (confirm_sms_code below).
    IF p_code IS NOT NULL AND p_code ~ '^[0-9]{4}$'
       AND (SELECT count(*) FROM public.sms_consent
             WHERE pending_phone = v_phone AND confirm_phone = v_phone AND confirm_code IS NOT NULL
               AND confirm_sent_at > now() - interval '24 hours') = 1
       AND (SELECT count(*) FROM public.sms_consent
             WHERE pending_phone = v_phone AND confirm_phone = v_phone AND confirm_code = p_code
               AND confirm_sent_at > now() - interval '24 hours') = 1 THEN
      SELECT user_id INTO v_user FROM public.sms_consent
       WHERE pending_phone = v_phone AND confirm_phone = v_phone AND confirm_code = p_code
         AND confirm_sent_at > now() - interval '24 hours';
    END IF;
    IF v_user IS NOT NULL THEN
      UPDATE public.sms_consent
         SET phone_e164 = v_phone, sms_opt_in = true, opted_in_at = now(),
             opt_in_source = 'sms_confirm', consent_text_version = 'sms-v2',
             opted_out_at = NULL, opt_out_source = NULL,
             pending_phone = NULL, pending_since = NULL,
             confirm_code = NULL, confirm_phone = NULL, confirm_sent_at = NULL, updated_at = now()
       WHERE user_id = v_user;
      INSERT INTO public.sms_consent_events (user_id, event, phone_e164, source, consent_text_version)
      VALUES (v_user, 'opt_in', v_phone, 'sms_confirm', 'sms-v2');
      -- Other accounts that asked for the same number lose their request.
      UPDATE public.sms_consent SET pending_phone = NULL, pending_since = NULL, updated_at = now()
       WHERE pending_phone = v_phone;
      RETURN 1;
    END IF;
    SELECT user_id INTO v_user FROM public.sms_consent
     WHERE phone_e164 = v_phone AND opt_out_source IN ('sms_stop', 'carrier_21610')
       AND opted_out_at > now() - interval '30 days'
     ORDER BY opted_out_at DESC LIMIT 1;
    IF v_user IS NOT NULL THEN
      UPDATE public.sms_consent
         SET sms_opt_in = true, opted_in_at = now(), opt_in_source = 'sms_start',
             opted_out_at = NULL, opt_out_source = NULL, updated_at = now()
       WHERE user_id = v_user;
      INSERT INTO public.sms_consent_events (user_id, event, phone_e164, source, consent_text_version)
      SELECT user_id, 'opt_in', phone_e164, 'sms_start', consent_text_version
        FROM public.sms_consent WHERE user_id = v_user;
      v_count := 1;
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_action %', p_action USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_inbound_keyword(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_inbound_keyword(text, text, text) TO service_role;


-- 2. ------------------------------------------------------------------------------------------------------------
-- Answers: {status: 'confirmed'} (with the consent read), 'wrong_code', 'too_many_tries', 'phone_in_use' (the
-- number was opted in on another account meanwhile; only someone holding this account's live code can see it).
CREATE OR REPLACE FUNCTION public.confirm_sms_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  c public.sms_consent;
  v_tries integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.feature_enabled_for_user('sms_alerts', v_uid) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Same lock as sms_claim_confirmation: a code being stamped and a code being checked never interleave.
  PERFORM pg_advisory_xact_lock(hashtextextended('sms:' || v_uid::text, 0));
  SELECT * INTO c FROM public.sms_consent WHERE user_id = v_uid FOR UPDATE;
  IF c.user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'wrong_code');
  END IF;

  v_tries := CASE WHEN c.confirm_tries_since > now() - interval '24 hours' THEN c.confirm_tries ELSE 0 END;
  IF v_tries >= 5 THEN
    RETURN jsonb_build_object('status', 'too_many_tries');
  END IF;

  IF p_code IS NULL OR btrim(p_code) !~ '^[0-9]{4}$'
     OR c.confirm_code IS NULL OR c.confirm_code <> btrim(p_code)
     OR c.pending_phone IS NULL OR c.confirm_phone IS DISTINCT FROM c.pending_phone
     OR c.confirm_sent_at IS NULL OR c.confirm_sent_at <= now() - interval '24 hours' THEN
    UPDATE public.sms_consent
       SET confirm_tries = v_tries + 1,
           confirm_tries_since = CASE WHEN v_tries = 0 THEN now() ELSE confirm_tries_since END
     WHERE user_id = v_uid;
    RETURN jsonb_build_object('status', 'wrong_code');
  END IF;

  IF EXISTS (SELECT 1 FROM public.sms_consent o
              WHERE o.phone_e164 = c.pending_phone AND o.sms_opt_in AND o.user_id <> v_uid) THEN
    RETURN jsonb_build_object('status', 'phone_in_use');
  END IF;

  UPDATE public.sms_consent
     SET phone_e164 = c.pending_phone, sms_opt_in = true, opted_in_at = now(),
         opt_in_source = 'app_code', consent_text_version = 'sms-v2',
         opted_out_at = NULL, opt_out_source = NULL,
         pending_phone = NULL, pending_since = NULL,
         confirm_code = NULL, confirm_phone = NULL, confirm_sent_at = NULL,
         confirm_tries = 0, confirm_tries_since = NULL, updated_at = now()
   WHERE user_id = v_uid;
  INSERT INTO public.sms_consent_events (user_id, event, phone_e164, source, consent_text_version)
  VALUES (v_uid, 'opt_in', c.pending_phone, 'app_code', 'sms-v2');
  -- Other accounts that asked for the same number lose their request (as a confirmed YES does).
  UPDATE public.sms_consent SET pending_phone = NULL, pending_since = NULL, updated_at = now()
   WHERE pending_phone = c.pending_phone AND user_id <> v_uid;
  RETURN jsonb_build_object('status', 'confirmed', 'consent', public.get_my_sms_consent());
END;
$fn$;
REVOKE ALL ON FUNCTION public.confirm_sms_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_sms_code(text) TO authenticated;
