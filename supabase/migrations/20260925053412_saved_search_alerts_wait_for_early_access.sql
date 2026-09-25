-- V-008: a saved-search alert goes out when the job becomes visible to that
-- user under early access, never before (owner decision 2026-09-25: "Yes,
-- delay the alerts").
--
-- The feed hides a job from a caller until created_at + (20 - tier minutes):
-- every browse surface compares against early_access_cutoff(). The saved-search
-- trigger notified at INSERT for every tier, so a free account was told the
-- title and budget up to 20 minutes before its feed showed the job.
--
-- 1. early_access_delay_minutes(user_id) is THE tier ladder (20 minus the
--    minutes the user's active tier earns). early_access_cutoff() and
--    early_access_visible_at() both read it, so the feed and the alert delay
--    cannot disagree. Guard: src/test/savedSearchAlertsWaitForEarlyAccess.test.ts
--    and src/lib/earlyAccess.parity.test.ts (client/SQL parity reads the ladder
--    from here).
-- 2. saved_search_alert_queue holds every non-digest match until the sweep
--    sends it. Server-only: RLS on, no policies, no client privileges.
-- 3. deliver_saved_search_alert() is the one place a saved-search alert is
--    sent (throttle stamp, notifications row, email). It re-checks, at send
--    time, that the job is still open/funded/public with a living poster,
--    that it is visible to the user (early access AND the credential-tier gate
--    open_jobs_browse applies), that the user is still verified/active/opted
--    in, and the hourly throttle (ST-011: the stamp is spent only when an
--    alert is sent). Only the sweep calls it.
-- 4. notify_saved_searches_on_new_job() keeps its match query and digest branch
--    unchanged; every non-digest match is QUEUED, even one already visible
--    (notify_at = visible_at). The trigger runs inside the funding write
--    (stripe-webhook checkout.session.completed sets payment_status =
--    'escrow'), so it takes no saved_searches lock and sends nothing: a lock
--    cycle with the sweep could otherwise cancel the funding transaction.
-- 5. sweep_saved_search_alert_queue(), every minute ('saved-search-alert-queue'),
--    sends rows whose job is now in the user's feed and deletes them. Rows are
--    locked FOR UPDATE SKIP LOCKED and deleted before sending, so overlapping
--    runs cannot send one twice. Rows are taken in (user_id, id) order and
--    deliver locks each user's saved_searches rows in id order, so two runs
--    lock in one order. deliver takes the job row NOWAIT and the run sets a
--    5s lock_timeout, so the sweep never waits on the funding transaction; a
--    send that cannot get its locks stays queued for the next minute. A send
--    that raises anything else is logged to error_logs, its row dropped, and
--    the rest of the run continues. Visibility is recomputed from the user's
--    CURRENT tier on every run, so an upgrade sends sooner and a downgrade
--    waits longer.
--
-- Replay-safe: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT
-- for the liveness row, cron.schedule upserts by name, and every reserved
-- schema touch is guarded.

-- ── 1. the tier ladder, once ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.early_access_delay_minutes(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Mirror of earlyAccessDelayMs() + resolveEarlyAccessTier() in
  -- src/lib/earlyAccess.ts: a 20-minute base, minus the minutes the user's
  -- ACTIVE tier has earned. No profile row (every anonymous caller) is free.
  --
  -- `business` is deliberately absent: the tier was retired on 2026-09-01
  -- (see 20260901010104 and subscriptionTiers.ts) and a stray string must fall
  -- to ELSE 0, losing a perk rather than being handed one.
  SELECT 20 - COALESCE((
    SELECT CASE
             -- Lapsed. Only a STAMPED PAST date lapses: a NULL expiry is an
             -- active grant, matching tierFeePercent / feePercentForTier /
             -- resolveEarlyAccessTier. The cron nulls the TIER on lapse.
             WHEN p.subscription_expires_at IS NOT NULL
                  AND p.subscription_expires_at <= now() THEN 0
             WHEN p.subscription_tier = 'elite' THEN 20
             WHEN p.subscription_tier = 'plus'  THEN 15
             WHEN p.subscription_tier = 'pro'   THEN 10
             WHEN p.subscription_tier = 'basic' THEN 5
             ELSE 0
           END
    FROM public.profiles p
    WHERE p.user_id = p_user_id
  ), 0);
$function$;

-- Any user's tier is private; only the definer functions below call this.
REVOKE ALL ON FUNCTION public.early_access_delay_minutes(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.early_access_cutoff()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Rows created after the returned instant are the caller's early-access
  -- perk; rows at or before it are their feed. The ladder is
  -- early_access_delay_minutes(), shared with early_access_visible_at().
  SELECT now() - make_interval(mins => public.early_access_delay_minutes((SELECT auth.uid())));
$function$;

CREATE OR REPLACE FUNCTION public.early_access_visible_at(p_user_id uuid, p_created_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The instant a job created at p_created_at enters p_user_id's feed:
  -- p_created_at <= early_access_cutoff() for that user exactly when this is
  -- <= now().
  SELECT p_created_at + make_interval(mins => public.early_access_delay_minutes(p_user_id));
$function$;

REVOKE ALL ON FUNCTION public.early_access_visible_at(uuid, timestamp with time zone) FROM PUBLIC, anon, authenticated;

-- ── 2. the queue ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_search_alert_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  notify_at TIMESTAMPTZ NOT NULL,
  search_name TEXT,
  matched_search_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT saved_search_alert_queue_user_job_unique UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_search_alert_queue_notify_at
  ON public.saved_search_alert_queue (notify_at);
CREATE INDEX IF NOT EXISTS idx_saved_search_alert_queue_job_id
  ON public.saved_search_alert_queue (job_id);

-- Server-only. The trigger and the sweep are SECURITY DEFINER; no client role
-- reads or writes this table, and RLS with no policy denies any that tried.
ALTER TABLE public.saved_search_alert_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.saved_search_alert_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.saved_search_alert_queue TO service_role;

COMMENT ON TABLE public.saved_search_alert_queue IS
  'V-008: saved-search alerts waiting for the job to become visible to the user under early access (created_at + early_access_delay_minutes). Sent and deleted by sweep_saved_search_alert_queue() every minute.';

-- ── 3. the one delivery path ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deliver_saved_search_alert(
  p_user_id uuid,
  p_job_id uuid,
  p_search_name text,
  p_search_ids uuid[]
)
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
  v_digest BOOLEAN;
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
     OR COALESCE(v_job.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
     OR (v_job.offered_to_helper_id IS NOT NULL
         AND COALESCE(v_job.direct_offer_status, 'pending') NOT IN ('declined', 'expired'))
     OR (COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly())
     OR v_job.customer_id IS NULL
     OR v_job.customer_id = p_user_id
     OR (COALESCE(v_job.credential_tier, 0) <> 0
         AND COALESCE(public.get_user_credential_tier(p_user_id), 0) < v_job.credential_tier)
  THEN
    RETURN false;
  END IF;

  -- V-008: never before the job is in this user's feed.
  IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN
    RETURN false;
  END IF;

  -- The recipient must still be verified, active and opted in to job matches.
  SELECT COALESCE(np.match_digest_mode, false)
    INTO v_digest
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

  -- Switched to the daily digest while this alert waited: batch it there.
  IF v_digest AND NOT v_is_urgent THEN
    INSERT INTO public.match_digest_queue (user_id, job_id)
    VALUES (p_user_id, p_job_id)
    ON CONFLICT (user_id, job_id) DO NOTHING;
    RETURN false;
  END IF;

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

-- ── 4. the trigger: deliver now, or queue until visible ─────────────────────
CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  match_record RECORD;
  v_is_urgent BOOLEAN;
  v_visible_at TIMESTAMPTZ;
BEGIN
  IF NEW.status <> 'open'
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

  v_is_urgent := COALESCE(NEW.is_urgent, false);

  FOR match_record IN
    SELECT
      s.user_id,
      (ARRAY_AGG(s.name ORDER BY s.created_at DESC))[1] AS search_name,
      ARRAY_AGG(s.id)                                   AS matched_search_ids,
      COALESCE(BOOL_OR(np.match_digest_mode), false)    AS digest_mode
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
      -- ST-011: the hourly throttle stops notification spam, so it applies only
      -- where this job would notify. A digest match is batched by
      -- daily-match-digest already; throttling it dropped later matches.
      AND (
        s.last_notified_at IS NULL
        OR s.last_notified_at < now() - interval '1 hour'
        OR (COALESCE(np.match_digest_mode, false) AND NOT v_is_urgent) -- ST-011 digest unthrottled
      )
    GROUP BY s.user_id
  LOOP
    IF match_record.digest_mode AND NOT v_is_urgent THEN
      INSERT INTO public.match_digest_queue (user_id, job_id)
      VALUES (match_record.user_id, NEW.id)
      ON CONFLICT (user_id, job_id) DO NOTHING;
    ELSE
      -- V-008: queued, never sent here, even when already visible. This
      -- runs inside the funding write; the sweep sends once the job is in
      -- THIS user's feed.
      v_visible_at := public.early_access_visible_at(match_record.user_id, NEW.created_at);
      INSERT INTO public.saved_search_alert_queue (user_id, job_id, notify_at, search_name, matched_search_ids)
      VALUES (match_record.user_id, NEW.id, v_visible_at, match_record.search_name, match_record.matched_search_ids)
      ON CONFLICT (user_id, job_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- ── 5. the sweep ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_saved_search_alert_queue()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_sent integer := 0;
BEGIN
  -- Any lock wait in this run is bounded; a send that hits it stays queued.
  PERFORM set_config('lock_timeout', '5s', true);

  -- Due = the job is in the user's feed by their CURRENT tier (an upgrade
  -- since queueing makes a row due early; notify_at is the estimate made at
  -- queue time). (user_id, id) order: see deliver's saved_searches lock.
  FOR r IN
    SELECT q.id, q.user_id, q.job_id, q.search_name, q.matched_search_ids,
           COALESCE(j.is_seed, false) AS job_is_seed
      FROM public.saved_search_alert_queue q
      JOIN public.jobs j ON j.id = q.job_id
     WHERE public.early_access_visible_at(q.user_id, j.created_at) <= now()
     ORDER BY q.user_id, q.id
     LIMIT 1000
       FOR UPDATE OF q SKIP LOCKED
  LOOP
    BEGIN
      -- Deleted before sending: a second run can never pick this row up
      -- again. deliver_saved_search_alert re-checks the job, the user and the
      -- throttle, so a job cancelled, hired or unfunded meanwhile is dropped
      -- unsent.
      DELETE FROM public.saved_search_alert_queue WHERE id = r.id;
      IF public.deliver_saved_search_alert(r.user_id, r.job_id, r.search_name, r.matched_search_ids) THEN
        v_sent := v_sent + 1;
      END IF;
    EXCEPTION
      WHEN lock_not_available THEN
        -- The job or a saved search is held by another writer (NOWAIT or the
        -- 5s lock_timeout). The block's DELETE rolls back with it, so the row
        -- stays queued and the next run retries it; nothing was sent.
        NULL;
      WHEN OTHERS THEN
        -- One row that raises must not roll back every other send in this
        -- run and then raise again every minute. Only this send's writes roll
        -- back; the row is dropped and the failure goes to error_logs. A seed
        -- (E2E) job's failure is logged under a '-seed' source with
        -- tags.seed, so a fixture never reads as a real delivery failure.
        DELETE FROM public.saved_search_alert_queue WHERE id = r.id;
        INSERT INTO public.error_logs (severity, message, tags)
        VALUES ('error', 'saved-search alert not sent: ' || SQLERRM,
                jsonb_build_object('source', 'saved-search-alert-queue' || CASE WHEN r.job_is_seed THEN '-seed' ELSE '' END,
                                   'area', 'notifications', 'seed', r.job_is_seed,
                                   'job_id', r.job_id, 'user_id', r.user_id));
    END;
  END LOOP;

  RETURN v_sent;
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_saved_search_alert_queue() FROM PUBLIC, anon, authenticated;

-- ── 6. schedule + liveness ──────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('saved-search-alert-queue', interval '15 minutes',
            'V-008: every-minute send of saved-search alerts once the job is visible to the user under early access.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('saved-search-alert-queue', '* * * * *',
                          'SELECT public.sweep_saved_search_alert_queue();');
  END IF;
END
$do$;
