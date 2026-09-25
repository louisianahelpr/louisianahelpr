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
-- 2. saved_search_alert_queue holds an alert whose visible_at is still in the
--    future. Server-only: RLS on, no policies, no client privileges.
-- 3. deliver_saved_search_alert() is the one place a saved-search alert is
--    sent (throttle stamp, notifications row, email). It re-checks, at send
--    time, that the job is still open/funded/public, that it is visible to the
--    user, that the user is still verified/active/opted in, and the hourly
--    throttle (ST-011: the stamp is spent only when an alert is sent).
-- 4. notify_saved_searches_on_new_job() keeps its match query and digest branch
--    unchanged; a non-digest match is delivered now when visible_at <= now(),
--    else queued.
-- 5. sweep_saved_search_alert_queue(), every minute ('saved-search-alert-queue'),
--    sends due rows and deletes them. Rows are locked FOR UPDATE SKIP LOCKED
--    and deleted before sending, so overlapping runs cannot send one twice.
--    visible_at is recomputed from the user's CURRENT tier on every run, so an
--    upgrade sends sooner and a downgrade waits longer.
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
  -- check and the send.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The job must still be what notify_saved_searches_on_new_job alerts on:
  -- open, funded, not under a live direct offer, not a hidden fixture, and
  -- not the recipient's own.
  IF v_job.status <> 'open'
     OR COALESCE(v_job.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
     OR (v_job.offered_to_helper_id IS NOT NULL
         AND COALESCE(v_job.direct_offer_status, 'pending') NOT IN ('declined', 'expired'))
     OR (COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly())
     OR v_job.customer_id IS NOT DISTINCT FROM p_user_id
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
  SELECT ARRAY_AGG(s.id)
    INTO v_ids
    FROM public.saved_searches s
   WHERE s.id = ANY(p_search_ids)
     AND s.user_id = p_user_id
     AND s.notify_enabled = true
     AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour');
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
      -- V-008: the alert goes out when the job enters THIS user's feed.
      v_visible_at := public.early_access_visible_at(match_record.user_id, NEW.created_at);
      IF v_visible_at <= now() THEN
        PERFORM public.deliver_saved_search_alert(
          match_record.user_id, NEW.id, match_record.search_name, match_record.matched_search_ids);
      ELSE
        INSERT INTO public.saved_search_alert_queue (user_id, job_id, notify_at, search_name, matched_search_ids)
        VALUES (match_record.user_id, NEW.id, v_visible_at, match_record.search_name, match_record.matched_search_ids)
        ON CONFLICT (user_id, job_id) DO NOTHING;
      END IF;
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
  v_visible_at TIMESTAMPTZ;
  v_sent integer := 0;
BEGIN
  -- Every row is read, not only notify_at <= now(): visible_at follows the
  -- user's CURRENT tier, so an upgrade since queueing makes a row due early.
  -- The queue holds at most ~20 minutes of matches.
  FOR r IN
    SELECT q.id, q.user_id, q.job_id, q.notify_at, q.search_name, q.matched_search_ids,
           j.created_at AS job_created_at
      FROM public.saved_search_alert_queue q
      JOIN public.jobs j ON j.id = q.job_id
     ORDER BY q.notify_at
     LIMIT 1000
       FOR UPDATE OF q SKIP LOCKED
  LOOP
    v_visible_at := public.early_access_visible_at(r.user_id, r.job_created_at);
    IF v_visible_at > now() THEN
      -- Not in the feed yet (a downgrade may have moved it later): keep it.
      IF v_visible_at IS DISTINCT FROM r.notify_at THEN
        UPDATE public.saved_search_alert_queue SET notify_at = v_visible_at WHERE id = r.id;
      END IF;
      CONTINUE;
    END IF;

    -- Deleted before sending: a second run can never pick this row up again.
    -- deliver_saved_search_alert re-checks the job, the user and the throttle,
    -- so a job cancelled, hired or unfunded meanwhile is dropped unsent.
    DELETE FROM public.saved_search_alert_queue WHERE id = r.id;
    IF public.deliver_saved_search_alert(r.user_id, r.job_id, r.search_name, r.matched_search_ids) THEN
      v_sent := v_sent + 1;
    END IF;
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
