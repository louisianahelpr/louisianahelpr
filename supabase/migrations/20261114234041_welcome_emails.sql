-- Welcome emails (owner 11-14, "Yes do that"): two emails to a new member,
-- day 1 and day 3 after sign-up, each with up to three open jobs and three
-- things for sale near them.
--
-- WHY. Measured on prod 2026-11-14 (read-only, members who joined in the last
-- 14 days): 37 real new members; 25 opened the app, 18 of them only ever saw
-- Home, 0 posted anything, and 8 came back after day 1. The old welcome drip
-- (engagement-automations, day 1 "here's where to start", day 3 Declutter
-- intro) told them what the app is; these show them what is open near them.
--
-- WHAT THIS ADDS (every layer):
--   * public.welcome_email_sends: ONE row per member per email (primary key
--     (user_id, email_step), step 1 or 3). The row is the claim: it is written
--     (claimed_at) before the email is queued, so a retry or two overlapping
--     runs can never mail a member the same step twice, and the CHECK makes a
--     third welcome email impossible. The sender (welcome-emails) stamps
--     queued_at and message_id once the email is queued, and stamps
--     profiles.last_drip_at, so the come-back emails and the day 7 drip email
--     keep their one-commercial-email-a-day rule. A claim left without
--     queued_at for 2 hours is reported by the sender as a defect.
--     service_role only. Deleted with the account (ON DELETE CASCADE).
--   * claim_welcome_emails(step, limit): picks the due members and inserts
--     their rows in ONE statement (INSERT ... ON CONFLICT DO NOTHING
--     RETURNING), returning only the rows it inserted, with what the email
--     needs: address, name, language (profiles.language, 'es' = Spanish) and
--     the member's saved position (profiles.latitude/longitude) for "near
--     you". service_role only.
--   * cron job welcome-emails: twice a day (15:17 and 21:17 UTC; 9:17 AM and
--     3:17 PM CST), calls the welcome-emails edge function. It runs before
--     come-back-emails (15:41, 21:41), so a member due both gets the welcome
--     and the come-back note waits a day (last_drip_at, 20 hours).
--
-- NO SWITCH. The owner's rule is that fixes ship ON for everyone with no
-- testers switch, and the owner said "Yes do that" to this on 11-14. Who is
-- mailed is decided per member below.
--
-- WHO IS PICKED (both steps), the same consent rule every commercial email
-- uses since Q2299 (owner 2026-10-21, 20261021135832), unchanged:
--   * a member with a confirmed email (profiles.email_verified, and the login
--     record auth.users confirmed that same address); not deleted, anonymous
--     or banned in auth.users; profile not anonymised, not is_seed,
--     ban_status 'active', not auto-suspended, no active user_bans row, not in
--     public.test_accounts;
--   * profiles.marketing_consent (the sign-up box) is on, and
--     notification_preferences.email_promotions is not an explicit false
--     (NULL = never chosen, the sign-up box decides) and email_enabled (the
--     Email master) is not false; a missing preferences row reads as on;
--   * the address is not on public.suppressed_emails, not a fixture
--     (is_fixture_email) and not a reserved test domain;
--   * no other commercial email in the last 20 hours: profiles.last_drip_at
--     (the drip, the win-back, and these emails stamp it), and no come-back
--     email claimed in the last 20 hours (come_back_email_sends.claimed_at);
--   * step 1: signed up between 1 and 3 days ago; step 3: between 3 and 7
--     days ago. The windows end, so turning this on never mails someone who
--     signed up weeks ago, and the day 7 drip email (engagement-automations)
--     starts where step 3's window ends;
--   * the old drip has not already sent its own email for that day
--     (profiles.drip_step below 1 for step 1, below 2 for step 3), so a member
--     who got the old day 1 or day 3 email before this shipped never gets a
--     second one for the same day.
--
-- Proof: src/test/pglite/welcomeEmails.pglite.mjs (this migration 3x on
-- prod-shaped stubs; RED with NEW_MIGRATION=skip). Sender:
-- src/test/edge/welcome-emails.test.ts. Shape and copy:
-- src/test/welcomeEmails.test.ts.
--
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, the cron step
-- skipped where pg_cron does not exist and cron.schedule upserts by name;
-- grants restated by role name.

CREATE TABLE IF NOT EXISTS public.welcome_email_sends (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  email_step smallint NOT NULL CHECK (email_step IN (1, 3)),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  message_id text,
  CONSTRAINT welcome_email_sends_pkey PRIMARY KEY (user_id, email_step)
);

COMMENT ON TABLE public.welcome_email_sends IS
  'One row per welcome email per member (step 1 a day after sign-up, step 3 about day 3), written by claim_welcome_emails() BEFORE the email is queued (claimed_at), so no member gets the same step twice; queued_at and message_id are stamped by welcome-emails once the email is queued. service_role only.';

ALTER TABLE public.welcome_email_sends ENABLE ROW LEVEL SECURITY;
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
-- No policy on purpose: no client role is granted anything.
REVOKE ALL ON TABLE public.welcome_email_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.welcome_email_sends TO service_role;

-- ── Claim: the row is written before the email is queued ──────────────────
CREATE OR REPLACE FUNCTION public.claim_welcome_emails(p_step integer, p_limit integer DEFAULT 25)
RETURNS TABLE (user_id uuid, email text, full_name text, language text, latitude double precision, longitude double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
BEGIN
  IF p_step IS NULL OR p_step NOT IN (1, 3) THEN
    RAISE EXCEPTION 'invalid_step' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT p.user_id AS uid, p.email AS addr, p.full_name AS name, p.language::text AS lang,
           p.latitude::double precision AS lat, p.longitude::double precision AS lng
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.user_id
     WHERE p.email IS NOT NULL
       AND p.email_verified IS TRUE
       AND p.marketing_consent IS TRUE
       AND p.is_seed IS NOT TRUE
       AND p.anonymized_at IS NULL
       AND p.ban_status = 'active'
       AND (p.auto_suspended_until IS NULL OR p.auto_suspended_until <= now())
       AND u.deleted_at IS NULL
       -- The address mailed is the one the login record confirmed.
       AND u.email_confirmed_at IS NOT NULL
       AND lower(u.email) = lower(p.email)
       AND u.is_anonymous IS NOT TRUE
       AND (u.banned_until IS NULL OR u.banned_until <= now())
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.user_bans b
          WHERE b.user_id = p.user_id AND b.is_active IS TRUE
            AND (b.expires_at IS NULL OR b.expires_at > now()))
       -- Q2299: only an explicit Promotions-off (or the Email master off) stops it.
       AND NOT EXISTS (
         SELECT 1 FROM public.notification_preferences np
          WHERE np.user_id = p.user_id
            AND (np.email_promotions IS FALSE OR np.email_enabled IS FALSE))
       AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails s WHERE lower(s.email) = lower(p.email))
       AND NOT public.is_fixture_email(p.email)
       AND lower(p.email) !~ '@([a-z0-9-]+\.)*(example\.(com|net|org)|[a-z0-9-]+\.(test|example|invalid|localhost)|test|example|invalid|localhost)$'
       -- One commercial email a day.
       AND (p.last_drip_at IS NULL OR p.last_drip_at < now() - interval '20 hours')
       AND NOT EXISTS (
         SELECT 1 FROM public.come_back_email_sends c
          WHERE c.user_id = p.user_id AND c.claimed_at >= now() - interval '20 hours')
       -- The step's own window, and the old drip has not sent its email for that day.
       AND (
         (p_step = 1
           AND p.created_at <= now() - interval '1 day'
           AND p.created_at > now() - interval '3 days'
           AND coalesce(p.drip_step, 0) < 1)
         OR
         (p_step = 3
           AND p.created_at <= now() - interval '3 days'
           AND p.created_at > now() - interval '7 days'
           AND coalesce(p.drip_step, 0) < 2)
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.welcome_email_sends w WHERE w.user_id = p.user_id AND w.email_step = p_step)
     ORDER BY p.created_at
     LIMIT v_limit
  ),
  claimed AS (
    -- Two overlapping runs: the second's insert waits on the first's row and
    -- then does nothing, so it returns no row and mails no one.
    INSERT INTO public.welcome_email_sends AS w (user_id, email_step)
    SELECT due.uid, p_step::smallint FROM due
    ON CONFLICT ON CONSTRAINT welcome_email_sends_pkey DO NOTHING
    RETURNING w.user_id
  )
  SELECT due.uid, due.addr, due.name, due.lang, due.lat, due.lng
    FROM due
    JOIN claimed ON claimed.user_id = due.uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_welcome_emails(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_welcome_emails(integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_welcome_emails(integer, integer) IS
  'Welcome emails: claims up to p_limit members due for step p_step (1 = a day after sign-up, 3 = about day 3) by inserting their welcome_email_sends row, and returns only the rows it inserted, with address, name, language and saved position. Consent as every commercial email (Q2299). service_role only.';

-- ── Schedule + liveness registry ──────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('welcome-emails', interval '20 hours',
            'Owner 11-14: twice a day (15:17 and 21:17 UTC) sends the welcome emails (a day after sign-up and about day 3, each with jobs and items near the member). 20 hours: the overnight gap 21:17 -> 15:17 is 18 hours.',
            'exempt',
            'No member due is the healthy state on most runs, so a run that sends nothing is not a silent failure. A run that could not claim (PGRST202 included) or queue, or that finds a claim left unqueued for 2 hours, answers 500 through cronResult.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('welcome-emails', '17 15,21 * * *', $c$SELECT public.cron_http_tag(q.request_id, 'welcome-emails')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/welcome-emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;
