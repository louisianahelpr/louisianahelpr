-- SMS-OPTIN (owner 2026-10-29, audit page): members who already gave us a phone are asked once to turn on texts.
--
-- Measured on prod (read-only, 2026-10-30): 53 real (non-seed) members have a phone on their profile, 0 have
-- texts turned on (sms_consent.sms_opt_in), and 0 of the 53 have exactly one job posted. The 10-27 prompt
-- (20261027183058) only fires at a member's FIRST post or FIRST hire, so it reaches none of them.
--
-- Adds a third moment to sms_phone_prompt_due: 'has_phone' = the caller's own profile has a phone. Everything
-- else is the 10-27 function as it stands on prod (pg_get_functiondef, read 2026-10-30, identical to the file):
-- the caller only ((SELECT auth.uid()), no id passed in), false once dismissed on the account, once texts are on,
-- or while a confirmation text is waiting (24 h). The dismiss is shared: one "Not now" ends the ask at every moment.
-- Shown on Home (Dashboard) by SmsPhonePrompt moment="has_phone".
--
-- Grants are restated as they are on prod: authenticated and service_role only (anon and PUBLIC revoked).
-- Replay-safe (CREATE OR REPLACE). Proof: src/test/pglite/smsPhonePrompt.pglite.mjs (applies both migrations 3x).

CREATE OR REPLACE FUNCTION public.sms_phone_prompt_due(p_moment text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_moment IS NULL OR p_moment NOT IN ('first_job', 'first_hire', 'has_phone') THEN
    RAISE EXCEPTION 'invalid_moment' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_preferences np
              WHERE np.user_id = v_uid AND np.sms_phone_prompt_dismissed_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  -- A confirmed phone, or a confirmation text waiting for its YES: nothing to ask.
  IF EXISTS (SELECT 1 FROM public.sms_consent c
              WHERE c.user_id = v_uid
                AND (c.sms_opt_in IS TRUE
                     OR (c.pending_phone IS NOT NULL AND c.pending_since > now() - interval '24 hours'))) THEN
    RETURN false;
  END IF;
  IF p_moment = 'has_phone' THEN
    -- The member's own profile phone, as typed (blank or whitespace is no phone).
    RETURN EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = v_uid AND nullif(btrim(p.phone), '') IS NOT NULL);
  END IF;
  IF p_moment = 'first_job' THEN
    SELECT count(*)::integer INTO v_n FROM public.jobs j WHERE j.customer_id = v_uid;
  ELSE
    SELECT (SELECT count(*) FROM public.jobs j WHERE j.helper_id = v_uid)
         + (SELECT count(*) FROM public.group_job_helpers g WHERE g.helper_id = v_uid)
      INTO v_n;
  END IF;
  RETURN v_n = 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_phone_prompt_due(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sms_phone_prompt_due(text) TO authenticated, service_role;
