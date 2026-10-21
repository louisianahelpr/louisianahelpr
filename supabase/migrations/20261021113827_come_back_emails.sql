-- Come-back emails (owner said yes, 2026-10-21): a short note from the founder
-- to a member who signed up and never came back. One about day 3, one more
-- about day 10, never more than two per member, ever.
--
-- WHY. Measured on prod 2026-10-21 (read-only): of 35 real members with a
-- confirmed email, 19 were last active within a day of signing up. Nothing
-- writes to them after that.
--
-- WHAT THIS ADDS (every layer):
--   * the hidden switch 'come_back_emails', created OFF. The send decision is
--     public.feature_enabled_for_user('come_back_emails', member) for EACH
--     member, inside the claim below, so: off = nobody is mailed; testers =
--     admins only (test accounts are excluded by the rules below anyway);
--     everyone = every member the rules pick. Going live is the owner's
--     audited flip in Admin -> Settings -> Hidden Feature Switches.
--   * public.come_back_email_sends: ONE row per member per email (primary key
--     (user_id, email_step), step 1 or 2). The row is the claim: it is written
--     (claimed_at) before the email is queued, so a retry or two overlapping
--     runs can never mail a member the same step twice, and the CHECK makes a
--     third email impossible. The sender stamps queued_at and message_id once
--     the email is queued; a claim left without queued_at for 2 hours is
--     reported by the sender as a defect (lh-silent-failure review). Step 2
--     needs step 1's queued_at, so a step 1 that never went out never gets a
--     "last note". service_role only. Deleted with the account (ON DELETE
--     CASCADE on auth.users).
--   * claim_come_back_emails(step, limit): picks the due members and inserts
--     their rows in ONE statement (INSERT ... ON CONFLICT DO NOTHING
--     RETURNING), returning only the rows it inserted. service_role only.
--   * cron job come-back-emails: twice a day (15:41 and 21:41 UTC; 10:41 AM
--     and 4:41 PM CDT), calls the come-back-emails edge function, which claims
--     step 1 then step 2 and queues each email through enqueue_email with the
--     member's signed one-click unsubscribe (email-unsubscribe turns
--     marketing_consent and email_promotions off, which these rules read).
--
-- WHO IS PICKED (both steps):
--   * a member with a confirmed email (profiles.email_verified, and the login
--     record auth.users confirmed that same address), an auth user
--     that is not deleted, anonymous, or banned (auth.users.banned_until), a
--     profile that is not anonymised, not is_seed, ban_status 'active', not
--     auto-suspended, no active user_bans row, not in public.test_accounts;
--   * the SAME consent every commercial email uses (engagement-automations,
--     send-marketing-blast): profiles.marketing_consent (the sign-up opt-in
--     box) AND notification_preferences.email_promotions AND email_enabled
--     (a missing preferences row reads as on, as email-unsubscribe reads it);
--   * the address is not on public.suppressed_emails (bounces, complaints),
--     not a fixture (is_fixture_email) and not a reserved test domain;
--   * no other commercial email in the last 20 hours (profiles.last_drip_at,
--     the welcome drip's stamp), so two never land on the same day;
--   * NEVER CAME BACK: no sign of use from 24 hours after sign-up on. The
--     signs read: auth.users.last_sign_in_at, every auth.sessions row
--     (created, updated or refreshed: the app refreshes its session at least
--     hourly while open), public.login_history and public.analytics_events.
--     Measured 2026-10-21: every one of the 35 real members has at least one
--     of these.
--   * step 1: signed up between 3 and 10 days ago, no step 1 yet;
--   * step 2: signed up between 10 and 17 days ago, step 1 queued at least 5
--     days ago, no step 2 yet. A member who came back after step 1 is not
--     picked (the never-came-back rule is read again).
--   The windows end at 10 and 17 days so turning the switch on never mails
--   someone who signed up months ago.
--
-- Proof: src/test/pglite/comeBackEmails.pglite.mjs (this migration applied 3x
-- on top of the real switch migration; RED with NEW_MIGRATION=skip). Shape
-- guard: src/test/comeBackEmails.test.ts.
--
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO
-- NOTHING (a replay never resets the switch an admin chose); the cron step is
-- skipped where pg_cron does not exist and cron.schedule upserts by name;
-- grants restated by role name.

CREATE TABLE IF NOT EXISTS public.come_back_email_sends (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  email_step smallint NOT NULL CHECK (email_step IN (1, 2)),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  message_id text,
  CONSTRAINT come_back_email_sends_pkey PRIMARY KEY (user_id, email_step)
);

COMMENT ON TABLE public.come_back_email_sends IS
  'One row per come-back email per member (step 1 about day 3, step 2 about day 10), written by claim_come_back_emails() BEFORE the email is queued (claimed_at), so no member gets the same step twice or a third email; queued_at and message_id are stamped by come-back-emails once the email is queued. service_role only.';

ALTER TABLE public.come_back_email_sends ENABLE ROW LEVEL SECURITY;
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
-- No policy on purpose: no client role is granted anything.
REVOKE ALL ON TABLE public.come_back_email_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.come_back_email_sends TO service_role;

-- ── The switch, created OFF ───────────────────────────────────────────────
INSERT INTO public.feature_switches (key, audience, description) VALUES ('come_back_emails', 'off', 'Come-back emails: a note from the founder to a member who signed up and never came back (about day 3, one more about day 10, at most two). Off = nobody is mailed.') ON CONFLICT (key) DO NOTHING;

-- ── Claim: the row is written before the email is queued ──────────────────
CREATE OR REPLACE FUNCTION public.claim_come_back_emails(p_step integer, p_limit integer DEFAULT 20)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
BEGIN
  IF p_step IS NULL OR p_step NOT IN (1, 2) THEN
    RAISE EXCEPTION 'invalid_step' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT p.user_id AS uid, p.email AS addr, p.full_name AS name
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
       AND NOT EXISTS (
         SELECT 1 FROM public.notification_preferences np
          WHERE np.user_id = p.user_id
            AND (np.email_promotions IS NOT TRUE OR np.email_enabled IS FALSE))
       AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails s WHERE lower(s.email) = lower(p.email))
       AND NOT public.is_fixture_email(p.email)
       AND lower(p.email) !~ '@([a-z0-9-]+\.)*(example\.(com|net|org)|[a-z0-9-]+\.(test|example|invalid|localhost)|test|example|invalid|localhost)$'
       AND (p.last_drip_at IS NULL OR p.last_drip_at < now() - interval '20 hours')
       -- Never came back: no sign of use from 24 hours after sign-up on.
       AND NOT (u.last_sign_in_at IS NOT NULL AND u.last_sign_in_at >= p.created_at + interval '24 hours')
       AND NOT EXISTS (
         SELECT 1 FROM auth.sessions se
          WHERE se.user_id = p.user_id
            AND greatest(se.created_at, se.updated_at, se.refreshed_at AT TIME ZONE 'UTC') >= p.created_at + interval '24 hours')
       AND NOT EXISTS (
         SELECT 1 FROM public.login_history lh
          WHERE lh.user_id = p.user_id AND lh.created_at >= p.created_at + interval '24 hours')
       AND NOT EXISTS (
         SELECT 1 FROM public.analytics_events ae
          WHERE ae.user_id = p.user_id AND ae.created_at >= p.created_at + interval '24 hours')
       -- The step's own window.
       AND (
         (p_step = 1
           AND p.created_at <= now() - interval '3 days'
           AND p.created_at > now() - interval '10 days'
           AND NOT EXISTS (SELECT 1 FROM public.come_back_email_sends c WHERE c.user_id = p.user_id AND c.email_step = 1))
         OR
         (p_step = 2
           AND p.created_at <= now() - interval '10 days'
           AND p.created_at > now() - interval '17 days'
           AND EXISTS (SELECT 1 FROM public.come_back_email_sends c
                        WHERE c.user_id = p.user_id AND c.email_step = 1 AND c.queued_at <= now() - interval '5 days')
           AND NOT EXISTS (SELECT 1 FROM public.come_back_email_sends c WHERE c.user_id = p.user_id AND c.email_step = 2))
       )
       -- The hidden switch, decided for this member (off = nobody).
       AND public.feature_enabled_for_user('come_back_emails', p.user_id)
     ORDER BY p.created_at
     LIMIT v_limit
  ),
  claimed AS (
    -- Two overlapping runs: the second's insert waits on the first's row and
    -- then does nothing, so it returns no row and mails no one.
    INSERT INTO public.come_back_email_sends AS c (user_id, email_step)
    SELECT due.uid, p_step::smallint FROM due
    ON CONFLICT ON CONSTRAINT come_back_email_sends_pkey DO NOTHING
    RETURNING c.user_id
  )
  SELECT due.uid, due.addr, due.name
    FROM due
    JOIN claimed ON claimed.user_id = due.uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_come_back_emails(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_come_back_emails(integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_come_back_emails(integer, integer) IS
  'Come-back emails: claims up to p_limit members due for step p_step (1 about day 3, 2 about day 10) by inserting their come_back_email_sends row, and returns only the rows it inserted. Off unless the come_back_emails switch is on for the member. service_role only.';

-- ── Schedule + liveness registry ──────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('come-back-emails', interval '20 hours',
            'Owner 2026-10-21: twice a day (15:41 and 21:41 UTC) sends the come-back emails (about day 3 and day 10, at most two per member) to members who signed up and never came back. Behind the come_back_emails switch. 20 hours: the overnight gap 21:41 -> 15:41 is 18 hours.',
            'exempt',
            'No member due, or the switch off, is the healthy state, so a run that sends nothing is not a silent failure. A run that could not claim (PGRST202 included) or queue, or that finds a claim left unqueued for 2 hours, answers 500 through cronResult.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('come-back-emails', '41 15,21 * * *', $c$SELECT public.cron_http_tag(q.request_id, 'come-back-emails')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/come-back-emails',
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
