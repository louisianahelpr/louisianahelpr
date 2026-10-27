-- The one-time "Add your phone so you don't miss updates" prompt (owner-approved 2026-10-27, through the lead):
-- shown when a member posts their FIRST job and when a Helpr is FIRST hired, with the existing text-alert opt-in
-- (SmsAlertsCard: the same consent sentence, version and double opt-in). Never on sign-up (no session there).
--
-- "Dismissed" lives on the ACCOUNT: notification_preferences.sms_phone_prompt_dismissed_at. Every account has one
-- preferences row (303 of 303 on prod, read-only 2026-10-27), its RLS is own row only (select / insert / update
-- WHERE auth.uid() = user_id), and export_my_data already exports the whole row (to_jsonb), so the new column is
-- in "Download My Data" with nothing else to change.
--
-- Two functions, both acting only for the caller (auth.uid(), never an id passed in):
--   sms_phone_prompt_due(p_moment) -> boolean: not dismissed, no confirmed phone (sms_consent.sms_opt_in), no
--     confirmation waiting (a pending_phone asked for in the last 24 hours, as get_my_sms_consent), and the moment
--     is the member's first: 'first_job' = exactly one job they posted; 'first_hire' = exactly one job or crew seat
--     they were hired for.
--   dismiss_sms_phone_prompt() -> timestamptz: stamps the caller's own row (first stamp kept); returns it.
-- Replay-safe. Proof: src/test/pglite/smsPhonePrompt.pglite.mjs. Guard: src/test/smsPhonePrompt.test.ts.

ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS sms_phone_prompt_dismissed_at timestamptz;

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
  IF p_moment IS NULL OR p_moment NOT IN ('first_job', 'first_hire') THEN
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

CREATE OR REPLACE FUNCTION public.dismiss_sms_phone_prompt()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.notification_preferences (user_id, sms_phone_prompt_dismissed_at)
  VALUES (v_uid, now())
  ON CONFLICT (user_id) DO UPDATE
    SET sms_phone_prompt_dismissed_at = COALESCE(public.notification_preferences.sms_phone_prompt_dismissed_at, now())
  RETURNING sms_phone_prompt_dismissed_at INTO v_at;
  RETURN v_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.dismiss_sms_phone_prompt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_sms_phone_prompt() TO authenticated, service_role;
