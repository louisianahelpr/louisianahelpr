-- Confirm-your-email reminder: ONE email, about a day after sign-up (owner
-- 2026-10-29, pop-up through the lead: "every unconfirmed sign-up gets ONE
-- reminder email about 24 hours after signing up, never more than one; the
-- current 54 get theirs").
--
-- 20261025190000_confirm_reminders.sql sent up to TWO (step 1 about an hour
-- after sign-up, step 2 about a day) and only to accounts under 7 days old.
-- Measured on prod 2026-10-30 02:52Z, read-only: 54 unconfirmed email
-- accounts; 46 of them already had a reminder; 1 account had BOTH emails; 8
-- had none (7 real accounts that signed up 2026-10-09..18, older than the
-- 7-day window when the switch went on for everyone on 10-26, and 1 on the
-- suppressed list, which stays skipped).
--
-- Restated from the EFFECTIVE prod definition (pg_get_functiondef,
-- 2026-10-30), changing only the step window:
--   - step 1 is never due: claim_confirm_reminders(1, n) returns no rows (it
--     does not raise, so a confirm-reminders build that still asks for step 1
--     cannot fail a run while the two deploys catch up).
--   - step 2 is due 24 hours after sign-up with NO upper bound (the 7 older
--     accounts get theirs; cleanup-abandoned-accounts still deletes an
--     unconfirmed account after 30 days), and only for an account with NO
--     confirm_reminder_sends row of any step, so an account that already had
--     the old one-hour email never gets a second.
-- Everything else (who is skipped, the switch, service_role only) is unchanged.
--
-- Replay-safe: CREATE OR REPLACE, guarded UPDATEs.
-- Proof: src/test/pglite/confirmReminderOnce.pglite.mjs (3x; red with
-- NEW_MIGRATION=skip).

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
       -- ONE reminder (owner 2026-10-29): step 2 only, a day or more after
       -- sign-up, and never to an account that already had one of any step.
       AND p_step = 2
       AND u.created_at <= now() - interval '24 hours'
       AND NOT EXISTS (SELECT 1 FROM public.confirm_reminder_sends c WHERE c.user_id = u.id)
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
  'Confirm-your-email reminder: claims up to p_limit unconfirmed email accounts at least a day old that have never had a reminder (step 2 only; step 1 is retired and returns no rows) by inserting their confirm_reminder_sends row, and returns only the rows it inserted. One per account, ever. Off unless the confirm_reminders switch is on for the account. service_role only.';

COMMENT ON TABLE public.confirm_reminder_sends IS
  'Confirm-your-email reminder: at most one row per account (step 2, about a day after sign-up; step 1 rows are from before 2026-10-30), claimed before the email is queued. Server-only (confirm-reminders edge function).';

-- The admin screen's text for the switch (the audit trigger fires on audience only).
UPDATE public.feature_switches
   SET description = 'Confirm-your-email reminder: one email, about a day after sign-up, to an email account that has not confirmed, with a fresh link. Never more than one per account.'
 WHERE key = 'confirm_reminders'
   AND description IS DISTINCT FROM 'Confirm-your-email reminder: one email, about a day after sign-up, to an email account that has not confirmed, with a fresh link. Never more than one per account.';

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    UPDATE public.cron_work_expectations
       SET note = 'Hourly at :17: sends the one confirm-your-email reminder (about a day after sign-up, never more than one per account) to email accounts that have not confirmed. Behind the confirm_reminders switch.'
     WHERE jobname = 'confirm-reminders';
  END IF;
END
$do$;
