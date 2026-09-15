-- Contact scanner: a 14-digit number is not a phone number, and a saved
-- message is never called "blocked" (docs/OPEN.md queue #1, 2026-09-14).
--
-- WHAT WAS BROKEN
--
-- 1. contact_leak_reason(text)'s phone rule was an unanchored
--    `[0-9]{3}sep[0-9]{3}sep[0-9]{4}` window, so it matched INSIDE any run of
--    10 or more digits. During the offered-Helpr prod proof a message
--    "SEED offered-proof 20260914215014" (a migration timestamp) was read as a
--    phone number: flagged_hidden, a fraud_flags row, a user_violations
--    warning and a notification, on two accounts. Order numbers, reference
--    ids, epoch timestamps and card-shaped test numbers all had the same
--    exposure, in messages, applications, job posts and bios alike, since all
--    four go through this one function.
--
--    The rule is now: 10 digits, or 11 starting with 1 (+1), with up to four
--    separator characters between groups, and NO digit directly before or
--    after; OR a 3-3-4 shape whose both gaps are real separators, where a
--    glued digit on either end does not hide it ("0225 555 0199"; review nit,
--    lh-trust-safety 2026-09-14). A bare digit run only ever matches the
--    first form. Both are subsets of the old rule: nothing newly flagged,
--    nothing newly rejected. Every other branch is byte-for-byte the live body read via
--    pg_get_functiondef on 2026-09-14. The pattern is the exact string of
--    PHONE_PATTERN in src/lib/contactLeakRules.ts, which the client scanner
--    uses; src/lib/contactFilterParity.test.ts fails if they differ and runs
--    src/lib/contactLeakPhoneFixtures.json through both, and
--    scripts/probes/contact-scan-phone.probe.mjs runs the same fixtures
--    through this function in Postgres. No lookbehind, so the identical
--    string also parses on iOS 15 WebKit.
--
-- 2. The ladder copy said "That message was blocked" on BOTH paths that reach
--    it, but only one of them blocks:
--      - the app's scanner refuses the send and calls
--        apply_message_violation_consequence: the message is never saved, so
--        "blocked" is true;
--      - anything the app did not stop (a direct API insert, an edit) is SAVED
--        (201) and hidden from the recipient by scan_message_content, then
--        apply_message_scan_consequence runs the same ladder: "blocked" is
--        false, the sender can still see the message in their own thread.
--    The ladder body moves into message_violation_ladder(..., p_message_saved)
--    with the rungs, dedupe and policy unchanged. The public RPC passes false
--    and keeps its exact copy; the AFTER INSERT/UPDATE trigger passes true and
--    gets copy that says the message was hidden from the other person.
--    message_violation_ladder is internal: no anon/authenticated EXECUTE, so a
--    client cannot pick its own copy.
--
-- 3. apply_message_violation_consequence struck whatever the CLIENT sent it,
--    with no server check. Installed native apps bundle their scanner, so the
--    old broad rule keeps refusing "…20260914215014" there and would keep
--    striking through this RPC; the client-only "my number" / "my email"
--    warnings struck too. It now strikes only when contact_leak_reason flags
--    the same text, and otherwise returns {"action":"not_flagged"}.
--
-- 4. scan_message_content set flagged_hidden but never cleared it, so an edit
--    that removed the phone number stayed hidden AND the on-edit consequence
--    trigger struck the sender again for the clean text. It now clears on a
--    clean scan, as scan_application_contact_info already does.
--
-- Left alone on purpose: the admin "Ban review needed" wording ("%s has %s
-- blocked messages on file") counts both paths; admin-facing, not changed here.
--
-- REPLAY-SAFETY: CREATE OR REPLACE throughout, same signatures as live for the
-- four existing functions (grants restated to match live proacl), no
-- DDL on tables. plpgsql bodies resolve tables and auth.uid() at call time, so
-- this applies on a database of any age, any number of times.

CREATE OR REPLACE FUNCTION public.contact_leak_reason(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN NULL;
  END IF;

  v_norm := translate(p_text, '０１２３４５６７８９', '0123456789');

  IF v_norm ~* '(^|[^0-9])(1[^0-9a-zA-Z]{0,4})?[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}(?![0-9])|[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{4}' THEN
    RETURN 'Phone number detected';
  ELSIF p_text ~* '(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}' THEN
    RETURN 'Phone number detected';
  ELSIF p_text ~* '[a-z0-9._]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}' THEN
    RETURN 'Email address detected';
  ELSIF p_text ~* '\mvenmo\M|\mcashapp\M|\mcash app\M|\mzelle\M|\mpaypal\M|\mapple\s*pay\M|\mgoogle\s*pay\M|\mcrypto\M|\mbitcoin\M|\mbtc\M|\meth\M' THEN
    RETURN 'Off-platform payment service mentioned';
  ELSIF p_text ~* '\mpay me direct\M|\moff the app\M|\moutside the app\M|\mskip the fee\M|\mavoid the fee\M|\mcash only\M|\min cash\M|\mtext me\M|\mcall me\M|\mwhatsapp\M|\mtelegram\M|\mdm me\M|\mhit me up\M|\mcontact me at\M|\mreach me at\M|\msend money to\M|\mpay outside\M' THEN
    RETURN 'Off-platform payment intent detected';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_leak_reason(text) TO authenticated, service_role;

-- The BEFORE INSERT / BEFORE UPDATE OF content trigger on messages. Live body
-- (pg_get_functiondef, 2026-09-14) plus the ELSE branch, copied from
-- scan_application_contact_info: an edit that makes the text clean clears the
-- flag. Before, the flag stuck, the sender's corrected message stayed hidden,
-- and messages_scan_consequence_on_edit (WHEN new.flagged_hidden AND content
-- changed) struck them a second time for the clean text. Only this scanner
-- ever sets messages.flagged_hidden (checked live: no other function writes
-- it), so clearing it cannot undo some other kind of hide.
CREATE OR REPLACE FUNCTION public.scan_message_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text := public.contact_leak_reason(NEW.content);
BEGIN
  IF v_reason IS NOT NULL THEN
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;
  ELSE
    NEW.flagged_hidden := false;
    NEW.flag_reason := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- The message-violation ladder, unchanged in rungs, dedupe and policy; only the
-- user-facing copy depends on whether the offending message was saved.
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
    p_admin_message_format      => '%s has %s blocked messages on file and is restricted for 7 days pending your decision.',
    p_ban_reason                => null
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.message_violation_ladder(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_violation_ladder(text, text, boolean) TO service_role;

-- The client RPC (src/pages/messages/logViolation.ts): called only after the
-- app's scanner refused the send, so the message was never saved.
--
-- It strikes ONLY when the server rule flags the same text. The client decides
-- nothing: installed native apps carry the scanner they were built with (the
-- old rule still refuses "…20260914215014" and calls this), and the client
-- warns on "my number" / "my email", which the server deliberately does not
-- act on (F-TRUST-01). Either used to earn a real strike through this RPC.
CREATE OR REPLACE FUNCTION public.apply_message_violation_consequence(p_description text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF public.contact_leak_reason(p_content) IS NULL THEN
    -- Not a server violation: record nothing, notify nothing. logViolation
    -- shows no toast for an action it does not know.
    RETURN jsonb_build_object('action', 'not_flagged');
  END IF;

  RETURN public.message_violation_ladder(p_description, p_content, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_message_violation_consequence(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_message_violation_consequence(text, text) TO authenticated, service_role;

-- The AFTER INSERT / AFTER UPDATE OF content trigger on messages (fires only
-- WHEN new.flagged_hidden): the row was saved and hidden, so the ladder is told
-- so. Otherwise identical to the live body (pg_get_functiondef, 2026-09-14).
CREATE OR REPLACE FUNCTION public.apply_message_scan_consequence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text := COALESCE(NEW.flag_reason, 'Off-platform contact detected');
  v_result jsonb;
BEGIN
  -- Evidence trail, unchanged in shape and column set so anything already
  -- reading fraud_flags keeps working.
  INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
  VALUES (NEW.sender_id, 'off_platform_contact',
    v_reason || ' — message: ' || left(NEW.content, 200),
    NEW.job_id);

  -- The ladder acts on auth.uid(), and the messages INSERT policy already
  -- guarantees auth.uid() = sender_id. Re-checked rather than assumed: a
  -- service-role or console write records the evidence and escalates NOBODY.
  IF auth.uid() IS NULL OR auth.uid() <> NEW.sender_id THEN
    RETURN NULL;
  END IF;

  v_result := public.message_violation_ladder(v_reason, NEW.content, true);

  -- The ladder speaks for itself on a first, second or third strike. It stays
  -- silent only on 'duplicate' (this exact message inside 24h), so cover that
  -- one case here. Exactly one notification per hidden message, either way.
  IF v_result->>'action' = 'duplicate' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.sender_id, 'Message hidden',
      'Your message was hidden because it looked like off-platform contact or payment info. Keep payments and contact on Helpr — repeated attempts can lead to a temporary restriction.',
      'warning', '/profile?tab=warnings');
  END IF;

  RETURN NULL;  -- AFTER trigger: the return value is ignored.
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_message_scan_consequence() FROM PUBLIC, anon, authenticated;
