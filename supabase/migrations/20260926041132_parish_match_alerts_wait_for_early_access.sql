-- Q225 / V-008, the job-match half (2026-09-26).
--
-- MEASURED LIVE (prod, 2026-09-26 03:44Z, is_seed probe job 461941a5, cleaned
-- up after): a free account (early_access_delay_minutes = 20) received
--   job_match 'New job in your parish' ... "<title>"   at 03:44:11 (funding)
--   job_match 'New job matches your saved search'     at 04:05:00 (queued)
-- The saved-search half of V-008 (20260925053412) waits for early access; the
-- parish fan-out, notify_helpers_on_job_post(), still told every tier the
-- title the instant the job was funded, up to 20 minutes before the free
-- user's feed shows it (every browse surface hides a job until
-- created_at <= early_access_cutoff()).
--
-- Same shape as the saved-search fix, on its own queue so the saved-search
-- trigger (which runs inside stripe-webhook's escrow write) is untouched:
--   1. parish_match_alert_queue: one row per (user, job), due at
--      early_access_visible_at(user, job.created_at).
--   2. deliver_parish_match_alert(user, job): the ONE send path. Locks the job
--      FOR SHARE NOWAIT and re-checks, at send time, everything the fan-out
--      checked at queue time plus visibility: job still open, funded, no live
--      direct offer, not a hidden fixture, not ownerless, not the recipient's
--      own, within the recipient's credential tier, visible to them now; the
--      recipient verified, active, opted in to job matches and not in digest
--      mode; N-007 once per (job, Helpr) and the hourly cap of 10.
--   3. notify_helpers_on_job_post(): only QUEUES (restated from the newest
--      definition, 20260924220318, with the same candidate predicates).
--   4. sweep_saved_search_alert_queue(): restated from 20260925053412; after
--      the saved-search rows it sends the due parish rows, same locking and
--      error handling. No new cron: the every-minute
--      'saved-search-alert-queue' job already runs it.
--
-- Replay-safe: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, and the
-- trigger functions are replaced in place (the triggers themselves are not
-- recreated). Server-only table: RLS on, no policy, no client grant.

-- ── 1. the queue ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parish_match_alert_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  notify_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT parish_match_alert_queue_user_job_unique UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_parish_match_alert_queue_notify_at
  ON public.parish_match_alert_queue (notify_at);
CREATE INDEX IF NOT EXISTS idx_parish_match_alert_queue_job_id
  ON public.parish_match_alert_queue (job_id);

ALTER TABLE public.parish_match_alert_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parish_match_alert_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.parish_match_alert_queue TO service_role;

COMMENT ON TABLE public.parish_match_alert_queue IS
  'V-008 (Q225): parish job-match alerts waiting for the job to become visible to the user under early access. Sent and deleted by sweep_saved_search_alert_queue() every minute.';

-- ── 2. the one delivery path ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deliver_parish_match_alert(
  p_user_id uuid,
  p_job_id uuid
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_title TEXT := 'New job in your parish';
  v_message TEXT;
  v_link TEXT;
BEGIN
  -- FOR SHARE NOWAIT: the job cannot be hired, cancelled or unfunded between
  -- this check and the send, and the sweep never waits on the funding write.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Still what open_jobs_browse shows this user, and still a parish job.
  IF v_job.status <> 'open'
     OR v_job.parish IS NULL
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

  -- The recipient: verified, active, opted in, not batching (digest mode is
  -- covered by sweep_daily_job_digest, exactly as the fan-out stood down).
  PERFORM 1
     FROM public.profiles p
     LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
    WHERE p.user_id = p_user_id
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND COALESCE(np.job_matches, true) IS TRUE
      AND COALESCE(np.match_digest_mode, false) IS FALSE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- N-007 at send time: once per (job, Helpr) (a saved-search alert for the
  -- same job counts), and at most 10 job matches per Helpr per hour.
  IF EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = p_user_id AND n.job_id = p_job_id AND n.type = 'job_match'
     )
     OR (
       SELECT count(*) FROM public.notifications n
        WHERE n.user_id = p_user_id AND n.type = 'job_match'
          AND n.created_at > now() - interval '1 hour'
     ) >= 10
  THEN
    RETURN false;
  END IF;

  v_message := 'A new ' || COALESCE(v_job.category::text, 'job') || ' job just posted in ' || v_job.parish || ' Parish: "' || v_job.title || '"';
  v_link := '/home?job=' || v_job.id::text;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (p_user_id, v_title, v_message, 'job_match', v_link, v_job.id);

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
      'link', v_link,
      'job_id', v_job.id
    )
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.deliver_parish_match_alert(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_parish_match_alert(uuid, uuid) TO service_role;

-- ── 3. the fan-out: queue only ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  helper_record RECORD;
BEGIN
  IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  -- The triggers' WHEN clauses already guarantee funded, so this is a
  -- belt-and-braces re-assertion for any future direct call.
  IF COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]) THEN
    RETURN NEW;
  END IF;

  -- A job under a LIVE direct offer is addressed mail, not open-pool work.
  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  -- Fixtures, on the same authority the browse surfaces use.
  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  FOR helper_record IN
    WITH candidates AS (
      SELECT p2.user_id
      FROM public.profiles p2
      WHERE p2.parish = NEW.parish
        AND (
          EXISTS (SELECT 1 FROM public.applications a WHERE a.helper_id = p2.user_id)
          OR EXISTS (SELECT 1 FROM public.jobs j2 WHERE j2.helper_id = p2.user_id)
        )
    )
    SELECT DISTINCT c.user_id AS helper_id
    FROM candidates c
    JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = c.user_id
    WHERE p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND c.user_id <> NEW.customer_id
      -- 'Job Matches' switch (not 'Job Offers', 2026-09-11). Unset means on.
      AND COALESCE(np.job_matches, true) IS TRUE
      -- Digest mode stands down; sweep_daily_job_digest covers them.
      AND COALESCE(np.match_digest_mode, false) IS FALSE
      -- CREDENTIAL GATE (20260905201818).
      AND (
        COALESCE(NEW.credential_tier, 0) = 0
        OR COALESCE(public.get_user_credential_tier(c.user_id), 0) >= NEW.credential_tier
      )
      -- N-007: once per (job, Helpr). A funded job that leaves 'open' and comes
      -- back re-fires this trigger; it must not re-notify the whole parish.
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.user_id = c.user_id AND n.job_id = NEW.id AND n.type = 'job_match'
      )  -- N-007 once per job
      -- N-007: at most 10 parish matches per Helpr per hour (measured peak on
      -- prod 2026-09-24: 4). Past it the job is still on their browse feed.
      AND (
        SELECT count(*) FROM public.notifications n
         WHERE n.user_id = c.user_id AND n.type = 'job_match'
           AND n.created_at > now() - interval '1 hour'
      ) < 10  -- N-007 hourly cap
  LOOP
    -- V-008: queued, never sent here, even when already visible. This runs
    -- inside the funding write; the sweep sends once the job is in THIS
    -- user's feed, and re-checks every predicate above at send time.
    INSERT INTO public.parish_match_alert_queue (user_id, job_id, notify_at)
    VALUES (helper_record.helper_id, NEW.id, public.early_access_visible_at(helper_record.helper_id, NEW.created_at))
    ON CONFLICT (user_id, job_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post() FROM PUBLIC, anon, authenticated;

-- ── 4. the sweep sends both queues ──────────────────────────────────────────
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

  -- Q225: the parish job-match queue, same rules. (user_id, id) order keeps
  -- two runs from taking the same user's rows in opposite orders.
  FOR r IN
    SELECT q.id, q.user_id, q.job_id,
           COALESCE(j.is_seed, false) AS job_is_seed
      FROM public.parish_match_alert_queue q
      JOIN public.jobs j ON j.id = q.job_id
     WHERE public.early_access_visible_at(q.user_id, j.created_at) <= now()
     ORDER BY q.user_id, q.id
     LIMIT 1000
       FOR UPDATE OF q SKIP LOCKED
  LOOP
    BEGIN
      DELETE FROM public.parish_match_alert_queue WHERE id = r.id;
      IF public.deliver_parish_match_alert(r.user_id, r.job_id) THEN
        v_sent := v_sent + 1;
      END IF;
    EXCEPTION
      WHEN lock_not_available THEN
        NULL;
      WHEN OTHERS THEN
        DELETE FROM public.parish_match_alert_queue WHERE id = r.id;
        INSERT INTO public.error_logs (severity, message, tags)
        VALUES ('error', 'parish job-match alert not sent: ' || SQLERRM,
                jsonb_build_object('source', 'parish-match-alert-queue' || CASE WHEN r.job_is_seed THEN '-seed' ELSE '' END,
                                   'area', 'notifications', 'seed', r.job_is_seed,
                                   'job_id', r.job_id, 'user_id', r.user_id));
    END;
  END LOOP;

  RETURN v_sent;
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_saved_search_alert_queue() FROM PUBLIC, anon, authenticated;
