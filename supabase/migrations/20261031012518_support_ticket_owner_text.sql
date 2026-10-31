-- The owner gets a text when someone writes to support (owner 10-30: "You will have to text me if someone messages in
-- support, I don't keep it open all day").
--
-- Support arrives four ways, and all four pass here: a member's /support message (contact-support inserts a reports
-- row), a member's Profile support tab (the client inserts one), a guest's message (contact-support, no reporter), and a
-- member's reply in their Louisiana Helpr Team thread (a messages row, sender = team_thread_user_id).
--
-- The text is fixed words and a link (smsPolicy.ts ownerSupportText): nothing anyone typed, no name. The link is the
-- Support inbox; for a Team thread reply it is that thread, the only place the reply shows (lead 10-30), so it holds the
-- member's id.
-- At most one per conversation per 15 minutes. A guest comes from an open endpoint and can type any address, so there
-- is also a cap across all conversations: 12 an hour, the first text past it logged once. Above that the bell still rings.
-- A test or seed sender texts nobody, and neither does an admin writing in themselves. A guest who typed a fixture
-- address files no row (contact-support), and is refused here again. A failure is logged and never fails the message.
--
-- This goes around sms_consent on purpose: the owner asked for these, and the member opt-in rules are about members'
-- texts. sms_claim_owner_support finds the number: OWNER_ALERT_PHONE when that secret is set, else the one number the
-- real admins share (measured 10-30: 2 real admins, 1 number). No number, or more than one, sends nothing and is logged.
-- Proof: src/test/pglite/supportOwnerText.pglite.mjs.

-- The throttle lives outside public on purpose. Every public table carries the unconfirmed-email gate, and the owner's
-- text must not depend on the sender's email being confirmed (lead 10-30). Only this trigger's definer reads or writes
-- it: no client role has the schema or the table, and PostgREST does not expose the schema.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.support_text_throttle (
  conversation_key text PRIMARY KEY,
  last_sent_at timestamptz NOT NULL
);
ALTER TABLE private.support_text_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.support_text_throttle FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_owner_support_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sender uuid;
  v_guest text;
  v_key text;
  v_claimed text;
  v_thread uuid;
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'reports' THEN
      v_sender := NEW.reporter_id;
      IF v_sender IS NULL THEN
        -- The last line of a guest's ticket (_shared/supportGuest.ts), always written after what the guest typed.
        v_guest := lower(substring(COALESCE(NEW.description, '') FROM '<([^[:space:]@<>]+@[^[:space:]@<>]+)>$'));
      END IF;
    ELSE
      v_sender := NEW.sender_id;
      v_thread := NEW.team_thread_user_id;
    END IF;

    IF v_sender IS NOT NULL AND (
         public.is_test_subject(v_sender)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_sender AND p.is_seed IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = v_sender AND r.role = 'admin')
       ) THEN
      RETURN NULL;
    END IF;
    IF v_guest IS NOT NULL AND (
         public.is_fixture_email(v_guest)
         OR v_guest ~ '@(example\.(com|org|net)|[^@]*\.(test|invalid|example|localhost))$'
       ) THEN
      RETURN NULL;
    END IF;

    -- Only a hash of a guest's address is kept.
    v_key := CASE WHEN v_sender IS NOT NULL THEN 'member:' || v_sender::text ELSE 'guest:' || md5(COALESCE(v_guest, 'unknown')) END;

    DELETE FROM private.support_text_throttle WHERE last_sent_at < now() - interval '1 day';

    IF (SELECT count(*) FROM private.support_text_throttle WHERE last_sent_at > now() - interval '1 hour') >= 12 THEN
      IF NOT EXISTS (SELECT 1 FROM public.error_logs e
                      WHERE e.tags->>'source' = 'notify_owner_support_text' AND e.message = 'support text cap reached'
                        AND coalesce(e.tags->>'origin', '') <> 'client'
                        AND e.created_at > now() - interval '1 hour') THEN
        INSERT INTO public.error_logs (severity, message, tags, context)
        VALUES ('warning', 'support text cap reached', jsonb_build_object('source', 'notify_owner_support_text'), '{}'::jsonb);
      END IF;
      RETURN NULL;
    END IF;

    INSERT INTO private.support_text_throttle AS t (conversation_key, last_sent_at)
    VALUES (v_key, now())
    ON CONFLICT (conversation_key) DO UPDATE SET last_sent_at = now()
      WHERE t.last_sent_at <= now() - interval '15 minutes'
    RETURNING t.conversation_key INTO v_claimed;
    IF v_claimed IS NULL THEN
      RETURN NULL;
    END IF;

    PERFORM public.sms_post_to_edge(jsonb_strip_nulls(jsonb_build_object('owner_support_text', true, 'team_thread_user_id', v_thread)));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'support text could not be queued',
            jsonb_build_object('source', 'notify_owner_support_text'),
            jsonb_build_object('sqlstate', SQLSTATE, 'error', SQLERRM));
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_owner_support_text() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reports_zz_support_owner_text ON public.reports;
CREATE TRIGGER trg_reports_zz_support_owner_text
  AFTER INSERT ON public.reports
  FOR EACH ROW
  WHEN (NEW.reported_type = 'support')
  EXECUTE FUNCTION public.notify_owner_support_text();

DROP TRIGGER IF EXISTS trg_messages_zz_support_owner_text ON public.messages;
CREATE TRIGGER trg_messages_zz_support_owner_text
  AFTER INSERT ON public.messages
  FOR EACH ROW
  WHEN (NEW.team_thread_user_id IS NOT NULL AND NEW.sender_id = NEW.team_thread_user_id)
  EXECUTE FUNCTION public.notify_owner_support_text();

-- send-sms-notification's one claim for this text. p_phone is OWNER_ALERT_PHONE when that secret is set.
CREATE OR REPLACE FUNCTION public.sms_claim_owner_support(p_provider_ready boolean, p_phone text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid;
  v_phone text := public.sms_normalize_phone(p_phone);
  v_numbers integer;
  v_id uuid;
  v_reason text;
BEGIN
  WITH real_admins AS (
    SELECT DISTINCT r.user_id, public.sms_normalize_phone(p.phone) AS phone
      FROM public.user_roles r
      JOIN public.profiles p ON p.user_id = r.user_id
     WHERE r.role = 'admin' AND p.is_seed IS NOT TRUE AND NOT public.is_test_subject(r.user_id)
  )
  SELECT (array_agg(user_id ORDER BY user_id))[1], count(DISTINCT phone),
         CASE WHEN count(DISTINCT phone) = 1 THEN min(phone) END
    INTO v_user, v_numbers, v_reason
    FROM real_admins;

  v_phone := COALESCE(v_phone, v_reason);
  v_reason := CASE WHEN v_user IS NULL THEN 'no_admin'
                   WHEN v_phone IS NULL THEN 'no_owner_phone'
                   WHEN p_provider_ready IS NOT TRUE THEN 'twilio_not_configured' END;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'support text not sent: ' || v_reason,
            jsonb_build_object('source', 'sms_claim_owner_support'),
            jsonb_build_object('admin_numbers', v_numbers));
    IF v_user IS NOT NULL THEN
      INSERT INTO public.sms_messages (user_id, category, kind, status, reason)
      VALUES (v_user, 'support', 'support_alert', 'skipped', v_reason);
    END IF;
    RETURN jsonb_build_object('action', 'skip', 'reason', v_reason);
  END IF;

  INSERT INTO public.sms_messages (user_id, category, kind, status)
  VALUES (v_user, 'support', 'support_alert', 'queued')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('action', 'send', 'sms_id', v_id, 'phone', v_phone);
END;
$function$;

REVOKE ALL ON FUNCTION public.sms_claim_owner_support(boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_claim_owner_support(boolean, text) TO service_role;
