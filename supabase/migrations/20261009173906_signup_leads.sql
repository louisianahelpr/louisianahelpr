-- Signup leads: save the email from sign-up step 1, follow up ONCE (owner
-- pop-up 2026-10-09, "Save it, follow up once").
--
-- WHY. Measured on prod 2026-10-09: 16 people finished sign-up step 1 (email +
-- password) and only 4 completed. Nothing was stored until the final step
-- (the auth user is created there and complete-signup writes the profile), so
-- the other 12 left no trace and could not be reminded.
--
-- WHAT THIS ADDS (every layer):
--   * public.signup_leads: one row per normalised email. RLS on with NO client
--     policies, no grant to PUBLIC/anon/authenticated; service_role only. The
--     password is never sent here and there is no column for it.
--   * record_signup_lead(email, source): the only writer, service_role only.
--     The browser reaches it through the record-signup-lead edge function
--     (verify_jwt = false, durable rate limit), which answers the same way
--     whether or not the address already has an account, so it cannot be used
--     to enumerate accounts. Idempotent: a repeat capture changes nothing.
--   * zz_mark_signup_lead_completed on auth.users: the auth user is created at
--     the final sign-up step, by every path (email form, social sign-in), so
--     its INSERT is the completion. It stamps completed_at and can never block
--     account creation (a failure is a WARNING; the sweep re-checks auth.users
--     before every send anyway).
--   * sweep_signup_leads(): marks completed any lead whose email now has an
--     auth user, and deletes leads older than 30 days (retention), EXCEPT a
--     lead that was reminded or unsubscribed and never completed: that row is
--     the only record that the address was already mailed or opted out, so
--     deleting it would let a fresh step-1 capture mail it a second time
--     (docs/OPEN.md Q1588 asks the owner to confirm keeping them).
--   * record_signup_lead(email, source, replaces): a visitor who goes Back and
--     corrects a mistyped address passes the old one as `replaces`; that lead
--     is deleted only while it is under 2 hours old, never reminded, never
--     completed and never unsubscribed, so a typo is not mailed later.
--   * claim_signup_lead_reminders(limit): stamps reminder_sent_at and returns
--     the rows IN ONE UPDATE (FOR UPDATE SKIP LOCKED), so a lead is claimed
--     before its email is queued and can never be mailed twice. Only leads
--     created more than 24 h ago, not completed, not reminded, not
--     unsubscribed, with no auth user or profile for the address, not on the
--     hard suppression list, and not a fixture or reserved test address.
--   * cron job signup-lead-reminders: calls the signup-lead-reminders edge
--     function hourly from 14:23 to 23:23 UTC (9:23 AM-6:23 PM CDT, 8:23 AM-
--     5:23 PM CST), which
--     runs the sweep, claims, and queues the one email through enqueue_email
--     (process-email-queue sends it via Resend), with a signed one-click
--     unsubscribe (email-unsubscribe stamps unsubscribed_at).
--
-- Proof: src/test/pglite/signupLeads.pglite.mjs (applied 3x; RED with
-- NEW_MIGRATION=skip). Shape guard: src/test/signupLeads.test.ts.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS;
-- the cron and registry steps are skipped where pg_cron or the registry table
-- do not exist; cron.schedule upserts by name.

CREATE TABLE IF NOT EXISTS public.signup_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  reminder_sent_at timestamptz,
  unsubscribed_at timestamptz,
  CONSTRAINT signup_leads_email_normalized
    CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  CONSTRAINT signup_leads_source_shape
    CHECK (source IS NULL OR (length(source) BETWEEN 1 AND 64 AND source ~ '^[a-z0-9._-]+$'))
);

CREATE UNIQUE INDEX IF NOT EXISTS signup_leads_email_key ON public.signup_leads (email);
CREATE INDEX IF NOT EXISTS signup_leads_due_idx
  ON public.signup_leads (created_at)
  WHERE completed_at IS NULL AND reminder_sent_at IS NULL AND unsubscribed_at IS NULL;

COMMENT ON TABLE public.signup_leads IS
  'Emails captured at sign-up step 1 (owner 2026-10-09). service_role only. One reminder at most (reminder_sent_at); deleted after 30 days by sweep_signup_leads() unless reminded or unsubscribed and never completed.';

ALTER TABLE public.signup_leads ENABLE ROW LEVEL SECURITY;
SELECT public.attach_unconfirmed_email_gate();

REVOKE ALL ON TABLE public.signup_leads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.signup_leads TO service_role;

-- ── The one writer ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_signup_lead(p_email text, p_source text DEFAULT NULL, p_replaces text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_source text := nullif(left(regexp_replace(lower(btrim(coalesce(p_source, ''))), '[^a-z0-9._-]', '', 'g'), 64), '');
  v_replaces text := nullif(lower(btrim(coalesce(p_replaces, ''))), '');
BEGIN
  IF length(v_email) < 3 OR length(v_email) > 254
     OR length(split_part(v_email, '@', 1)) > 64
     OR v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.signup_leads (email, source)
  VALUES (v_email, v_source)
  ON CONFLICT (email) DO NOTHING;

  -- A corrected typo: drop the address the same visitor typed a moment ago,
  -- only while it is fresh and untouched.
  IF v_replaces IS NOT NULL AND v_replaces <> v_email THEN
    DELETE FROM public.signup_leads l
     WHERE l.email = v_replaces
       AND l.created_at > now() - interval '2 hours'
       AND l.reminder_sent_at IS NULL
       AND l.completed_at IS NULL
       AND l.unsubscribed_at IS NULL;
  END IF;

  -- An address that already has an account is not a lead to remind.
  UPDATE public.signup_leads l
     SET completed_at = now()
   WHERE l.email = v_email
     AND l.completed_at IS NULL
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.email = v_email);
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_signup_lead(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_signup_lead(text, text, text) TO service_role;

-- ── Completion: the auth user is created at the final sign-up step ────────
CREATE OR REPLACE FUNCTION public.mark_signup_lead_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.email IS NOT NULL THEN
    BEGIN
      UPDATE public.signup_leads
         SET completed_at = now()
       WHERE email = lower(btrim(NEW.email))
         AND completed_at IS NULL;
    EXCEPTION WHEN OTHERS THEN
      -- Never block account creation over a lead stamp. Not silent: the
      -- warning reaches the Postgres log, and claim_signup_lead_reminders
      -- re-checks auth.users before every send, so a missed stamp cannot
      -- mail someone who finished signing up.
      RAISE WARNING 'mark_signup_lead_completed failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.mark_signup_lead_completed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_mark_signup_lead_completed ON auth.users;
CREATE TRIGGER zz_mark_signup_lead_completed
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.mark_signup_lead_completed();

-- ── Sweep: completion backstop + 30-day retention ─────────────────────────
-- auth.users is matched with plain equality: GoTrue stores addresses
-- lowercased (0 mixed-case rows on prod, measured 2026-10-09), and equality
-- uses idx_users_email where lower(u.email) would scan the table.
CREATE OR REPLACE FUNCTION public.sweep_signup_leads()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_completed integer;
  v_purged integer;
BEGIN
  UPDATE public.signup_leads l
     SET completed_at = now()
   WHERE l.completed_at IS NULL
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.email = l.email);
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  DELETE FROM public.signup_leads
   WHERE created_at < now() - interval '30 days'
     AND (completed_at IS NOT NULL OR (reminder_sent_at IS NULL AND unsubscribed_at IS NULL));
  GET DIAGNOSTICS v_purged = ROW_COUNT;

  RETURN jsonb_build_object('completed', v_completed, 'purged', v_purged);
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_signup_leads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_signup_leads() TO service_role;

-- ── Claim: stamp first, then the caller queues the one email ──────────────
CREATE OR REPLACE FUNCTION public.claim_signup_lead_reminders(p_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
BEGIN
  RETURN QUERY
  UPDATE public.signup_leads t
     SET reminder_sent_at = now()
   WHERE t.id IN (
     SELECT l.id
       FROM public.signup_leads l
      WHERE l.created_at <= now() - interval '24 hours'
        AND l.created_at > now() - interval '30 days'
        AND l.completed_at IS NULL
        AND l.reminder_sent_at IS NULL
        AND l.unsubscribed_at IS NULL
        AND NOT public.is_fixture_email(l.email)
        AND l.email !~ '@([a-z0-9-]+\.)*(example\.(com|net|org)|[a-z0-9-]+\.(test|example|invalid|localhost)|test|example|invalid|localhost)$'
        AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.email = l.email)
        AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.email) = l.email)
        AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails s WHERE lower(s.email) = l.email)
      ORDER BY l.created_at
      LIMIT v_limit
      FOR UPDATE SKIP LOCKED
   )
     AND t.reminder_sent_at IS NULL
  RETURNING t.id, t.email;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_signup_lead_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_signup_lead_reminders(integer) TO service_role;

-- ── Schedule + registry ───────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('signup-lead-reminders', interval '16 hours',
            'Owner 2026-10-09: hourly 14:23-23:23 UTC (9:23 AM-6:23 PM CDT, 8:23 AM-5:23 PM CST), sends the ONE "Finish signing up" email to sign-up step-1 leads older than 24 h, and deletes untouched leads older than 30 days.',
            'exempt',
            'No lead due is the healthy state, so a run that sends nothing is not a silent failure. A run that could not read, claim or queue answers 500 through cronResult.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('signup-lead-reminders', '23 14-23 * * *', $c$SELECT public.cron_http_tag(q.request_id, 'signup-lead-reminders')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/signup-lead-reminders',
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
