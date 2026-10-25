-- Applicant emails: the first one at once, then at most one roundup every 3 hours
-- (owner 2026-10-25: "First now, then a roundup"). Measured on prod 2026-10-25:
-- notification_job_applications sent 50 emails to one poster on 10-22 and 48 on
-- 10-23, one per applicant. The in-app notice stays one per applicant.
--
-- application_email_state: one row per poster. last_emailed_at is when the
-- poster was last emailed about applicants (at once or in a roundup);
-- waiting counts the applicants since then that were not emailed.

CREATE TABLE IF NOT EXISTS public.application_email_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  last_emailed_at timestamptz,
  waiting integer NOT NULL DEFAULT 0 CHECK (waiting >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.application_email_state IS
  'Applicant email pacing per poster: the first new-applicant email goes at once, later ones within 3 hours are counted here and sent as one roundup by send_application_roundups. Server-only.';
ALTER TABLE public.application_email_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_email_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.application_email_state TO service_role;

-- True when this applicant's email should wait for the roundup (the poster was
-- emailed less than 3 hours ago); it then counts the applicant. False when the
-- email should go now; it then stamps the send. One row lock per poster, so
-- two applies at the same moment cannot both email.
CREATE OR REPLACE FUNCTION public.application_email_should_wait(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_last timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.application_email_state (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT last_emailed_at INTO v_last FROM public.application_email_state
   WHERE user_id = p_user_id FOR UPDATE;
  IF v_last IS NOT NULL AND v_last > now() - interval '3 hours' THEN
    UPDATE public.application_email_state SET waiting = waiting + 1, updated_at = now() WHERE user_id = p_user_id;
    RETURN true;
  END IF;
  UPDATE public.application_email_state SET last_emailed_at = now(), waiting = 0, updated_at = now() WHERE user_id = p_user_id;
  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION public.application_email_should_wait(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.application_email_should_wait(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_on_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  job_title TEXT;
  job_owner UUID;
  job_helper UUID;
  job_offered UUID;
  job_offer_status TEXT;
  v_user_id UUID;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
  v_link TEXT;
  v_email_enabled BOOLEAN;
  v_profile RECORD;
  v_applicant TEXT;
BEGIN
  SELECT title, customer_id, helper_id, offered_to_helper_id, direct_offer_status INTO job_title, job_owner, job_helper, job_offered, job_offer_status FROM public.jobs WHERE id = NEW.job_id;

  -- Q1185: only a real application (born 'pending') is news to the poster. A
  -- row born 'accepted' is the record of an accept (respond_to_direct_offer's
  -- completion, claim_series_dates), whose own notice tells the poster; this
  -- one said "Someone applied" first, and at a direct offer's pending tap it
  -- reached the poster before the Helpr's setup was done.
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    v_user_id := job_owner;
    v_title := 'New application';
    -- Owner 2026-10-21: say WHO applied, as "First L." (the member-name rule, member_display_name).
    -- Never across a block (RLS already refuses that apply, and the poster's applicant list hides a
    -- blocked applicant): NULL there, and from a context are_users_blocked will not answer for, reads
    -- "Someone". A blank name reads "Someone"; no profile row (an account mid-deletion) reads "A former member".
    IF NOT COALESCE(public.are_users_blocked(NEW.helper_id, job_owner), true) THEN
      SELECT public.member_display_name(p.full_name, 'Someone') INTO v_applicant
        FROM public.profiles p WHERE p.user_id = NEW.helper_id;
      IF NOT FOUND THEN
        v_applicant := 'A former member';
      END IF;
    END IF;
    v_message := COALESCE(v_applicant, 'Someone') || ' applied to "' || job_title || '"';
    v_type := 'application';
    v_link := '/posts?job=' || NEW.job_id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    -- Owner 2026-10-25 (the admin account got 50 of these in one day): the
    -- FIRST applicant emails at once; later ones within 3 hours wait for one
    -- roundup ("You have N new applicants", send_application_roundups, cron
    -- application-roundups). In-app notices are unchanged: one per applicant.
    IF COALESCE(v_email_enabled, true) AND NOT public.application_email_should_wait(v_user_id) THEN
      SELECT email, full_name INTO v_profile FROM public.profiles WHERE user_id = v_user_id;
      IF v_profile.email IS NOT NULL THEN
        PERFORM net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
          ),
          body := jsonb_build_object(
            'user_id', v_user_id,
            'title', v_title,
            'message', v_message,
            'type', v_type,
            'link', v_link
          )
        );
      END IF;
    END IF;
  END IF;

  -- NO 'accepted' branch. The client (useOfferHandlers) is the single
  -- producer for an accept: only it knows the response deadline the poster
  -- picked, and only its link ('/jobs?filter=offered') reaches the screen
  -- where the helper can actually accept before that deadline runs out.

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    -- ADDED 2026-09-23 (Q274): the backfill below closes applications on jobs
    -- that were cancelled long ago. Nobody is owed a notice for that.
    IF current_setting('app.q274_backfill', true) = 'on' THEN
      RETURN NEW;
    END IF;
    -- ADDED 2026-09-24 (Q345): closed because one of the two blocked the
    -- other. A notice would be contact the blocker asked not to have, and
    -- "not selected" would be false when the applicant is the one who blocked.
    IF NEW.closed_reason = 'party_blocked' THEN
      RETURN NEW;
    END IF;
    -- Owner, 2026-10-21: an applicant who was NOT hired or offered is not told the job was cancelled
    -- (no bell, push or email); their application reads "This job is no longer available" in the app.
    -- The offered Helpr (jobs.helper_id) is still told: they may be planning to show up.
    -- A pending direct offer counts as offered (lh-authz-rls review note 1): jobs.helper_id is NULL until
    -- they accept, and poster_cancel_job tells only helper_id, so they would otherwise hear nothing.
    IF NEW.closed_reason = 'job_cancelled' AND NEW.helper_id IS DISTINCT FROM job_helper
       AND NOT COALESCE(NEW.helper_id = job_offered AND job_offer_status = 'pending', false) THEN
      RETURN NEW;
    END IF;
    v_user_id := NEW.helper_id;
    v_title := 'Application update';
    -- ADDED 2026-09-23 (Q274): closed because the JOB was cancelled, not
    -- because anyone turned this applicant down. "Not selected" would be false.
    IF NEW.closed_reason = 'job_cancelled' THEN
      v_message := '"' || COALESCE(job_title, 'A job') || '" was cancelled, so your application is closed';
    ELSE
      v_message := 'Your application for "' || job_title || '" was not selected';
      -- The poster's own words, when they left any. This is the whole reason
      -- the client used to fire a SECOND notification.
      IF NEW.decline_reason IS NOT NULL AND btrim(NEW.decline_reason) <> '' THEN
        v_message := v_message || ': ' || btrim(NEW.decline_reason);
      END IF;
    END IF;
    v_type := 'info';
    -- A rejected application buckets to `cancelled` on the applied tab
    -- (appliedActivityBucket). '/home' showed the job board instead.
    v_link := '/jobs?job=' || NEW.job_id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    IF COALESCE(v_email_enabled, true) THEN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', v_user_id, 'title', v_title, 'message', v_message, 'type', v_type, 'link', v_link
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_on_application() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_application() TO service_role;

-- The roundup: for every poster with applicants waiting whose last email was 3+
-- hours ago, one email "You have N new applicants" (send-notification-email,
-- type application, so the poster's email_job_applications switch, suppression
-- and the test-recipient gate all apply). Claims the batch first (waiting -> 0,
-- last_emailed_at -> now) so a slow or repeated run never sends twice.
CREATE OR REPLACE FUNCTION public.send_application_roundups(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r record;
  v_sent integer := 0;
BEGIN
  FOR r IN
    WITH due AS (
      SELECT s.user_id, s.waiting
        FROM public.application_email_state s
       WHERE s.waiting > 0
         AND (s.last_emailed_at IS NULL OR s.last_emailed_at <= now() - interval '3 hours')
       ORDER BY s.updated_at
       LIMIT greatest(1, least(coalesce(p_limit, 200), 500))
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.application_email_state s
       SET waiting = 0, last_emailed_at = now(), updated_at = now()
      FROM due
     WHERE s.user_id = due.user_id
    RETURNING s.user_id, due.waiting
  LOOP
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', r.user_id,
        'title', 'New applicants',
        'message', CASE WHEN r.waiting = 1 THEN 'You have 1 more new applicant.' ELSE 'You have ' || r.waiting || ' more new applicants.' END,
        'type', 'application',
        'link', '/posts'
      )
    );
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.send_application_roundups(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_application_roundups(integer) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('application-roundups', interval '2 hours',
            'Every 30 minutes at :08 and :38: one "You have N new applicants" email per poster whose applicants waited for the 3-hour roundup.',
            'exempt',
            'No poster with applicants waiting is the normal state, so a run that sends nothing is healthy.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('application-roundups', '8,38 * * * *',
      $c$SELECT public.cron_record_work('application-roundups', to_jsonb(public.send_application_roundups()));$c$);
  END IF;
END
$do$;

-- Job-match emails: at most one a day (owner 2026-10-25: "At most 1 a day";
-- prod 10-21 sent up to 4 to one Helpr). send-notification-email asks
-- job_match_email_should_wait before a job_matches email: the first of the
-- Louisiana day goes at once, later ones are counted and sent together the next
-- morning by send_job_match_roundups (cron job-match-roundups, 13:05 UTC, 8:05
-- in Louisiana during daylight time). In-app notices and push are unchanged.
CREATE TABLE IF NOT EXISTS public.job_match_email_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  last_emailed_day date,
  waiting integer NOT NULL DEFAULT 0 CHECK (waiting >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.job_match_email_state IS
  'Job-match email pacing per member: one email per Louisiana day; later matches are counted and sent as one morning roundup (send_job_match_roundups). Server-only.';
ALTER TABLE public.job_match_email_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_match_email_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_match_email_state TO service_role;

CREATE OR REPLACE FUNCTION public.job_match_email_should_wait(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_last date;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.job_match_email_state (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT last_emailed_day INTO v_last FROM public.job_match_email_state
   WHERE user_id = p_user_id FOR UPDATE;
  IF v_last IS NOT NULL AND v_last >= v_today THEN
    UPDATE public.job_match_email_state SET waiting = waiting + 1, updated_at = now() WHERE user_id = p_user_id;
    RETURN true;
  END IF;
  UPDATE public.job_match_email_state SET last_emailed_day = v_today, waiting = 0, updated_at = now() WHERE user_id = p_user_id;
  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION public.job_match_email_should_wait(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_match_email_should_wait(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.send_job_match_roundups(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  r record;
  v_sent integer := 0;
BEGIN
  FOR r IN
    WITH due AS (
      SELECT s.user_id, s.waiting
        FROM public.job_match_email_state s
       WHERE s.waiting > 0
         AND (s.last_emailed_day IS NULL OR s.last_emailed_day < v_today)
       ORDER BY s.updated_at
       LIMIT greatest(1, least(coalesce(p_limit, 500), 2000))
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.job_match_email_state s
       SET waiting = 0, last_emailed_day = v_today, updated_at = now()
      FROM due
     WHERE s.user_id = due.user_id
    RETURNING s.user_id, due.waiting
  LOOP
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', r.user_id,
        'title', 'More jobs near you',
        'message', CASE WHEN r.waiting = 1 THEN '1 more job near you was posted yesterday.' ELSE r.waiting || ' more jobs near you were posted yesterday.' END,
        'type', 'job_match',
        'link', '/jobs',
        'roundup', true
      )
    );
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.send_job_match_roundups(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_job_match_roundups(integer) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('job-match-roundups', interval '26 hours',
            'Daily at 13:05 UTC: one "more jobs near you" email per member whose job-match emails waited for the daily roundup.',
            'exempt',
            'No member with matches waiting is a normal morning, so a run that sends nothing is healthy.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('job-match-roundups', '5 13 * * *',
      $c$SELECT public.cron_record_work('job-match-roundups', to_jsonb(public.send_job_match_roundups()));$c$);
  END IF;
END
$do$;

-- Q30 catch-up policy for the daily job-match roundup: it claims its batch
-- (waiting -> 0) before sending, so a late run sends exactly what is waiting.
DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    -- Restates the whole policy set (the guard reads the newest seeding migration).
INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
  ('ops-daily-digest',                true,  interval '20 hours', 'Slack digest of the last 24h of ops alerts; writes only its own delivery receipt. A late digest is the Q30 case itself: 09-22 went 38h with none.'),
  ('sweep-daily-job-digest',          true,  interval '6 hours',  'In-app "New jobs in <parish>" digest; its own NOT EXISTS skips anyone digested in the last 23h, so it cannot double-send. Capped at 6h because a late run shifts the next day''s by that 23h dedupe.'),
  ('push-token-health',               true,  interval '20 hours', 'Monitor (Q82): counts push tokens and writes at most one error_logs row per UTC day. Read-only otherwise.'),
  ('marketing-token-health',          true,  interval '20 hours', 'Monitor: checks the Meta token and that the publish queue drains; reads and alerts only.'),
  ('money-reconciliation',            true,  interval '20 hours', 'STRICTLY READ-ONLY by design (header of supabase/functions/money-reconciliation/index.ts): selects and Stripe paymentIntents.retrieve only. Reports money drift, never moves money.'),
  ('detect-suspicious-user-patterns', true,  interval '20 hours', 'Inserts a fraud_flags row only when no unresolved flag of that type exists for the user; its windows are relative to now(). Re-running is idempotent.'),
  ('sweep-old-email-send-log',        true,  interval '20 hours', 'Age-based TTL delete: a late run deletes exactly what the next run would. Idempotent.'),
  ('sweep-old-notifications',         true,  interval '20 hours', 'Age-based TTL delete of old notifications. Idempotent.'),
  ('sweep-old-error-logs',            true,  interval '20 hours', 'Age-based TTL delete of old error_logs. Idempotent.'),
  ('prune-cron-run-details',          true,  interval '20 hours', 'Deletes cron.job_run_details older than 7 days; the catch-up reads only the latest slot. Idempotent.'),
  ('prune-cron-run-log',              true,  interval '20 hours', 'Age-based prune of cron_run_log. Idempotent.'),
  ('prune-edge-rate-limit-log',       true,  interval '20 hours', 'Age-based prune of the edge rate-limit log. Idempotent.'),
  ('cleanup-notifications',           true,  interval '20 hours', 'Deletes READ notifications older than 30 days (age-based). Idempotent.'),
  ('stalled-completion-reminder',     true,  interval '6 hours',  'User nudge with its own per-job ledger (first_sent_at / second_sent_at / escalated_at, upsert ignoreDuplicates): a stage is never sent twice. 6h cap keeps it inside daytime.'),
  ('review-nag-cron',                 true,  interval '6 hours',  'User nudge with its own dedupe count per user and job inside WINDOW_HOURS, failing closed (unreadable count = already nagged). 6h cap keeps it inside daytime.'),
  ('engagement-automations',          true,  interval '6 hours',  'Lifecycle emails spaced by last_drip_at / last_approval_email_at, which it stamps on send: a late run cannot send a step twice. 6h cap keeps it inside daytime.'),
  ('charge-recurring-visits',         false, interval '1 hour',   'CHARGES CARDS for recurring visits. Money is never auto-rerun: a person checks what the missed day should have charged.'),
  ('expire-subscriptions',            false, interval '1 hour',   'Ends paid entitlements (one-time passes, lapsed tiers). Changes what a paying user has; a person decides.'),
  ('subscription-reconciliation',     false, interval '1 hour',   'REPAIRS tier state from Stripe (its header: "why this one repairs"). An automated entitlement writer is not re-run blind; a person decides.'),
  ('cleanup-abandoned-accounts',      false, interval '1 hour',   'DELETES accounts. Destructive; never re-run automatically.'),
  ('weekly-helper-report',            true,  interval '6 hours',  'Q188: weekly in-app report now skips any helper who already has one from the last 6 days (supabase/functions/weekly-helper-report, tested in src/test/edge/weekly-helper-report.test.ts), so a late run cannot send twice. 6h cap keeps it inside daytime.'),
  ('cleanup-stripe-webhook-events',   true,  interval '20 hours', 'Q167: deletes stripe_webhook_events processed over 30 days ago; the window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('cleanup-observability-tables',    true,  interval '20 hours', 'Q167: deletes analytics_events over 90 days and error_logs over 30; relative windows, idempotent, so a late run is the same prune.'),
  ('prune-retention-tables',          true,  interval '20 hours', 'CJ-003/CS-003: age-based deletes (login_history, notification_logs, profile_views, job_views, rate logs, W-9s over 4 years); every window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('purge-old-seed-data',             true,  interval '20 hours', 'Q65: age-based purge of is_seed test jobs (never money, never a fixture id, never profiles) and seed notifications; the window is relative to now() and every run is bounded and recorded, so a late run is the same purge.'),
  ('unfilled-series-visit-reminders', false, interval '1 hour',   'Tells a poster an empty series visit is TOMORROW (20261012195747). The text is relative to the run''s own day, so a late run past midnight would name the wrong day; its own once-per-visit ledger already stops a double send. Not re-run late.'),
  ('declutter-price-drops',           false, interval '1 hour',   'Declutter evening price drop (20261014210518): once per Louisiana day; a missed evening is simply skipped and the next evening drops 5% as usual. Not re-run late: a late run past midnight would spend the NEXT day''s drop.'),
  ('listing-photo-purge', false, interval '1 hour', 'Homes listing photo purge (20261019071203): deletes taken-down listings'' photos through the Storage API. Deletion is never re-run late; the next daily run deletes whatever is due.'),
  ('rentals-rent-sweep', false, interval '1 hour', 'Homes rent tracker (20261019073106): writes due rent rows, late fees and reminders. Not re-run late: the next daily run writes every missed rent row and fee itself (idempotent, from the first due date); only a missed reminder is skipped.'),
  ('rentals-deposit-sweep', false, interval '1 hour', 'Homes deposit tracker (20261019082216): deposit-return reminders by stage. Not re-run late: the next daily run sends the stage that is due (once each).'),
  ('job-match-roundups',              true,  interval '6 hours',  'Sends one "more jobs near you" email per member whose matches waited; it claims the batch (waiting -> 0) before sending, so a late run sends only what is still waiting and never twice. Capped at 6h so a very late run does not land in the evening.')
    ON CONFLICT (jobname) DO UPDATE
      SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
          reason = EXCLUDED.reason, updated_at = now();
  END IF;
END
$do$;

-- Q807: every public table carries the unconfirmed-email write gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
