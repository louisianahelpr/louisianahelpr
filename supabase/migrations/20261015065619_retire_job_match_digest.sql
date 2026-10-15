-- Q1657: retire the dead job-match digest plumbing.
--
-- Q1585 (owner, 2026-10-12) removed the "daily list" choice for job matches,
-- and 20261012042612 holds notification_preferences.match_digest_mode false
-- with a trigger. Measured live 2026-10-15 06:55Z: 0 users have it on and
-- public.match_digest_queue holds 0 rows, so every branch below that reads the
-- digest mode or writes that queue is unreachable:
--
--   1. cron 'daily-match-digest' (the edge function that drained the queue)
--      is unscheduled, and its catch-up policy and work-expectation rows go
--      with it (sweep_dead_crons would otherwise page "expected to run but
--      does not exist", as it did for the broadcast cron on 2026-09-24).
--   2. notify_saved_searches_on_new_job loses its digest branch and the
--      ST-011 "digest unthrottled" clause: every match is queued for the
--      saved-search alert sweep, behind the hourly throttle.
--   3. deliver_saved_search_alert loses its "switched to the digest while this
--      alert waited" diversion.
--   4. job_match_digest_rows (read only by the daily-match-digest function) is
--      dropped.
--
-- KEPT on purpose: the match_digest_mode column and its hold trigger (the
-- shipped 7119 iOS build still sends the column), and the match_digest_queue
-- table (export_my_data reads it; dropping it is destructive DDL for no gain).
--
-- Both function bodies are the live ones (pg_get_functiondef, 2026-10-15) with
-- only the digest lines removed. Grants are restated: these are SECURITY
-- DEFINER and run only from the trigger and the service-role sweep.
--
-- Replay-safe: every object is checked before it is touched, the unschedule is
-- guarded by an EXISTS on cron.job, the DELETEs are keyed by jobname, and
-- CREATE OR REPLACE / DROP FUNCTION IF EXISTS are idempotent.

DO $do$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-match-digest') THEN
    PERFORM cron.unschedule('daily-match-digest');
  END IF;

  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    DELETE FROM public.cron_work_expectations WHERE jobname IN ('daily-match-digest');
  END IF;

  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    DELETE FROM public.cron_catchup_policy WHERE jobname IN ('daily-match-digest');
  END IF;
END
$do$;

-- cronCatchUpPolicy (Q30) reads the NEWEST migration that seeds
-- public.cron_catchup_policy as the whole policy, so this restates every row of
-- 20261012214444 verbatim, minus 'daily-match-digest'.
DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    EXECUTE $pol$
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
  ('unfilled-series-visit-reminders', false, interval '1 hour',   'Tells a poster an empty series visit is TOMORROW (20261012195747). The text is relative to the run''s own day, so a late run past midnight would name the wrong day; its own once-per-visit ledger already stops a double send. Not re-run late.')
ON CONFLICT (jobname) DO UPDATE
  SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
      reason = EXCLUDED.reason, updated_at = now();
    $pol$;
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  match_record RECORD;
  v_visible_at TIMESTAMPTZ;
BEGIN
  IF NEW.status <> 'open'
     -- A series visit is re-offered only inside its series (20260927015010):
     -- a vacated visit going accepted -> open while funded fires this
     -- trigger's UPDATE path and must not alert saved searches.
     OR NEW.parent_job_id IS NOT NULL
     OR COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
  THEN
    RETURN NEW;
  END IF;

  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  FOR match_record IN
    SELECT
      s.user_id,
      (ARRAY_AGG(s.name ORDER BY s.created_at DESC))[1] AS search_name,
      ARRAY_AGG(s.id)                                   AS matched_search_ids
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = s.user_id
    WHERE s.notify_enabled = true
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      -- These rows are type 'job_match'; the category switch is the master
      -- over every saved search. Unset means on.
      AND COALESCE(np.job_matches, true) IS TRUE
      AND (s.category IS NULL OR s.category = NEW.category::text)
      AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget)
      AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (
        s.query IS NULL
        OR btrim(s.query) = ''
        OR strpos(lower(NEW.title), lower(btrim(s.query))) > 0
        OR strpos(lower(COALESCE(NEW.description, '')), lower(btrim(s.query))) > 0
      )
      AND (
        s.location_keyword IS NULL
        OR s.location_keyword ~ '^nearby:'
        OR strpos(lower(COALESCE(NEW.location, '')), lower(s.location_keyword)) > 0
      )
      AND (
        s.radius_miles IS NULL
        OR (
          p.latitude IS NOT NULL AND p.longitude IS NOT NULL
          AND NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
          AND public.miles_between(p.latitude, p.longitude, NEW.latitude, NEW.longitude) <= s.radius_miles
        )
        OR (
          (p.latitude IS NULL OR p.longitude IS NULL
           OR NEW.latitude IS NULL OR NEW.longitude IS NULL)
          AND p.parish IS NOT NULL
          AND NEW.parish IS NOT NULL
          AND p.parish = NEW.parish
        )
      )
      -- ST-011: the hourly throttle stops notification spam. The digest that
      -- once bypassed it is retired (Q1657), so it binds every match.
      AND (
        s.last_notified_at IS NULL
        OR s.last_notified_at < now() - interval '1 hour'
      )
    GROUP BY s.user_id
  LOOP
    -- V-008: queued, never sent here, even when already visible. This
    -- runs inside the funding write; the sweep sends once the job is in
    -- THIS user's feed.
    v_visible_at := public.early_access_visible_at(match_record.user_id, NEW.created_at);
    INSERT INTO public.saved_search_alert_queue (user_id, job_id, notify_at, search_name, matched_search_ids)
    VALUES (match_record.user_id, NEW.id, v_visible_at, match_record.search_name, match_record.matched_search_ids)
    ON CONFLICT (user_id, job_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_saved_searches_on_new_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_saved_searches_on_new_job() TO service_role;

CREATE OR REPLACE FUNCTION public.deliver_saved_search_alert(p_user_id uuid, p_job_id uuid, p_search_name text, p_search_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_ids uuid[];
  v_title TEXT := 'New job matches your saved search';
  v_message TEXT;
  v_link TEXT;
  v_is_urgent BOOLEAN;
BEGIN
  -- FOR SHARE: the job cannot be hired, cancelled or unfunded between this
  -- check and the send. NOWAIT: if a writer (the funding transaction, a hire)
  -- holds the row, this raises lock_not_available instead of waiting, and the
  -- sweep keeps the row for its next run. The sweep never waits on a job.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The job must still be what open_jobs_browse shows this user: open,
  -- funded, not under a live direct offer, not a hidden fixture, not
  -- ownerless (the poster deleted their account), not the recipient's own,
  -- and not above the recipient's credential tier (the view's gate, with
  -- get_user_credential_tier(recipient) in place of my_credential_tier()).
  IF v_job.status <> 'open'
     -- A series visit is re-offered only inside its series (20260927015010).
     OR v_job.parent_job_id IS NOT NULL
     OR COALESCE(v_job.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
     OR (v_job.offered_to_helper_id IS NOT NULL
         AND COALESCE(v_job.direct_offer_status, 'pending') NOT IN ('declined', 'expired'))
     OR (COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly())
     OR v_job.customer_id IS NULL
     OR v_job.customer_id = p_user_id
     OR (COALESCE(v_job.credential_tier, 0) <> 0
         AND COALESCE(public.get_user_credential_tier(p_user_id), 0) < v_job.credential_tier)
     -- Q1411: not while the poster is under an open ban settlement review.
     OR EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = v_job.customer_id AND q.review_state = 'open')
  THEN
    RETURN false;
  END IF;

  -- V-008: never before the job is in this user's feed.
  IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN
    RETURN false;
  END IF;

  -- The recipient must still be verified, active and opted in to job matches.
  PERFORM 1
    FROM public.profiles p
    LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
   WHERE p.user_id = p_user_id
     AND p.email_verified
     AND COALESCE(p.ban_status, 'active') = 'active'
     AND COALESCE(np.job_matches, true) IS TRUE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_is_urgent := COALESCE(v_job.is_urgent, false);

  -- ST-011: the matched searches that still notify and are past the hourly
  -- throttle. None left means this alert is dropped, as a throttled match is.
  -- FOR UPDATE (in id order, so two sends cannot deadlock): a concurrent send
  -- for the same searches waits here, then re-reads last_notified_at after the
  -- first one's stamp commits and finds nothing left. Without the lock both
  -- read the old stamp and both send.
  SELECT ARRAY_AGG(x.id)
    INTO v_ids
    FROM (
      SELECT s.id
        FROM public.saved_searches s
       WHERE s.id = ANY(p_search_ids)
         AND s.user_id = p_user_id
         AND s.notify_enabled = true
         AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
       ORDER BY s.id
         FOR UPDATE
    ) x;
  IF v_ids IS NULL THEN
    RETURN false;
  END IF;

  -- ST-011: the throttle is spent only when the user is actually notified.
  UPDATE public.saved_searches
     SET last_notified_at = now()
   WHERE id = ANY(v_ids); -- ST-011 stamp on notify only

  v_link := '/home?job=' || v_job.id::text;
  v_message :=
    'A new job matches "' || p_search_name || '": '
    || v_job.title || ' ($' || v_job.budget || ')'
    || CASE WHEN v_is_urgent THEN ' · Urgent' ELSE '' END;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (p_user_id, v_title, v_message, 'job_match', v_link);

  PERFORM net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object(
      'user_id', p_user_id,
      'title', v_title,
      'message', v_message,
      'type', 'job_match',
      'link', v_link
    )
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.deliver_saved_search_alert(uuid, uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_saved_search_alert(uuid, uuid, text, uuid[]) TO service_role;

-- Read only by the retired daily-match-digest edge function.
DROP FUNCTION IF EXISTS public.job_match_digest_rows(uuid[]);
