-- SMS alerts (owner, 2026-10-20): text alerts for work status, nearby jobs and
-- new messages, sent through Twilio. Everything here is behind the feature
-- switch `sms_alerts`, created 'off'. With the switch off the trigger below
-- returns before any network call, so this migration changes nothing a member
-- can see or receive.
--
-- Consent: a phone number on `profiles` is NOT consent. A member opts in only
-- by ticking an unticked box (set_sms_consent(true, phone)), and the consent
-- row records when, from where and under which wording version. STOP replies
-- (twilio-inbound -> sms_inbound_keyword) and Twilio error 21610 opt out.
--
-- Privacy: texts carry FIXED phrases chosen by category (supabase/functions/
-- _shared/smsPolicy.ts). Notification titles and bodies are never sent: they
-- carry full names, job titles and addresses. sms_messages stores no phone
-- number and no text body.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS
-- throughout, and the switch insert is ON CONFLICT DO NOTHING (so a later flip
-- of the audience is never reset by a replay).

-- 1. The switch ---------------------------------------------------------------
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('sms_alerts', 'off',
        'SMS text alerts (Twilio): opt-in box in Notification settings, texts for work status, nearby jobs and messages. testers = admins only (seed/test accounts are always suppressed). Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID edge secrets and a verified toll-free number before it can send.')
ON CONFLICT (key) DO NOTHING;

-- 2. Consent ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_consent (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  sms_opt_in boolean NOT NULL DEFAULT false,
  opted_in_at timestamptz,
  opt_in_source text,
  consent_text_version text,
  opted_out_at timestamptz,
  opt_out_source text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_consent ENABLE ROW LEVEL SECURITY;
-- No policies: clients read and write only through the RPCs below.
REVOKE ALL ON public.sms_consent FROM PUBLIC, anon, authenticated;

-- One phone can be opted in on one account at a time, so a second account
-- cannot sign someone else's already-subscribed number up again.
CREATE UNIQUE INDEX IF NOT EXISTS sms_consent_one_opted_in_phone
  ON public.sms_consent (phone_e164) WHERE sms_opt_in;

CREATE TABLE IF NOT EXISTS public.sms_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('opt_in', 'opt_out')),
  phone_e164 text NOT NULL,
  source text NOT NULL,
  consent_text_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_consent_events FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS sms_consent_events_user_idx
  ON public.sms_consent_events (user_id, created_at DESC);

-- 3. One row per notification considered for a text -----------------------------
CREATE TABLE IF NOT EXISTS public.sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text,
  kind text,
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  reason text,
  provider_sid text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_messages FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS sms_messages_user_recent_idx
  ON public.sms_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_messages_recent_idx
  ON public.sms_messages (created_at DESC);

-- 4. Pure helpers ----------------------------------------------------------------
-- Which SMS category a notification belongs to, or NULL for "never texted".
-- 'warning' (offer expired/declined to applicants, 742 rows in 30 days on
-- 2026-10-19) and every admin/system/payment type stay out on purpose.
-- info/success count only when they are about a job (job_id set).
CREATE OR REPLACE FUNCTION public.sms_category_for(p_type text, p_job_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN p_type = 'message' THEN 'messages'
    WHEN p_type = 'job_match' THEN 'job_matches'
    WHEN p_type IN ('new_offers', 'job_updates', 'job_update', 'work_status', 'expired') THEN 'work_status'
    WHEN p_type IN ('info', 'success') AND p_job_id IS NOT NULL THEN 'work_status'
    ELSE NULL
  END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_category_for(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_category_for(text, uuid) TO service_role;

-- US numbers only. Returns NULL for anything that is not a valid NANP number.
CREATE OR REPLACE FUNCTION public.sms_normalize_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  d text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  e text;
BEGIN
  IF length(d) = 10 THEN
    e := '+1' || d;
  ELSIF length(d) = 11 AND left(d, 1) = '1' THEN
    e := '+' || d;
  ELSE
    RETURN NULL;
  END IF;
  IF e !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' THEN
    RETURN NULL;
  END IF;
  RETURN e;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_normalize_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_normalize_phone(text) TO service_role;

-- 5. Member RPCs -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_sms_consent()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  c public.sms_consent;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.sms_consent WHERE user_id = v_uid;
  RETURN jsonb_build_object(
    'phone_e164', c.phone_e164,
    'sms_opt_in', COALESCE(c.sms_opt_in, false),
    'opted_in_at', c.opted_in_at,
    'opted_out_at', c.opted_out_at,
    'opt_out_source', c.opt_out_source
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_sms_consent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sms_consent() TO authenticated;

-- The consent wording version is stamped by the SERVER, not passed in by the
-- client: src/lib/smsConsent.ts SMS_CONSENT_TEXT_VERSION must equal it
-- (src/test/smsAlerts.test.ts).
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
    -- Opting IN is behind the switch; opting OUT never is.
    IF NOT public.feature_enabled_for_user('sms_alerts', v_uid) THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
    END IF;
    v_phone := public.sms_normalize_phone(p_phone);
    IF v_phone IS NULL THEN
      RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.sms_consent
                WHERE phone_e164 = v_phone AND sms_opt_in AND user_id <> v_uid) THEN
      RAISE EXCEPTION 'phone_in_use' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.sms_consent AS s
      (user_id, phone_e164, sms_opt_in, opted_in_at, opt_in_source, consent_text_version,
       opted_out_at, opt_out_source, updated_at)
    VALUES (v_uid, v_phone, true, now(), 'settings', 'sms-v1', NULL, NULL, now())
    ON CONFLICT (user_id) DO UPDATE
      SET phone_e164 = EXCLUDED.phone_e164,
          sms_opt_in = true,
          opted_in_at = now(),
          opt_in_source = 'settings',
          consent_text_version = 'sms-v1',
          opted_out_at = NULL,
          opt_out_source = NULL,
          updated_at = now();

    INSERT INTO public.sms_consent_events (user_id, event, phone_e164, source, consent_text_version)
    VALUES (v_uid, 'opt_in', v_phone, 'settings', 'sms-v1');
  ELSE
    IF v_existing.user_id IS NOT NULL AND v_existing.sms_opt_in THEN
      UPDATE public.sms_consent
         SET sms_opt_in = false, opted_out_at = now(), opt_out_source = 'settings', updated_at = now()
       WHERE user_id = v_uid;
      INSERT INTO public.sms_consent_events (user_id, event, phone_e164, source)
      VALUES (v_uid, 'opt_out', v_existing.phone_e164, 'settings');
    END IF;
  END IF;

  RETURN public.get_my_sms_consent();
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_sms_consent(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sms_consent(boolean, text) TO authenticated;

-- 6. The send decision (service_role only) -------------------------------------------
-- Called by send-sms-notification with the notification id. Idempotent: the
-- second call for one notification returns 'duplicate' and inserts nothing.
-- Order: eligibility -> consent -> seed/test suppression -> switch -> provider
-- configured -> the member's category toggle -> quiet hours -> caps.
CREATE OR REPLACE FUNCTION public.sms_claim(p_notification_id uuid, p_provider_ready boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  n public.notifications;
  c public.sms_consent;
  v_category text;
  v_kind text;
  v_reason text;
  v_pref_col text;
  v_pref boolean;
  v_hour int;
  v_first boolean;
  v_id uuid;
  prefs public.notification_preferences;
BEGIN
  SELECT * INTO n FROM public.notifications WHERE id = p_notification_id;
  IF n.id IS NULL THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'notification_missing');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('sms:' || n.user_id::text, 0));

  IF EXISTS (SELECT 1 FROM public.sms_messages WHERE notification_id = n.id) THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'duplicate');
  END IF;

  v_category := public.sms_category_for(n.type, n.job_id);
  v_kind := CASE
    WHEN v_category = 'messages' THEN 'message'
    WHEN v_category = 'job_matches' THEN 'job_match'
    WHEN n.type = 'new_offers' THEN 'job_offer'
    -- The hired notice ("New job offer!", template job_offer, type info). Only
    -- the title is MATCHED here; it is never sent.
    WHEN n.type = 'info' AND n.title ILIKE '%job offer%' THEN 'job_offer'
    WHEN v_category = 'work_status' THEN 'job_update'
    ELSE NULL
  END;

  SELECT * INTO c FROM public.sms_consent WHERE user_id = n.user_id;

  IF v_category IS NULL THEN
    v_reason := 'not_eligible';
  ELSIF c.user_id IS NULL OR NOT c.sms_opt_in THEN
    v_reason := 'no_consent';
  ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = n.user_id AND p.is_seed IS TRUE)
     OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = n.user_id) THEN
    v_reason := 'suppressed_seed';
  ELSIF NOT public.feature_enabled_for_user('sms_alerts', n.user_id) THEN
    v_reason := 'switch_off';
  ELSIF p_provider_ready IS NOT TRUE THEN
    v_reason := 'twilio_not_configured';
  END IF;

  IF v_reason IS NULL THEN
    -- The member's own category toggle (the push toggles in Notification
    -- settings; there is no separate SMS toggle per category).
    SELECT pref_column INTO v_pref_col FROM public.notification_type_pref_map WHERE type = n.type;
    SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = n.user_id;
    IF v_pref_col IS NOT NULL AND prefs.user_id IS NOT NULL THEN
      EXECUTE format('SELECT ($1).%I', v_pref_col) INTO v_pref USING prefs;
      IF v_pref IS NOT TRUE THEN
        v_reason := 'pref_off';
      END IF;
    END IF;
  END IF;

  IF v_reason IS NULL AND v_category = 'job_matches' THEN
    v_hour := extract(hour FROM (now() AT TIME ZONE 'America/Chicago'))::int;
    IF v_hour >= 21 OR v_hour < 8 THEN
      v_reason := 'quiet_hours';
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    IF (SELECT count(*) FROM public.sms_messages m
         WHERE m.user_id = n.user_id AND m.status IN ('queued', 'sent')
           AND m.created_at > now() - interval '24 hours') >= 30 THEN
      v_reason := 'cap_daily_total';
    ELSIF v_category = 'job_matches' AND (
            (SELECT count(*) FROM public.sms_messages m
              WHERE m.user_id = n.user_id AND m.category = 'job_matches'
                AND m.status IN ('queued', 'sent') AND m.created_at > now() - interval '1 hour') >= 1
         OR (SELECT count(*) FROM public.sms_messages m
              WHERE m.user_id = n.user_id AND m.category = 'job_matches'
                AND m.status IN ('queued', 'sent') AND m.created_at > now() - interval '24 hours') >= 5) THEN
      v_reason := 'cap_job_matches';
    ELSIF v_category = 'messages' AND EXISTS (
            SELECT 1 FROM public.sms_messages m
             WHERE m.user_id = n.user_id AND m.category = 'messages'
               AND m.status IN ('queued', 'sent') AND m.created_at > now() - interval '10 minutes') THEN
      v_reason := 'coalesced_messages';
    ELSIF v_category = 'work_status' AND (
            SELECT count(*) FROM public.sms_messages m
             WHERE m.user_id = n.user_id AND m.category = 'work_status'
               AND m.status IN ('queued', 'sent') AND m.created_at > now() - interval '24 hours') >= 20 THEN
      v_reason := 'cap_work_status';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.sms_messages (notification_id, user_id, category, kind, status, reason)
    VALUES (n.id, n.user_id, v_category, v_kind, 'skipped', v_reason)
    ON CONFLICT (notification_id) DO NOTHING;
    RETURN jsonb_build_object('action', 'skip', 'reason', v_reason);
  END IF;

  v_first := NOT EXISTS (
    SELECT 1 FROM public.sms_messages m
     WHERE m.user_id = n.user_id AND m.status IN ('queued', 'sent')
       AND m.created_at >= COALESCE(c.opted_in_at, '-infinity'::timestamptz));

  INSERT INTO public.sms_messages (notification_id, user_id, category, kind, status)
  VALUES (n.id, n.user_id, v_category, v_kind, 'queued')
  ON CONFLICT (notification_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'duplicate');
  END IF;

  RETURN jsonb_build_object(
    'action', 'send',
    'sms_id', v_id,
    'phone', c.phone_e164,
    'category', v_category,
    'kind', v_kind,
    'job_id', n.job_id,
    'first_text', v_first
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_claim(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_claim(uuid, boolean) TO service_role;

-- Records Twilio's answer for a queued text. Error 21610 means the recipient
-- replied STOP at the carrier: mirror it as an opt-out.
CREATE OR REPLACE FUNCTION public.sms_record_result(
  p_sms_id uuid, p_status text, p_provider_sid text, p_error_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user uuid;
BEGIN
  IF p_status NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'invalid_status %', p_status USING ERRCODE = '22023';
  END IF;
  UPDATE public.sms_messages
     SET status = p_status,
         provider_sid = left(p_provider_sid, 64),
         error_code = left(p_error_code, 32),
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE NULL END
   WHERE id = p_sms_id AND status = 'queued'
  RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  IF p_error_code = '21610' THEN
    INSERT INTO public.sms_consent_events (user_id, event, phone_e164, source)
    SELECT user_id, 'opt_out', phone_e164, 'carrier_21610'
      FROM public.sms_consent WHERE user_id = v_user AND sms_opt_in;
    UPDATE public.sms_consent
       SET sms_opt_in = false, opted_out_at = now(), opt_out_source = 'carrier_21610', updated_at = now()
     WHERE user_id = v_user AND sms_opt_in;
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_record_result(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_record_result(uuid, text, text, text) TO service_role;

-- STOP / START replies from twilio-inbound. Returns the number of accounts changed.
CREATE OR REPLACE FUNCTION public.sms_inbound_keyword(p_phone text, p_action text)
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
  ELSIF p_action = 'start' THEN
    -- Re-subscribe only the account that this number last left by STOP (or a
    -- carrier block), and only if no account holds the number opted in now.
    IF NOT EXISTS (SELECT 1 FROM public.sms_consent WHERE phone_e164 = v_phone AND sms_opt_in) THEN
      SELECT user_id INTO v_user FROM public.sms_consent
       WHERE phone_e164 = v_phone AND opt_out_source IN ('sms_stop', 'carrier_21610')
       ORDER BY opted_out_at DESC NULLS LAST LIMIT 1;
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
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_action %', p_action USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_inbound_keyword(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_inbound_keyword(text, text) TO service_role;

-- 7. Admin status -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_sms_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'audience', (SELECT audience FROM public.feature_switches WHERE key = 'sms_alerts'),
    'opted_in', (SELECT count(*) FROM public.sms_consent WHERE sms_opt_in),
    'sent_24h', (SELECT count(*) FROM public.sms_messages WHERE status = 'sent' AND created_at > now() - interval '24 hours'),
    'failed_24h', (SELECT count(*) FROM public.sms_messages WHERE status = 'failed' AND created_at > now() - interval '24 hours'),
    'recent', COALESCE((
      SELECT jsonb_agg(r ORDER BY r.created_at DESC) FROM (
        SELECT created_at, category, kind, status, reason, error_code
          FROM public.sms_messages ORDER BY created_at DESC LIMIT 20) r), '[]'::jsonb)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_sms_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_sms_status() TO authenticated;

-- 8. The trigger -----------------------------------------------------------------------
-- Copies fan_out_push_on_notification's pattern (vault URL + key, pg_net). It
-- posts ONLY the notification id, and only when the type can be texted, the
-- recipient has opted in and the switch is on for them, so members who never
-- opted in cost nothing. It can never fail the notification insert.
CREATE OR REPLACE FUNCTION public.sms_fan_out_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF public.sms_category_for(NEW.type, NEW.job_id) IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sms_consent WHERE user_id = NEW.user_id AND sms_opt_in) THEN
    RETURN NEW;
  END IF;
  IF NOT public.feature_enabled_for_user('sms_alerts', NEW.user_id) THEN
    RETURN NEW;
  END IF;

  v_url := public.get_supabase_url();
  v_key := public.get_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'sms_fan_out_on_notification: vault secrets missing, text skipped for notification %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-sms-notification',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('notification_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sms_fan_out_on_notification failed for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_fan_out_on_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notifications_fan_out_to_sms ON public.notifications;
CREATE TRIGGER notifications_fan_out_to_sms
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type IN ('message', 'job_match', 'new_offers', 'job_updates', 'job_update',
                     'work_status', 'expired', 'info', 'success'))
  EXECUTE FUNCTION public.sms_fan_out_on_notification();
