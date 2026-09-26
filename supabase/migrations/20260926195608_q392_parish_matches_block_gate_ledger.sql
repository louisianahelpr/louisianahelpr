-- Q392 (parish half; MORNING QUESTION 29, owner: "A + never twice").
--
-- The parish job-match fan-out now answers to the same three rules as the
-- instant path (20260926193006):
--
--   1. The browse gate: public.job_announceable_to(job, user) decides, at
--      queue time and again at send time (it replaces the predicates
--      deliver_parish_match_alert spelled out: open, a living poster who is
--      not the recipient, funded, no live direct offer, not a hidden fixture,
--      credential tier).
--   2. Blocks, both ways: a user who blocked the poster, or whom the poster
--      blocked, is never told (open_jobs_browse hides blocked posters too).
--   3. Never twice: every parish send writes a source='parish' row into the
--      permanent ledger public.job_match_queue (status 'sent', or 'dropped'
--      when the seed boundary suppressed the notification). A send is
--      refused when the ledger already holds a row for that (user, job) from
--      EITHER source, so a job that is hired, reopened and re-funded, or a
--      notification the user deleted, never produces a second announcement.
--      The ledger row is claimed with INSERT .. ON CONFLICT DO NOTHING
--      RETURNING under the (user_id, job_id) unique constraint, so a parish
--      send racing an instant enqueue cannot both win.
--
-- Unchanged: the queue-only send path (notify_helpers_on_job_post only
-- queues; nothing is sent inside the funding write), the early-access clock,
-- the recipient checks, N-007's hourly cap, and sweep_saved_search_alert_queue,
-- which already deletes each parish row before calling
-- deliver_parish_match_alert and so needs no change: every new rule lives in
-- deliver (the only parish send path) and, as a pre-filter, in the fan-out.
--
-- Replay-safe: CREATE OR REPLACE only; job_match_queue and
-- job_announceable_to come from 20260926193006, which precedes this file.

-- ── 1. the one parish delivery path ────────────────────────────────────────
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
  v_ledger uuid;
  v_notified uuid;
BEGIN
  -- FOR SHARE NOWAIT: the job cannot be hired, cancelled or unfunded between
  -- this check and the send, and the sweep never waits on the funding write.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Still a parish job, and still what open_jobs_browse shows this user.
  IF v_job.parish IS NULL OR NOT public.job_announceable_to(v_job, p_user_id) THEN
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

  -- Q392: a block either way stops the send.
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
     WHERE (b.blocker_id = v_job.customer_id AND b.blocked_id = p_user_id)
        OR (b.blocker_id = p_user_id AND b.blocked_id = v_job.customer_id)
  ) THEN
    RETURN false;
  END IF;

  -- Q392 (MQ29, never twice): the ledger decides, whichever source wrote it.
  IF EXISTS (
    SELECT 1 FROM public.job_match_queue l
     WHERE l.user_id = p_user_id AND l.job_id = p_job_id
  ) THEN
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

  -- Claim the (user, job) ledger slot first. A concurrent claim from either
  -- source wins the unique constraint and this send stands down.
  INSERT INTO public.job_match_queue
    (user_id, job_id, source, notify_at, title, message, link, send_email, status, settled_at)
  VALUES
    (p_user_id, v_job.id, 'parish', public.early_access_visible_at(p_user_id, v_job.created_at),
     v_title, v_message, v_link, true, 'sent', now())
  ON CONFLICT (user_id, job_id) DO NOTHING
  RETURNING id INTO v_ledger;
  IF v_ledger IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (p_user_id, v_title, v_message, 'job_match', v_link, v_job.id)
  RETURNING id INTO v_notified;

  -- trg_notifications_seed_boundary can suppress the row (a seed job, a real
  -- recipient): nothing was delivered, so the ledger says dropped, not sent,
  -- and no email goes out.
  IF v_notified IS NULL THEN
    UPDATE public.job_match_queue
       SET status = 'dropped', drop_reason = 'suppressed by the seed boundary'
     WHERE id = v_ledger;
    RETURN false;
  END IF;

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

-- ── 2. the fan-out: queue only ──────────────────────────────────────────────
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
      -- Q392: the browse gate (open, a living poster who is not this user,
      -- funded, no live offer, not a hidden fixture, credential tier).
      AND public.job_announceable_to(NEW, c.user_id)
      -- Q392: a block either way.
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
         WHERE (b.blocker_id = NEW.customer_id AND b.blocked_id = c.user_id)
            OR (b.blocker_id = c.user_id AND b.blocked_id = NEW.customer_id)
      )
      -- Q392 (MQ29, never twice): already in the ledger from either source.
      AND NOT EXISTS (
        SELECT 1 FROM public.job_match_queue l
         WHERE l.user_id = c.user_id AND l.job_id = NEW.id
      )
      -- 'Job Matches' switch (not 'Job Offers', 2026-09-11). Unset means on.
      AND COALESCE(np.job_matches, true) IS TRUE
      -- Digest mode stands down; sweep_daily_job_digest covers them.
      AND COALESCE(np.match_digest_mode, false) IS FALSE
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
    -- user's feed, and deliver_parish_match_alert re-checks every predicate
    -- above (and claims the ledger row) at send time.
    INSERT INTO public.parish_match_alert_queue (user_id, job_id, notify_at)
    VALUES (helper_record.helper_id, NEW.id, public.early_access_visible_at(helper_record.helper_id, NEW.created_at))
    ON CONFLICT (user_id, job_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.job_match_queue IS
  'Q392: job-match notifications, instant (queued here, sent by deliver_job_match) and parish (recorded here by deliver_parish_match_alert when it sends). One row per (user_id, job_id), kept after it settles: it is the never-twice ledger for both sources.';
