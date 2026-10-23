-- SMS text alerts (owner 2026-10-20/22): text a member about the things that
-- need them, through Twilio, behind the feature switch `sms_alerts` (created
-- 'off'). With the switch off nothing here sends or queues a text.
--
-- Why now (lead 2026-10-22): push has never reached a web member (push_tokens
-- held 0 rows on 2026-10-21, read-only) and 36 of 37 active members use the
-- website, so a text is the fastest way to reach someone.
--
-- Rebuilt on main from wip/sms-alerts (20261020022332, never applied) with the
-- slice-1 gaps closed:
--   * What is texted (sms_kind_for, by notification type AND exact title):
--     a new message, a new job near you, a job offer (direct or hired), a new
--     application, a job starting soon, a reschedule request, a dispute opened,
--     a job cancelled on you, a money/payout problem, and other work updates on
--     your own jobs. Back-out reminders ('Offer expired'/'Offer declined',
--     re-sent every 2 hours) and every admin, review and promotion type are
--     never texted.
--   * Only when the alert is still UNREAD a few minutes later: the trigger
--     queues a pending row due 3 minutes on; a SQL cron every 2 minutes
--     (sms-dispatch) wakes send-sms-notification, whose sms_claim_due skips a
--     row whose notification was read meanwhile (opening a thread marks the
--     message notification read, trg_mark_message_notifications_read).
--   * Quiet hours (9pm-8am Central, and the member's own window) DEFER a
--     non-urgent text to the end of the window instead of dropping it. A job
--     offer (it has an answer deadline) and "starting soon" are urgent and go
--     at night too; stale ones are dropped (a job match after 12 hours,
--     "starting soon" after 45 minutes).
--   * Caps: 10 texts a day per member (urgent kinds exempt), new jobs near you
--     at most 1 an hour and 3 a day with their own off switch
--     (sms_consent.job_match_texts, owner 2026-10-22), message texts at most
--     one per 10 minutes. Banned accounts are skipped at send time.
--   * Download My Data carries the member's sms_consent row, their consent
--     events and their sms_messages rows (export_my_data restated below from
--     20261021184925, the newest body).
--
-- Consent: a phone number on `profiles` is NOT consent. A member asks for
-- texts only by ticking an unticked box (set_sms_consent(true, phone)); the
-- number becomes PENDING and ONE confirmation text is sent. Texts start only
-- when the phone replies YES (twilio-inbound -> sms_inbound_keyword): double
-- opt-in. Every step is kept in sms_consent_events. STOP replies and Twilio
-- error 21610 opt out.
--
-- Privacy: texts carry FIXED phrases chosen by kind (supabase/functions/
-- _shared/smsPolicy.ts). Notification titles and bodies are never sent.
-- sms_messages stores no phone number and no text body.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS
-- throughout; the switch insert is ON CONFLICT DO NOTHING (a later audience
-- flip is never reset by a replay).

-- 1. The switch ---------------------------------------------------------------
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('sms_alerts', 'off',
        'SMS text alerts (Twilio): opt-in box in Notification settings. Texts for messages, job offers, applications, nearby jobs, starting soon, reschedules, disputes, cancellations and money problems. testers = admins only (seed/test accounts are always suppressed). Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID edge secrets and a verified toll-free number before it can send.')
ON CONFLICT (key) DO NOTHING;

-- 2. Consent ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_consent (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 text CHECK (phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  sms_opt_in boolean NOT NULL DEFAULT false,
  opted_in_at timestamptz,
  opt_in_source text,
  consent_text_version text,
  opted_out_at timestamptz,
  opt_out_source text,
  -- Asked for, not yet confirmed by a YES from the phone.
  pending_phone text CHECK (pending_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  pending_since timestamptz,
  -- The confirmation text this account was last SENT: its 4-digit code, the
  -- number it went to, and when. The phone's "YES <code>" opts in only the
  -- account whose confirmation carried that code to that number
  -- (lh-authz-rls review: a bare YES used to opt in the newest request, so
  -- anyone could take a member's opt-in). Cleared by any new request.
  confirm_code text CHECK (confirm_code ~ '^[0-9]{4}$'),
  confirm_phone text CHECK (confirm_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  confirm_sent_at timestamptz,
  -- "New job near you" texts have their own off switch (owner 2026-10-22).
  job_match_texts boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_consent ADD COLUMN IF NOT EXISTS job_match_texts boolean NOT NULL DEFAULT true;
ALTER TABLE public.sms_consent ADD COLUMN IF NOT EXISTS confirm_code text CHECK (confirm_code ~ '^[0-9]{4}$');
ALTER TABLE public.sms_consent ADD COLUMN IF NOT EXISTS confirm_phone text CHECK (confirm_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$');
ALTER TABLE public.sms_consent ADD COLUMN IF NOT EXISTS confirm_sent_at timestamptz;
ALTER TABLE public.sms_consent ENABLE ROW LEVEL SECURITY;
-- No policies: clients read and write only through the RPCs below.
REVOKE ALL ON public.sms_consent FROM PUBLIC, anon, authenticated;
-- Server-only: members reach it through the definer RPCs below, never directly.
GRANT ALL ON public.sms_consent TO service_role;

-- One phone is opted in on one account at a time.
CREATE UNIQUE INDEX IF NOT EXISTS sms_consent_one_opted_in_phone
  ON public.sms_consent (phone_e164) WHERE sms_opt_in;

CREATE TABLE IF NOT EXISTS public.sms_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, not CASCADE: the consent record outlives a deleted account
  -- for 4 years (owner, 2026-10-20, Q2336; section 11 below).
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN ('opt_in_requested', 'opt_in', 'opt_out')),
  phone_e164 text NOT NULL,
  source text NOT NULL,
  consent_text_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- When the account was deleted (set by sms_consent_events_mark_account_deleted
  -- as the FK nulls user_id). The 4-year window runs from here.
  account_deleted_at timestamptz
);
ALTER TABLE public.sms_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_consent_events FROM PUBLIC, anon, authenticated;
-- Server-only: members reach it through the definer RPCs below, never directly.
GRANT ALL ON public.sms_consent_events TO service_role;
CREATE INDEX IF NOT EXISTS sms_consent_events_user_idx
  ON public.sms_consent_events (user_id, created_at DESC);

-- 3. One row per notification considered for a text -----------------------------
-- 'pending' = queued by the trigger, waiting until due_at (the unread delay or
-- the end of quiet hours); 'queued' = claimed to send now; then sent / failed /
-- skipped (with the reason).
CREATE TABLE IF NOT EXISTS public.sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL for a consent confirmation text (kind 'confirm').
  notification_id uuid UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text,
  kind text,
  status text NOT NULL CHECK (status IN ('pending', 'queued', 'sent', 'failed', 'skipped')),
  reason text,
  due_at timestamptz,
  provider_sid text,
  -- A confirmation row only: md5 of the number it went to, so the per-number
  -- cap can count confirmations SENT to a number without storing the number.
  phone_hash text,
  -- Twilio's error code. Named provider_error_code, not error_code: no other
  -- table has error_code, and fixtures' HTTP error bodies carry that key.
  provider_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT sms_messages_pending_due CHECK (status <> 'pending' OR due_at IS NOT NULL)
);
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_messages FROM PUBLIC, anon, authenticated;
-- Server-only: members reach it through the definer RPCs below, never directly.
GRANT ALL ON public.sms_messages TO service_role;
CREATE INDEX IF NOT EXISTS sms_messages_user_recent_idx
  ON public.sms_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_messages_recent_idx
  ON public.sms_messages (created_at DESC);
ALTER TABLE public.sms_messages ADD COLUMN IF NOT EXISTS phone_hash text;
CREATE INDEX IF NOT EXISTS sms_messages_due_idx
  ON public.sms_messages (due_at) WHERE status = 'pending';

-- 4. Pure helpers ----------------------------------------------------------------
-- WHICH notifications are texted, by type and exact title (many kinds share a
-- type). Returns the kind, or NULL for "never texted". The fixed phrase for
-- each kind is in smsPolicy.ts (SMS_KIND_PHRASES; src/test/smsAlerts.test.ts
-- holds the two lists equal). Titles measured on prod 2026-10-22 (read-only,
-- 60 days of notifications) and read from their producers.
CREATE OR REPLACE FUNCTION public.sms_kind_for(p_type text, p_title text, p_job_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN p_type = 'message' THEN 'message'
    WHEN p_type = 'job_match' THEN 'job_match'
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

-- The member-facing category a kind belongs to (the admin log groups by it).
CREATE OR REPLACE FUNCTION public.sms_category_of(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN p_kind = 'message' THEN 'messages'
    WHEN p_kind = 'job_match' THEN 'job_matches'
    WHEN p_kind = 'money_problem' THEN 'money'
    WHEN p_kind IS NULL THEN NULL
    ELSE 'work_status'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_category_of(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_category_of(text) TO service_role;

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

-- When a text due at p_at may go out, for a member's quiet hours: the end of
-- the window it falls in, or p_at itself. Wall-clock America/Chicago (as
-- send-push-notification/quietHours.ts); a window may cross midnight. The
-- house window is 21:00-08:00; p_member_start/end is the member's own.
CREATE OR REPLACE FUNCTION public.sms_quiet_release(p_at timestamptz, p_start time, p_end time)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_local timestamp := p_at AT TIME ZONE 'America/Chicago';
  v_t time := v_local::time;
  v_end_local timestamp;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_start = p_end THEN
    RETURN p_at;
  END IF;
  IF p_start < p_end THEN
    IF v_t >= p_start AND v_t < p_end THEN
      v_end_local := v_local::date + p_end;
    ELSE
      RETURN p_at;
    END IF;
  ELSE
    IF v_t >= p_start THEN
      v_end_local := (v_local::date + 1) + p_end;
    ELSIF v_t < p_end THEN
      v_end_local := v_local::date + p_end;
    ELSE
      RETURN p_at;
    END IF;
  END IF;
  RETURN v_end_local AT TIME ZONE 'America/Chicago';
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_quiet_release(timestamptz, time, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_quiet_release(timestamptz, time, time) TO service_role;

-- 5. Member RPCs -----------------------------------------------------------------
-- Posts one request to send-sms-notification through pg_net. Never raises: a
-- missing vault secret or a pg_net error is written to error_logs (no member
-- data, only the ids) so it is seen, and the caller carries on.
CREATE OR REPLACE FUNCTION public.sms_post_to_edge(p_body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_url text;
  v_key text;
BEGIN
  v_url := public.get_supabase_url();
  v_key := public.get_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'SMS not sent: vault secrets missing',
            jsonb_build_object('source', 'sms_post_to_edge', 'origin', 'server'), p_body);
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-sms-notification',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := p_body,
    -- Q1373: an HTTP cron waits at least 90 s for a stalled platform call.
    timeout_milliseconds := 90000
  );
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'SMS not sent: could not queue the request',
            jsonb_build_object('source', 'sms_post_to_edge', 'origin', 'server'),
            p_body || jsonb_build_object('sqlstate', SQLSTATE, 'error', SQLERRM));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sms_post_to_edge failed (%) and error_logs failed too: %', p_body, SQLERRM;
  END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_post_to_edge(jsonb) FROM PUBLIC, anon, authenticated;

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
  v_pending boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.sms_consent WHERE user_id = v_uid;
  v_pending := c.pending_phone IS NOT NULL AND c.pending_since > now() - interval '24 hours';
  RETURN jsonb_build_object(
    'phone_e164', c.phone_e164,
    'sms_opt_in', COALESCE(c.sms_opt_in, false),
    'opted_in_at', c.opted_in_at,
    'opted_out_at', c.opted_out_at,
    'opt_out_source', c.opt_out_source,
    'pending_phone', CASE WHEN v_pending THEN c.pending_phone END,
    'pending_since', CASE WHEN v_pending THEN c.pending_since END,
    'job_match_texts', COALESCE(c.job_match_texts, true)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_sms_consent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sms_consent() TO authenticated;

-- Ticking the box asks for texts: the number becomes PENDING and one
-- confirmation text is queued. Nothing else is ever texted to it until the
-- phone replies YES. The answer never says whether the number is used by
-- another account (no lookup oracle); in that case no confirmation is sent.
-- The consent wording version is stamped by the SERVER: src/lib/smsConsent.ts
-- SMS_CONSENT_TEXT_VERSION must equal it (src/test/smsAlerts.test.ts).
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
    VALUES (v_uid, 'opt_in_requested', v_phone, 'settings', 'sms-v1');

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

-- "New job near you" texts on or off (owner 2026-10-22: their own toggle).
-- Turning them off is always allowed; it needs no phone and changes nothing
-- else. Off also drops any job-match text still waiting.
CREATE OR REPLACE FUNCTION public.set_sms_job_match_texts(p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023';
  END IF;
  -- Turning job-match texts ON is behind the switch, as asking for texts is
  -- (set_sms_consent); turning them OFF never is.
  IF p_on AND NOT public.feature_enabled_for_user('sms_alerts', v_uid) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
  -- Q281: a banned account cannot turn job-match texts ON. Turning them OFF
  -- stays open to every account: an opt-out must always work.
  IF p_on AND public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.sms_consent (user_id, job_match_texts, updated_at)
  VALUES (v_uid, p_on, now())
  ON CONFLICT (user_id) DO UPDATE SET job_match_texts = EXCLUDED.job_match_texts, updated_at = now();
  IF NOT p_on THEN
    UPDATE public.sms_messages SET status = 'skipped', reason = 'job_match_texts_off'
     WHERE user_id = v_uid AND status = 'pending' AND kind = 'job_match';
  END IF;
  RETURN public.get_my_sms_consent();
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_sms_job_match_texts(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sms_job_match_texts(boolean) TO authenticated;

-- The confirmation text's send decision (service_role only). At most 3 a day
-- per account and 5 a day per NUMBER across all accounts (confirmations
-- SENT, failed ones included); only for a pending number no other account
-- has opted in; never to seed/test or banned accounts, with the switch off or
-- Twilio unconfigured. A send gets a fresh 4-digit code (the YES must carry
-- it). What a member can see of these decisions is only "a confirmation was
-- considered": export_my_data strips a confirmation row's status and reason
-- and the consent row's confirm_* and updated_at, and this function changes
-- nothing else a member can read.
CREATE OR REPLACE FUNCTION public.sms_claim_confirmation(p_user_id uuid, p_provider_ready boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  c public.sms_consent;
  v_reason text;
  v_id uuid;
  v_code text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sms:' || p_user_id::text, 0));
  SELECT * INTO c FROM public.sms_consent WHERE user_id = p_user_id;
  IF c.pending_phone IS NULL OR c.pending_since < now() - interval '1 hour' THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'no_pending');
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id AND p.is_seed IS TRUE)
     OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id) THEN
    v_reason := 'suppressed_seed';
  ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id
                   AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                   AND (p.ban_status <> 'temp_banned' OR p.auto_suspended_until IS NULL OR p.auto_suspended_until > now())) THEN
    v_reason := 'account_restricted';
  ELSIF NOT public.feature_enabled_for_user('sms_alerts', p_user_id) THEN
    v_reason := 'switch_off';
  ELSIF p_provider_ready IS NOT TRUE THEN
    v_reason := 'twilio_not_configured';
  ELSIF EXISTS (SELECT 1 FROM public.sms_consent o
                 WHERE o.phone_e164 = c.pending_phone AND o.sms_opt_in AND o.user_id <> p_user_id) THEN
    v_reason := 'phone_in_use';
  ELSIF (SELECT count(*) FROM public.sms_messages m
          WHERE m.user_id = p_user_id AND m.kind = 'confirm'
            AND m.status IN ('queued', 'sent', 'failed') AND m.created_at > now() - interval '24 hours') >= 3 THEN
    v_reason := 'cap_confirm';
  ELSIF (SELECT count(*) FROM public.sms_messages m
          WHERE m.kind = 'confirm' AND m.phone_hash = md5(c.pending_phone)
            AND m.status IN ('queued', 'sent', 'failed') AND m.created_at > now() - interval '24 hours') >= 5 THEN
    v_reason := 'cap_confirm_number';
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.sms_messages (user_id, category, kind, status, reason)
    VALUES (p_user_id, 'consent', 'confirm', 'skipped', v_reason);
    RETURN jsonb_build_object('action', 'skip', 'reason', v_reason);
  END IF;

  INSERT INTO public.sms_messages (user_id, category, kind, status, phone_hash)
  VALUES (p_user_id, 'consent', 'confirm', 'queued', md5(c.pending_phone))
  RETURNING id INTO v_id;
  v_code := lpad((floor(random() * 10000))::integer::text, 4, '0');
  -- updated_at is NOT touched: it is exported, and would tell a member that
  -- this send happened (and so that the number is not used elsewhere).
  UPDATE public.sms_consent
     SET confirm_code = v_code, confirm_phone = c.pending_phone, confirm_sent_at = now()
   WHERE user_id = p_user_id;
  RETURN jsonb_build_object('action', 'send', 'sms_id', v_id, 'phone', c.pending_phone,
                            'kind', 'confirm', 'job_id', NULL, 'first_text', false, 'code', v_code);
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_claim_confirmation(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_claim_confirmation(uuid, boolean) TO service_role;

-- 6. The send decision (service_role only) -------------------------------------------
-- Called by send-sms-notification on a drain. Takes up to p_limit DUE pending
-- rows (oldest first, SKIP LOCKED so two drains never take one row) and
-- settles each: skipped (with the reason), re-dated (quiet hours), or claimed
-- 'queued' and returned to be sent. Order of checks: the notification still
-- exists and is UNREAD -> consent -> seed/test suppression -> banned ->
-- switch -> provider configured -> the member's category toggle -> stale ->
-- quiet hours (defer) -> caps.
CREATE OR REPLACE FUNCTION public.sms_claim_due(p_limit integer, p_provider_ready boolean, p_now timestamptz DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r public.sms_messages;
  n public.notifications;
  c public.sms_consent;
  prefs public.notification_preferences;
  v_reason text;
  v_pref_col text;
  v_pref boolean;
  v_urgent boolean;
  v_release timestamptz;
  v_first boolean;
  -- p_now: the clock the decisions read (NULL = now()). The edge function never
  -- passes it; the PGlite proof does, to test night and day deterministically.
  v_now timestamptz := COALESCE(p_now, now());
BEGIN
  FOR r IN
    SELECT * FROM public.sms_messages
     WHERE status = 'pending' AND due_at <= v_now
     ORDER BY due_at
     LIMIT least(greatest(COALESCE(p_limit, 25), 1), 100)
     FOR UPDATE SKIP LOCKED
  LOOP
    v_reason := NULL;
    SELECT * INTO n FROM public.notifications WHERE id = r.notification_id;
    SELECT * INTO c FROM public.sms_consent WHERE user_id = r.user_id;
    SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = r.user_id;
    v_urgent := r.kind IN ('job_offer', 'starting_soon');

    IF n.id IS NULL THEN
      v_reason := 'notification_missing';
    ELSIF n.read IS TRUE THEN
      -- Seen in the app within the delay: the text would only repeat it.
      v_reason := 'seen_in_app';
    ELSIF c.user_id IS NULL OR NOT c.sms_opt_in THEN
      v_reason := 'no_consent';
    ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = r.user_id AND p.is_seed IS TRUE)
       OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = r.user_id) THEN
      v_reason := 'suppressed_seed';
    ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = r.user_id
                     AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                     -- the same lapsed-suspension rule as is_caller_banned()
                     AND (p.ban_status <> 'temp_banned' OR p.auto_suspended_until IS NULL OR p.auto_suspended_until > v_now)) THEN
      v_reason := 'account_restricted';
    ELSIF NOT public.feature_enabled_for_user('sms_alerts', r.user_id) THEN
      v_reason := 'switch_off';
    ELSIF p_provider_ready IS NOT TRUE THEN
      v_reason := 'twilio_not_configured';
    ELSIF r.kind = 'job_match' AND c.job_match_texts IS NOT TRUE THEN
      v_reason := 'job_match_texts_off';
    END IF;

    IF v_reason IS NULL THEN
      -- The member's own category toggle (the push toggles in Notification
      -- settings): a category they muted is not texted either.
      SELECT pref_column INTO v_pref_col FROM public.notification_type_pref_map WHERE type = n.type;
      IF v_pref_col IS NOT NULL AND prefs.user_id IS NOT NULL THEN
        EXECUTE format('SELECT ($1).%I', v_pref_col) INTO v_pref USING prefs;
        IF v_pref IS NOT TRUE THEN
          v_reason := 'pref_off';
        END IF;
      END IF;
    END IF;

    IF v_reason IS NULL AND (
         (r.kind = 'job_match' AND n.created_at < v_now - interval '12 hours')
      OR (r.kind = 'starting_soon' AND n.created_at < v_now - interval '45 minutes')
      OR (n.created_at < v_now - interval '36 hours')) THEN
      v_reason := 'stale';
    END IF;

    IF v_reason IS NULL THEN
      -- Quiet hours DEFER (never drop): the house window for non-urgent
      -- kinds, then the member's own window for every kind.
      v_release := v_now;
      IF NOT v_urgent THEN
        v_release := public.sms_quiet_release(v_release, '21:00'::time, '08:00'::time);
      END IF;
      v_release := public.sms_quiet_release(v_release, prefs.quiet_start, prefs.quiet_end);
      IF v_release > v_now THEN
        UPDATE public.sms_messages SET due_at = v_release, reason = 'quiet_hours' WHERE id = r.id;
        CONTINUE;
      END IF;
    END IF;

    IF v_reason IS NULL THEN
      IF NOT v_urgent AND r.kind <> 'money_problem' AND (SELECT count(*) FROM public.sms_messages m
           WHERE m.user_id = r.user_id AND m.status IN ('queued', 'sent')
             AND m.created_at > v_now - interval '24 hours') >= 10 THEN
        v_reason := 'cap_daily_total';
      ELSIF r.kind = 'job_match' AND (
              (SELECT count(*) FROM public.sms_messages m
                WHERE m.user_id = r.user_id AND m.kind = 'job_match'
                  AND m.status IN ('queued', 'sent') AND m.sent_at > v_now - interval '1 hour') >= 1
           OR (SELECT count(*) FROM public.sms_messages m
                WHERE m.user_id = r.user_id AND m.kind = 'job_match'
                  AND m.status IN ('queued', 'sent') AND COALESCE(m.sent_at, m.created_at) > v_now - interval '24 hours') >= 3) THEN
        v_reason := 'cap_job_matches';
      ELSIF r.kind = 'message' AND EXISTS (
              SELECT 1 FROM public.sms_messages m
               WHERE m.user_id = r.user_id AND m.kind = 'message' AND m.id <> r.id
                 AND m.status IN ('queued', 'sent') AND COALESCE(m.sent_at, m.created_at) > v_now - interval '10 minutes') THEN
        v_reason := 'coalesced_messages';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE public.sms_messages SET status = 'skipped', reason = v_reason WHERE id = r.id;
      CONTINUE;
    END IF;

    v_first := NOT EXISTS (
      SELECT 1 FROM public.sms_messages m
       WHERE m.user_id = r.user_id AND m.status IN ('queued', 'sent') AND m.kind IS DISTINCT FROM 'confirm'
         AND m.created_at >= COALESCE(c.opted_in_at, '-infinity'::timestamptz));
    UPDATE public.sms_messages SET status = 'queued', reason = NULL WHERE id = r.id;
    RETURN NEXT jsonb_build_object(
      'sms_id', r.id,
      'phone', c.phone_e164,
      'category', r.category,
      'kind', r.kind,
      'job_id', n.job_id,
      'first_text', v_first
    );
  END LOOP;
  RETURN;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_claim_due(integer, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_claim_due(integer, boolean, timestamptz) TO service_role;

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
         provider_error_code = left(p_error_code, 32),
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

-- STOP / START(YES) replies from twilio-inbound. Returns the number of
-- accounts changed. "YES <code>" CONFIRMS the request whose confirmation
-- carried that code to this number (the double opt-in); a reply without a
-- code only re-subscribes the account that left this number by STOP or a
-- carrier block within the last 30 days.
-- The two-argument form (an earlier body of this file, never on prod) is dropped.
DROP FUNCTION IF EXISTS public.sms_inbound_keyword(text, text);
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
             opt_in_source = 'sms_confirm', consent_text_version = 'sms-v1',
             opted_out_at = NULL, opt_out_source = NULL,
             pending_phone = NULL, pending_since = NULL,
             confirm_code = NULL, confirm_phone = NULL, confirm_sent_at = NULL, updated_at = now()
       WHERE user_id = v_user;
      INSERT INTO public.sms_consent_events (user_id, event, phone_e164, source, consent_text_version)
      VALUES (v_user, 'opt_in', v_phone, 'sms_confirm', 'sms-v1');
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
    'pending', (SELECT count(*) FROM public.sms_consent WHERE pending_phone IS NOT NULL AND pending_since > now() - interval '24 hours'),
    'waiting', (SELECT count(*) FROM public.sms_messages WHERE status = 'pending'),
    'sent_24h', (SELECT count(*) FROM public.sms_messages WHERE status = 'sent' AND created_at > now() - interval '24 hours'),
    'failed_24h', (SELECT count(*) FROM public.sms_messages WHERE status = 'failed' AND created_at > now() - interval '24 hours'),
    'recent', COALESCE((
      SELECT jsonb_agg(r ORDER BY r.created_at DESC) FROM (
        SELECT created_at, category, kind, status, reason, provider_error_code AS error_code
          FROM public.sms_messages ORDER BY created_at DESC LIMIT 20) r), '[]'::jsonb)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_sms_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_sms_status() TO authenticated;

-- 8. The trigger: queue, never send ---------------------------------------------------
-- Queues a 'pending' row due 3 minutes on, only when the notification can be
-- texted, the recipient has opted in and the switch is on for them, so
-- members who never opted in cost nothing. No network call here. It can
-- never fail the notification insert.
CREATE OR REPLACE FUNCTION public.sms_fan_out_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_kind text;
BEGIN
  v_kind := public.sms_kind_for(NEW.type, NEW.title, NEW.job_id);
  IF v_kind IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sms_consent WHERE user_id = NEW.user_id AND sms_opt_in) THEN
    RETURN NEW;
  END IF;
  IF NOT public.feature_enabled_for_user('sms_alerts', NEW.user_id) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.sms_messages (notification_id, user_id, category, kind, status, due_at)
  VALUES (NEW.id, NEW.user_id, public.sms_category_of(v_kind), v_kind, 'pending', now() + interval '3 minutes')
  ON CONFLICT (notification_id) DO NOTHING;
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
  WHEN (NEW.type IN ('message', 'job_match', 'new_offers', 'job_updates', 'job_update', 'work_status',
                     'expired', 'info', 'success', 'application', 'warning', 'payment', 'financial_alerts'))
  EXECUTE FUNCTION public.sms_fan_out_on_notification();

-- 9. The dispatcher (SQL cron, every 2 minutes) --------------------------------------------
-- Wakes send-sms-notification once when any row is due; nothing to do is the
-- normal minute (no network call then).
CREATE OR REPLACE FUNCTION public.sms_dispatch_due()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_due integer;
BEGIN
  SELECT count(*) INTO v_due FROM public.sms_messages WHERE status = 'pending' AND due_at <= now();
  IF v_due > 0 THEN
    PERFORM public.sms_post_to_edge(jsonb_build_object('drain', true));
  END IF;
  RETURN jsonb_build_object('due', v_due);
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_dispatch_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_dispatch_due() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('sms-dispatch', interval '15 minutes',
            'SMS alerts (2026-10-22): every 2 minutes, wakes send-sms-notification when a queued text is due (3 minutes after its alert, or the end of quiet hours). Behind the sms_alerts switch.',
            'exempt',
            'No text due is the normal minute. Every row settles to a status in sms_messages (sent, failed or skipped with its reason), and a dispatch that cannot reach the function writes error_logs.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- Every 2 minutes on the odd minutes: the minute-0 slot is full
    -- (cronStartsSpreadAcrossMinutes), and a text is due 3 minutes after its
    -- alert anyway, so it goes 3-5 minutes after.
    PERFORM cron.schedule('sms-dispatch', '1-59/2 * * * *',
                          $c$SELECT public.cron_record_work('sms-dispatch', to_jsonb(public.sms_dispatch_due()));$c$);
  END IF;
END
$do$;

-- 10. Q807: every new public table refuses writes from unconfirmed-email sessions.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- 11. Retention (owner, 2026-10-20, Q2336) ------------------------------------------
-- A deleted member's consent record (number, YES/STOP times, source, wording
-- version) is kept for 4 YEARS after the account is deleted (the TCPA
-- limitation period), then deleted automatically. Rows of live accounts are
-- never age-pruned: they are the proof for texts we are still sending.
--
-- The FK's ON DELETE SET NULL runs as an UPDATE on this table, so a BEFORE
-- UPDATE row trigger sees user_id go from a value to NULL and stamps the time.
CREATE OR REPLACE FUNCTION public.sms_consent_events_mark_account_deleted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
BEGIN
  IF OLD.user_id IS NOT NULL AND NEW.user_id IS NULL AND NEW.account_deleted_at IS NULL THEN
    NEW.account_deleted_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_consent_events_mark_account_deleted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sms_consent_events_mark_account_deleted ON public.sms_consent_events;
CREATE TRIGGER sms_consent_events_mark_account_deleted
  BEFORE UPDATE OF user_id ON public.sms_consent_events
  FOR EACH ROW
  EXECUTE FUNCTION public.sms_consent_events_mark_account_deleted();

-- The daily 'prune-retention-tables' cron gains the sms_consent_events block. The rest of the
-- body is restated verbatim from 20260925052618 (its only definition). A row with no user and
-- no deletion stamp (none is written: every insert above names a user) falls back to created_at.
CREATE OR REPLACE FUNCTION public.prune_retention_tables()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_n   bigint;
BEGIN
  IF to_regclass('public.login_history') IS NOT NULL THEN
    DELETE FROM public.login_history lh
     WHERE lh.created_at < now() - interval '365 days'
       AND (lh.user_id IS NULL
            OR EXISTS (SELECT 1 FROM public.login_history n
                        WHERE n.user_id = lh.user_id
                          AND n.created_at > lh.created_at));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('login_history', v_n);
  END IF;

  IF to_regclass('public.notification_logs') IS NOT NULL THEN
    DELETE FROM public.notification_logs
     WHERE created_at < now() - interval '180 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('notification_logs', v_n);
  END IF;

  IF to_regclass('public.profile_views') IS NOT NULL THEN
    DELETE FROM public.profile_views
     WHERE viewed_at < LOCALTIMESTAMP - interval '180 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('profile_views', v_n);
  END IF;

  IF to_regclass('public.job_views') IS NOT NULL THEN
    DELETE FROM public.job_views
     WHERE first_viewed_at < now() - interval '365 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('job_views', v_n);
  END IF;

  IF to_regclass('public.application_rate_log') IS NOT NULL THEN
    DELETE FROM public.application_rate_log
     WHERE created_at < now() - interval '7 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('application_rate_log', v_n);
  END IF;

  IF to_regclass('public.profile_search_rate_log') IS NOT NULL THEN
    DELETE FROM public.profile_search_rate_log
     WHERE created_at < now() - interval '7 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('profile_search_rate_log', v_n);
  END IF;

  IF to_regclass('public.helper_w9_records') IS NOT NULL THEN
    DELETE FROM public.helper_w9_records
     WHERE signed_at < now() - interval '4 years';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('helper_w9_records', v_n);
  END IF;

  IF to_regclass('public.sms_consent_events') IS NOT NULL THEN
    DELETE FROM public.sms_consent_events
     WHERE user_id IS NULL
       AND COALESCE(account_deleted_at, created_at) < now() - interval '4 years';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('sms_consent_events', v_n);
  END IF;

  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.prune_retention_tables() FROM PUBLIC, anon, authenticated;

-- 12. Download My Data ---------------------------------------------------------------
-- export_my_data restated VERBATIM from the newest body, 20261021184925_export_my_data_refund_requests_on_drop_stop
-- (board 141 + Q2262), with the three SMS sections added before RETURN and nothing else.
-- A branch that restates it after this one must start from THIS body.

DROP FUNCTION IF EXISTS public.export_my_data();

CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.agreed_poster_id = v_uid OR t.agreed_helper_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  -- Declutter (20261014200728, B9).
  v_out := v_out || jsonb_build_object('declutter_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_items t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason' - 'drop_stop_cents'), '[]'::jsonb) FROM public.declutter_item_private t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_photos t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_pickup_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_pickup_windows t
      WHERE t.seller_id = v_uid));
  -- Q2278 (lead ruling 2026-10-21): who asked is never shown to another member, the seller included. The asker's own
  -- questions keep asker_id; on the caller's items, others' questions come without it (the caller's answers stay theirs).
  v_out := v_out || jsonb_build_object('declutter_questions', (SELECT coalesce(jsonb_agg(
             CASE WHEN t.asker_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'asker_id' END), '[]'::jsonb) FROM public.declutter_questions t
      WHERE t.asker_id = v_uid OR t.item_id IN (SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_watchlist', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_watchlist t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_tax_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_tax_attestations t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by' - 'appeal_decided_by'), '[]'::jsonb) FROM public.declutter_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_seller_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'set_by'), '[]'::jsonb) FROM public.declutter_seller_flags t
      WHERE t.user_id = v_uid));
  -- Declutter slice 3 (20261014210518): offers (their current amount and
  -- status; the step history has no person column), orders and cart lines on
  -- either side of the trade; the saved card's brand + last 4 (the Stripe ids
  -- are ours, not the member's data, and are never shown to them, B31).
  -- Q2274: on the SELLER's side, an offer the buyer never took into a cart carries no buyer_id (an "I have this" answer to a
  -- Wanted post, or any offer the buyer made, never names the buyer to the seller before a deal; declutter_my_offers
  -- returns no counterparty id either). The buyer's own rows are unchanged.
  v_out := v_out || jsonb_build_object('declutter_offers', (SELECT coalesce(jsonb_agg(
             CASE WHEN t.seller_id = v_uid AND t.buyer_id IS DISTINCT FROM v_uid AND t.status <> 'accepted'
                  THEN to_jsonb(t) - 'buyer_id' ELSE to_jsonb(t) END), '[]'::jsonb) FROM public.declutter_offers t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id'), '[]'::jsonb) FROM public.declutter_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_cart_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_cart_items t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_buyer_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_customer_id' - 'payment_method_id'), '[]'::jsonb) FROM public.declutter_buyer_cards t
      WHERE t.user_id = v_uid));

  -- Declutter slice 3b (20261014224914): a seller's card-fee debts (row 60).
  -- Refunds have no person column (they hang off an order, exported above);
  -- each section is scoped to the caller by its own column only.
  v_out := v_out || jsonb_build_object('declutter_seller_fee_debts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_fee_debts t
      WHERE t.seller_id = v_uid));

  -- Declutter slice 4 (20261015042253): bookings (either side), the problems
  -- the member reported (the deciding admin's id dropped), the seller's payouts
  -- (the Stripe transfer id is ours), and reviews: those the member wrote, and
  -- those about them once visible (row 45: both sides reviewed or 14 days),
  -- without the reviewer's id.
  v_out := v_out || jsonb_build_object('declutter_bookings', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_bookings t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_problems', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.declutter_problems t
      WHERE t.reporter_id = v_uid));
  -- Problems the OTHER side of the member's order reported about them (RLS
  -- already lets both sides read a problem). Without the reporter's private
  -- fields: who reported it (reporter_id), the reporter's photo paths, and
  -- which admin decided (decided_by, never exported).
  v_out := v_out || jsonb_build_object('declutter_problems_about_me', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by' - 'reporter_id' - 'photo_paths'), '[]'::jsonb) FROM public.declutter_problems t
      WHERE t.reporter_id IS DISTINCT FROM v_uid
        AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id
                     AND (o.buyer_id = v_uid OR o.seller_id = v_uid))));
  v_out := v_out || jsonb_build_object('declutter_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_transfer_id' - 'last_error'), '[]'::jsonb) FROM public.declutter_payouts t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_reviews', (SELECT coalesce(jsonb_agg(CASE WHEN t.reviewer_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'reviewer_id' END), '[]'::jsonb) FROM public.declutter_reviews t
      WHERE t.reviewer_id = v_uid
         OR (t.reviewee_id = v_uid AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id
               AND (o.handed_over_at <= now() - interval '14 days'
                    OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = t.order_id) = 2)))));

  -- "Suggest a category" (20261015051141, I1): the caller's own suggestions.
  -- reviewed_by (the staff reviewer) and admin_note (staff-only) are stripped.
  v_out := v_out || jsonb_build_object('category_suggestions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reviewed_by' - 'admin_note'), '[]'::jsonb) FROM public.category_suggestions t
      WHERE t.user_id = v_uid));

  -- Declutter wanted posts (20261016053541). The match ledger holds no person
  -- column; a seller's alerts are in 'notifications' above.
  v_out := v_out || jsonb_build_object('declutter_wanted', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_wanted t
      WHERE t.user_id = v_uid));

  -- Slice 5, Helpr delivery (20261017055505): the Helpr's vehicle, the
  -- deliveries the member made as the Helpr (area words only: the buyer's and
  -- the seller's exact addresses, points and ids, the drop-off code and the
  -- staff close note belong to them or to us, not the Helpr),
  -- the steps they took on any delivery, their delivery pay (the Stripe transfer
  -- id is ours), and the drop-off addresses they typed as a buyer.
  v_out := v_out || jsonb_build_object('helpr_vehicles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helpr_vehicles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helpr_tasks', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'dropoff_code' - 'pickup_address' - 'pickup_lat' - 'pickup_lng'
      - 'dropoff_address' - 'dropoff_lat' - 'dropoff_lng' - 'customer_id' - 'pickup_contact_id' - 'close_note'), '[]'::jsonb) FROM public.helpr_tasks t
      WHERE t.helpr_id = v_uid));
  v_out := v_out || jsonb_build_object('helpr_task_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helpr_task_events t
      WHERE t.actor_id = v_uid));
  v_out := v_out || jsonb_build_object('helpr_task_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_transfer_id' - 'last_error'), '[]'::jsonb) FROM public.helpr_task_payouts t
      WHERE t.helpr_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_delivery_dropoffs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_delivery_dropoffs t
      WHERE t.buyer_id = v_uid));

  -- Shops slice 1 (20261017061155) and slice 2 (20261017061157): the
  -- member's own shop (who checked its registration and who hid it are staff
  -- ids, dropped; the hide reason is about them and stays), photo paths, the shops they follow, their items and item photos, the item
  -- review state (the AI and word-check reasons are staff-only, dropped; the
  -- admin's note stays), the confirmations they ticked, and the home-food
  -- yearly confirmations and counted sales. Opening hours (shop_hours) carry
  -- no person column and are public on the shop page, so they stay out, as
  -- every table without one does.
  v_out := v_out || jsonb_build_object('shops', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'sos_verified_by' - 'hidden_by'), '[]'::jsonb) FROM public.shops t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_photos t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_follows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_follows t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_items t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason' - 'text_flag_reason'), '[]'::jsonb) FROM public.shop_item_private t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_item_photos t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_item_attestations t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_cottage_confirmations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_cottage_confirmations t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_cottage_sales', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_cottage_sales t
      WHERE t.owner_id = v_uid));

  -- Rentals S1 (20261017205605): the caller's properties, units, tenancies
  -- (as landlord or tenant), maintenance requests and their photos.
  v_out := v_out || jsonb_build_object('rental_properties', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ownership_reviewed_by'), '[]'::jsonb) FROM public.rental_properties t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_units', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_units t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_tenancies', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'invite_token_sha256'), '[]'::jsonb) FROM public.rental_tenancies t
      WHERE t.landlord_id = v_uid OR t.tenant_id = v_uid));
  v_out := v_out || jsonb_build_object('maintenance_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.maintenance_requests t
      WHERE t.tenant_id = v_uid OR t.landlord_id = v_uid));
  v_out := v_out || jsonb_build_object('maintenance_request_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.maintenance_request_photos t
      WHERE t.tenant_id = v_uid));

  -- Shops M1 (20261018164442): the member's orders as buyer or as the shop
  -- (both sides were shown the whole order: lines, date, note, money), and
  -- the lines of those orders. The Stripe ids and the capture / hold-release
  -- error text are internal, dropped.
  v_out := v_out || jsonb_build_object('shop_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id' - 'capture_last_error' - 'hold_release_last_error'), '[]'::jsonb) FROM public.shop_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_order_lines', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_order_lines t
      WHERE t.order_id IN (SELECT o.id FROM public.shop_orders o WHERE o.buyer_id = v_uid OR o.seller_id = v_uid)));
  -- The member's Shops strikes (20261018164444; the staff member who removed
  -- one is dropped, as for declutter_strikes). That migration sorts AFTER this
  -- one, so the section is skipped until the table exists: Download My Data
  -- never fails with 42P01 in between (both reviews of the strikes change).
  IF to_regclass('public.shop_strikes') IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('shop_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by'), '[]'::jsonb) FROM public.shop_strikes t
      WHERE t.user_id = v_uid));
  END IF;
  -- Shops M1b part 2 (20261018210400): the member's own shop's private pickup
  -- address. The Stripe Tax location id and its mode are internal, dropped.
  -- Only the owner's own row: a buyer was shown the address on an accepted
  -- order, but it is the shop owner's personal data, not the buyer's.
  v_out := v_out || jsonb_build_object('shop_pickup_addresses', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_tax_location_id' - 'stripe_tax_location_mode'), '[]'::jsonb) FROM public.shop_pickup_addresses t
      WHERE t.owner_id = v_uid));
  -- Homes -> Rent listings (20261019043000): the member's own listings (every
  -- field they typed, incl. the wording-check result) and their photos.
  v_out := v_out || jsonb_build_object('rental_listings', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_listings t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_listing_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_listing_photos t
      WHERE t.owner_id = v_uid));
  -- Q2082 (b): the Helpr's own Helpr-fault rulings (20261019015301), without
  -- the staff member who ruled (admin_id) or the poster's Stripe refund id
  -- (refund_ref, the other party's payment). The ruling's note IS theirs
  -- (why they were ruled at fault), so it is exported. The table exists from that
  -- migration on, which always runs first.
  v_out := v_out || jsonb_build_object('helpr_fault_rulings', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id' - 'refund_ref'), '[]'::jsonb) FROM public.job_helpr_fault_rulings t
    WHERE t.helper_id = v_uid));
  -- Landlord ID (20261019051407): the member's own ID review (status, dates,
  -- the admin's note). Which admin reviewed it (reviewed_by) is staff-only and
  -- dropped. The photo paths stay in the row: the export function signs every
  -- object still in the member's user-documents folder, so a photo not yet
  -- past retention comes as a signed link, never as bytes in this JSON.
  v_out := v_out || jsonb_build_object('landlord_id_reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reviewed_by'), '[]'::jsonb) FROM public.landlord_id_reviews t
    WHERE t.user_id = v_uid));
  -- Homes rent tracker (20261019073106) and deposit tracker (20261019082216): the rent schedule, charges,
  -- payments and deposit of every tenancy the member is a side of (landlord or tenant). These tables are keyed
  -- by tenancy, not by a person. The landlord gets the tenant's forwarding address only once the tenancy has
  -- ended AND the tenant ended it or the lease end date passed (the same rule as rentals_deposit).
  v_out := v_out || jsonb_build_object('rental_rent_plans', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_rent_plans t
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  v_out := v_out || jsonb_build_object('rental_rent_charges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_rent_charges t
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  v_out := v_out || jsonb_build_object('rental_rent_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_rent_payments t
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  v_out := v_out || jsonb_build_object('rental_deposits', (SELECT coalesce(jsonb_agg(
      CASE WHEN x.tenant_id = v_uid
                OR (x.status = 'ended' AND (x.ended_by = 'tenant' OR (x.lease_ends_on IS NOT NULL AND x.lease_ends_on <= public.shop_local_today())))
           THEN to_jsonb(t) ELSE to_jsonb(t) - 'forwarding_address' END), '[]'::jsonb)
      FROM public.rental_deposits t JOIN public.rental_tenancies x ON x.id = t.tenancy_id
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  -- Homes lease (20261019110137): every lease the member is a party to (landlord_id / tenant_id are kept on
  -- the lease, so a signed one is exported after its tenancy or the other account is gone). A draft's blanks
  -- go to the landlord only; the tenant gets the draft's status and their own change note.
  v_out := v_out || jsonb_build_object('rental_leases', (SELECT coalesce(jsonb_agg(
      CASE WHEN t.landlord_id = v_uid OR t.status <> 'draft' THEN to_jsonb(t)
           ELSE jsonb_build_object('tenancy_id', t.tenancy_id, 'status', t.status, 'change_request', t.change_request) END), '[]'::jsonb)
      FROM public.rental_leases t
    WHERE t.landlord_id = v_uid OR t.tenant_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_homes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_homes t
      WHERE t.user_id = v_uid));
  -- Board 143a (20261021030052): the member's own bank payout failures (user_id = the member).
  v_out := v_out || jsonb_build_object('payout_failures', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.payout_failures t
      WHERE t.user_id = v_uid));
  -- Board 141 (20261021102943): every refund request the member asked, was asked, or answered.
  v_out := v_out || jsonb_build_object('refund_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.refund_requests t
      WHERE t.requester_id = v_uid OR t.responder_id = v_uid OR t.answered_by = v_uid));
  -- SMS alerts (20261021193738): the member's text consent (number, opt-in and
  -- opt-out times and sources), every consent event, and every text considered
  -- for them (kind, status, reason, times; no phone or body is stored there).
  -- confirm_* and updated_at are left out for the same reason: they move
  -- only when a confirmation was really sent, which a number in use
  -- elsewhere never is (and confirm_code is a live secret).
  v_out := v_out || jsonb_build_object('sms_consent', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'confirm_code' - 'confirm_phone' - 'confirm_sent_at' - 'updated_at'), '[]'::jsonb) FROM public.sms_consent t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('sms_consent_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.sms_consent_events t
      WHERE t.user_id = v_uid));
  -- A confirmation row keeps only that one was considered: its status and
  -- reason would say whether the number is used on another account
  -- (lh-authz-rls review of the SMS slice).
  v_out := v_out || jsonb_build_object('sms_messages', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.kind = 'confirm' THEN jsonb_build_object('id', t.id, 'kind', t.kind, 'category', t.category, 'created_at', t.created_at)
             ELSE to_jsonb(t) END), '[]'::jsonb) FROM public.sms_messages t
      WHERE t.user_id = v_uid));
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
