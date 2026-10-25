-- Confirm-your-email reminders (lead, 2026-10-25, Builder A item 1b).
--
-- 53 of 164 real email sign-ups since 2026-10-15 never confirmed (measured on
-- prod 2026-10-25), and nothing reminded them: signup-lead-reminders covers
-- people who never made an account, and cleanup-abandoned-accounts deletes an
-- unconfirmed account after 30 days. Now an unconfirmed email account gets at
-- most TWO reminders, about 1 hour and about 24 hours after sign-up, each with
-- a fresh scanner-safe link (supabase/functions/_shared/confirmLink.ts).
--
--   1. public.confirm_reminder_sends: one row per (account, step), claimed
--      before the email is queued, so two runs never mail one account twice
--      and no account gets a third. Server-only.
--   2. public.claim_confirm_reminders(p_step, p_limit): picks the due accounts
--      and writes their rows in ONE statement, returning only the rows it
--      wrote. Due means: an email sign-up (provider email), unconfirmed, not
--      deleted, banned or anonymous, not a test account, a seed profile, a
--      suppressed, fixture or reserved-domain address; no confirmation email
--      in the last 30 minutes (a fresh one is on its way); in the step's
--      window (step 1: 1-23 hours old; step 2: 24 hours to 7 days old, and
--      step 1 queued at least 12 hours ago, or never sent at all); and the
--      hidden switch confirm_reminders on for the account. service_role only.
--   3. The switch confirm_reminders, created 'testers'.
--   4. cron job confirm-reminders, hourly at :17.
--
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT, cron.schedule
-- upserts by name and is skipped where pg_cron does not exist.
-- Proof: src/test/pglite/confirmReminders.pglite.mjs (3x).

CREATE TABLE IF NOT EXISTS public.confirm_reminder_sends (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reminder_step smallint NOT NULL CHECK (reminder_step IN (1, 2)),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  message_id uuid,
  CONSTRAINT confirm_reminder_sends_pkey PRIMARY KEY (user_id, reminder_step)
);

COMMENT ON TABLE public.confirm_reminder_sends IS
  'Confirm-your-email reminders: one row per account and step (1 about an hour after sign-up, 2 about a day), claimed before the email is queued. Server-only (confirm-reminders edge function).';

ALTER TABLE public.confirm_reminder_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.confirm_reminder_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.confirm_reminder_sends TO service_role;

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('confirm_reminders', 'testers',
        'Confirm-your-email reminders: at most two emails (about 1 hour and 24 hours after sign-up) to an email account that has not confirmed, each with a fresh link.')
ON CONFLICT (key) DO NOTHING;

-- Scanner-safe sign-up links (auth-email-hook, _shared/confirmLink.ts): created
-- for testers; the lead widens it once a tester's sign-up confirms through the tap.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('scanner_safe_confirm_links', 'testers',
        'Sign-up confirmation links open the app''s Confirm page and are spent only by the person''s tap, so mail scanners cannot use them up.')
ON CONFLICT (key) DO NOTHING;

-- The auth email hook asks this, per account, whether to send the scanner-safe
-- link. One indexed read; a failed call keeps GoTrue's own link (fails closed).
CREATE OR REPLACE FUNCTION public.scanner_safe_confirm_link_for(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT p_user_id IS NOT NULL AND public.feature_enabled_for_user('scanner_safe_confirm_links', p_user_id)
$fn$;
REVOKE ALL ON FUNCTION public.scanner_safe_confirm_link_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scanner_safe_confirm_link_for(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_confirm_reminders(p_step integer, p_limit integer)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
BEGIN
  IF p_step IS NULL OR p_step NOT IN (1, 2) THEN
    RAISE EXCEPTION 'invalid_step' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT u.id AS uid, u.email::text AS addr, p.full_name AS name, u.created_at AS signed_up
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.user_id = u.id
     WHERE u.email IS NOT NULL
       AND u.email_confirmed_at IS NULL
       AND u.deleted_at IS NULL
       AND u.is_anonymous IS NOT TRUE
       AND (u.banned_until IS NULL OR u.banned_until <= now())
       -- An email-and-password sign-up: Apple and Google accounts arrive confirmed.
       AND coalesce(u.raw_app_meta_data ->> 'provider', 'email') = 'email'
       -- A confirmation email went out in the last 30 minutes (sign-up, Resend):
       -- that link is fresh, so this run leaves the account alone.
       AND (u.confirmation_sent_at IS NULL OR u.confirmation_sent_at <= now() - interval '30 minutes')
       AND (p.user_id IS NULL OR (p.is_seed IS NOT TRUE AND p.anonymized_at IS NULL))
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails s WHERE lower(s.email) = lower(u.email))
       AND NOT public.is_fixture_email(u.email)
       AND lower(u.email) !~ '@([a-z0-9-]+\.)*(example\.(com|net|org)|[a-z0-9-]+\.(test|example|invalid|localhost)|test|example|invalid|localhost)$'
       AND (
         (p_step = 1
           AND u.created_at <= now() - interval '1 hour'
           AND u.created_at > now() - interval '23 hours'
           AND NOT EXISTS (SELECT 1 FROM public.confirm_reminder_sends c WHERE c.user_id = u.id AND c.reminder_step = 1))
         OR
         (p_step = 2
           AND u.created_at <= now() - interval '24 hours'
           AND u.created_at > now() - interval '7 days'
           -- Spaced from the first: never two reminders within 12 hours.
           AND NOT EXISTS (SELECT 1 FROM public.confirm_reminder_sends c
                            WHERE c.user_id = u.id AND c.reminder_step = 1
                              AND c.claimed_at > now() - interval '12 hours')
           AND NOT EXISTS (SELECT 1 FROM public.confirm_reminder_sends c WHERE c.user_id = u.id AND c.reminder_step = 2))
       )
       -- The hidden switch, decided for this account (off = nobody).
       AND public.feature_enabled_for_user('confirm_reminders', u.id)
     ORDER BY u.created_at
     LIMIT v_limit
  ),
  claimed AS (
    INSERT INTO public.confirm_reminder_sends AS c (user_id, reminder_step)
    SELECT due.uid, p_step::smallint FROM due
    ON CONFLICT ON CONSTRAINT confirm_reminder_sends_pkey DO NOTHING
    RETURNING c.user_id
  )
  SELECT due.uid, due.addr, due.name
    FROM due
    JOIN claimed ON claimed.user_id = due.uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_confirm_reminders(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_confirm_reminders(integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_confirm_reminders(integer, integer) IS
  'Confirm-your-email reminders: claims up to p_limit unconfirmed email accounts due for step p_step (1 about an hour after sign-up, 2 about a day) by inserting their confirm_reminder_sends row, and returns only the rows it inserted. Off unless the confirm_reminders switch is on for the account. service_role only.';

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('confirm-reminders', interval '3 hours',
            'Hourly at :17: sends the confirm-your-email reminders (about 1 hour and 24 hours after sign-up, at most two per account) to email accounts that have not confirmed. Behind the confirm_reminders switch.',
            'exempt',
            'No account due, or the switch off, is the healthy state, so a run that sends nothing is not a silent failure. A run that could not claim, mint a link or queue answers 500 through cronResult.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('confirm-reminders', '17 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'confirm-reminders')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/confirm-reminders',
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
