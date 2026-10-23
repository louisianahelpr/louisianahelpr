-- NO TEXT IS EVER SENT FOR A NEARBY OR MATCHING JOB (owner ruling, 2026-10-23, for Twilio's A2P campaign review).
--
-- What was wrong: the SMS fan-out (20261021193738_sms_alerts.sql) texted every 'job_match' notification ("New job
-- posted", "Match for you", "New jobs in <parish>", "New job in your parish": measured on prod, read-only, 60 days,
-- every nearby/matching-job notification is type 'job_match' and no other type carries one), behind a per-member
-- switch that was ON unless turned off. The owner dropped nearby-job texts: the campaign covers a member's own jobs,
-- offers and messages only. Matches still reach members in the app, by push and by email, unchanged.
--
-- What this does:
--   1. sms_kind_for returns NULL for type 'job_match' (NULL = "never texted"; the fan-out trigger skips it). It is
--      the first WHEN, so no later branch can catch a job_match row.
--   2. Any job_match text still waiting (status 'pending') is skipped with reason 'job_match_texts_retired'. Rows
--      already sent or failed are history and stay. A 'queued' row is mid-send and is left to finish.
--   3. The consent wording changed (src/lib/smsConsent.ts drops "nearby jobs"), so the version the server stamps
--      moves to 'sms-v2' in set_sms_consent and sms_inbound_keyword (src/test/smsAlerts.test.ts keeps it equal to
--      SMS_CONSENT_TEXT_VERSION). Those two bodies are copied from 20261021193738 with only the version changed.
--      Existing 'sms-v1' consents stay valid: v1 covered a superset of what is texted now.
-- The second layer is send-sms-notification, which refuses a job_match claim (src/test/edge/sms-alerts.test.ts).
-- set_sms_job_match_texts and sms_consent.job_match_texts are left in place, unused by the app (no drop on a live
-- table in the same change).
--
-- REPLAY-SAFETY: every statement is CREATE OR REPLACE or an UPDATE of a table the earlier migration creates.

-- 1. -----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sms_kind_for(p_type text, p_title text, p_job_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    -- Nearby / matching jobs are never texted (owner 2026-10-23). First, so nothing below can catch one.
    WHEN p_type = 'job_match' THEN NULL
    WHEN p_type = 'message' THEN 'message'
    -- A job offer has an answer deadline (direct offer, or the hire offer).
    WHEN p_type = 'new_offers' AND p_title = 'You got a direct job offer!' THEN 'job_offer'
    WHEN p_type = 'info' AND p_title = '📋 New job offer!' THEN 'job_offer'
    WHEN p_type = 'application' AND p_title = 'New application' THEN 'application'
    WHEN p_type = 'job_update' AND p_title = 'Starting soon' THEN 'starting_soon'
    WHEN p_type = 'job_updates' AND p_title = 'New date or time requested' THEN 'reschedule'
    WHEN p_type = 'warning' AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute'
    WHEN p_type IN ('payment', 'warning') AND p_title IN ('Job cancelled', 'Job cancelled — you''ll be compensated') THEN 'job_cancelled'
    WHEN p_type = 'warning' AND p_title = 'Your Helpr cancelled' THEN 'job_cancelled'
    WHEN p_type = 'job_updates' AND p_title = 'Job auto-cancelled' THEN 'job_cancelled'
    WHEN p_type = 'warning' AND p_title IN ('Your payout didn''t go through', 'Payout account needs attention',
                                            'Payment failed', 'Your bank payment failed', 'Job payment failed')
      THEN 'money_problem'
    WHEN p_type = 'payment' AND p_title = 'A refund didn''t go through' THEN 'money_problem'
    WHEN p_type = 'financial_alerts' AND p_title IN ('Payout account required', 'We couldn''t send your payout') THEN 'money_problem'
    -- Other updates on the member's own job (never a back-out reminder: those
    -- are type 'warning' and not listed above).
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'expired') AND p_job_id IS NOT NULL THEN 'job_update'
    WHEN p_type IN ('info', 'success') AND p_job_id IS NOT NULL THEN 'job_update'
    ELSE NULL
  END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_kind_for(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_kind_for(text, text, uuid) TO service_role;

-- 2. -----------------------------------------------------------------------------------------------------------
UPDATE public.sms_messages
   SET status = 'skipped', reason = 'job_match_texts_retired'
 WHERE status = 'pending' AND kind = 'job_match';

-- 3. -----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_sms_consent(p_opt_in boolean, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_existing public.sms_consent;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.sms_consent WHERE user_id = v_uid FOR UPDATE;

  IF p_opt_in IS TRUE THEN
    -- Asking for texts is behind the switch; turning them off never is.
    IF NOT public.feature_enabled_for_user('sms_alerts', v_uid) THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
    END IF;
    -- Q281: a banned account cannot START texts. Turning them OFF stays open
    -- to every account, banned or not: an opt-out must always work.
    IF public.is_caller_banned() THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    END IF;
    v_phone := public.sms_normalize_phone(p_phone);
    IF v_phone IS NULL THEN
      RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
    END IF;
    IF v_existing.sms_opt_in AND v_existing.phone_e164 = v_phone THEN
      RETURN public.get_my_sms_consent();
    END IF;

    INSERT INTO public.sms_consent AS s (user_id, pending_phone, pending_since, updated_at)
    VALUES (v_uid, v_phone, now(), now())
    ON CONFLICT (user_id) DO UPDATE
      SET pending_phone = EXCLUDED.pending_phone,
          pending_since = now(),
          -- a new request makes any earlier confirmation code useless
          confirm_code = NULL, confirm_phone = NULL, confirm_sent_at = NULL,
          updated_at = now();

    INSERT INTO public.sms_consent_events (user_id, event, phone_e164, source, consent_text_version)
    VALUES (v_uid, 'opt_in_requested', v_phone, 'settings', 'sms-v2');

    PERFORM public.sms_post_to_edge(jsonb_build_object('confirm_user_id', v_uid));
  ELSE
    IF v_existing.user_id IS NOT NULL AND v_existing.sms_opt_in THEN
      INSERT INTO public.sms_consent_events (user_id, event, phone_e164, source)
      VALUES (v_uid, 'opt_out', v_existing.phone_e164, 'settings');
    END IF;
    UPDATE public.sms_consent
       SET sms_opt_in = false,
           opted_out_at = CASE WHEN sms_opt_in THEN now() ELSE opted_out_at END,
           opt_out_source = CASE WHEN sms_opt_in THEN 'settings' ELSE opt_out_source END,
           pending_phone = NULL, pending_since = NULL,
           confirm_code = NULL, confirm_phone = NULL, confirm_sent_at = NULL, updated_at = now()
     WHERE user_id = v_uid;
    -- Nothing already waiting goes out after an opt-out.
    UPDATE public.sms_messages SET status = 'skipped', reason = 'no_consent'
     WHERE user_id = v_uid AND status = 'pending';
  END IF;

  RETURN public.get_my_sms_consent();
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_sms_consent(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sms_consent(boolean, text) TO authenticated;

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
    -- The account whose confirmation text carried this code to this number.
    -- Two accounts holding the same code for one number (1 in 10,000) is
    -- ambiguous: confirm neither, and each can ask again.
    IF p_code IS NOT NULL AND p_code ~ '^[0-9]{4}$'
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

-- 4. -----------------------------------------------------------------------------------------------------------
-- The "New jobs near you" switch is gone from the app (SmsAlertsCard), so nothing calls set_sms_job_match_texts and
-- members can no longer run it (scripts/ci/definer-exec-allowlist.json lists only functions a client calls). The
-- function and the sms_consent.job_match_texts column stay; only the grant narrows.
REVOKE ALL ON FUNCTION public.set_sms_job_match_texts(boolean) FROM PUBLIC, anon, authenticated;
