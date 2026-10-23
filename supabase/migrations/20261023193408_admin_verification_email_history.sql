-- An admin can see when the last verify-your-email message went to a member
-- who has not confirmed their address, and how many have gone (owner
-- 2026-10-23: "add a button or something for admin to see when the last
-- reminder to verify their email went out? or give us a button to push to
-- send another follow up email").
--
-- Before: the admin Emails tab showed profiles.verification_email_count and
-- last_verification_email_at, which only admin-resend-verification ever
-- writes. The real record is email_send_log: auth-email-hook logs every
-- signup confirmation it renders as template 'signup' (the first one at sign
-- up, the member's own "resend" on the Check Your Email screen, and an
-- admin's), 190 sent in the 30 days to 2026-10-23 on prod. So a member who
-- had three emails showed "0 / 3", and the "/ 3" was never enforced anywhere.
--
-- Now verification_email_history(p_user) reads that record: how many were
-- sent, when the last one went, the last attempt's status, and when the next
-- one may go (one hour after the last one sent or queued: a reminder is never
-- stacked on one still on its way). admin-resend-verification asks it before
-- it sends and refuses with the wait. The admin Emails tab already reads
-- email_send_log's per-template totals (template 'signup'), and now shows
-- those instead of the admin-only profile counter.
--
-- Read-only: neither function writes. Replay-safe: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.verification_email_history(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_email text;
  v_verified boolean;
  v_sent integer;
  v_last_sent timestamptz;
  v_last_at timestamptz;
  v_last_status text;
  v_gap interval := interval '1 hour';
BEGIN
  SELECT lower(p.email), COALESCE(p.email_verified, false) INTO v_email, v_verified
    FROM public.profiles p WHERE p.user_id = p_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT count(*) FILTER (WHERE l.status = 'sent'), max(l.created_at) FILTER (WHERE l.status = 'sent')
    INTO v_sent, v_last_sent
    FROM public.email_send_log l
   WHERE l.template_name = 'signup' AND lower(l.recipient_email) = v_email;
  SELECT l.created_at, l.status INTO v_last_at, v_last_status
    FROM public.email_send_log l
   WHERE l.template_name = 'signup' AND lower(l.recipient_email) = v_email
   ORDER BY l.created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'found', true,
    'email_verified', v_verified,
    'sent_count', COALESCE(v_sent, 0),
    'last_sent_at', v_last_sent,
    'last_attempt_at', v_last_at,
    'last_status', v_last_status,
    'next_allowed_at', CASE
      WHEN v_last_at IS NULL THEN NULL
      WHEN v_last_status IN ('sent', 'pending') AND v_last_at + v_gap > now() THEN v_last_at + v_gap
      ELSE NULL END
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.verification_email_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verification_email_history(uuid) TO service_role;
