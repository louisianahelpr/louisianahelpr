-- Q392: a job-match notification reaches a user only when the job is in that
-- user's browse feed, and only once per (job, user).
--
-- WHAT WAS BROKEN
--   instant-job-match (the edge function stripe-webhook calls after funding)
--   inserted "Match for you: <title> in <area> · $<budget>" for up to 20
--   users the moment escrow was funded. Every browse surface hides that job
--   from a user until created_at + early_access_delay_minutes(user) (20
--   minutes for a free account) and hides a credential-gated job from a user
--   below its credential_tier (open_jobs_browse via my_credential_tier() =
--   get_user_credential_tier(auth.uid())). The match ignored both: a free
--   account learned the title and budget up to 20 minutes before its feed
--   showed the job, and a user with no credentials was told about a job they
--   could never open. Nothing deduped it either: the poster could call the
--   endpoint again (20/min/IP) and re-notify every matched user each time.
--   The same class had two more members: the parish fan-out
--   (notify_helpers_on_job_post) ignored early access, and the daily parish
--   digest (sweep_daily_job_digest) counted unfunded, ownerless, offered and
--   not-yet-visible jobs.
--
-- WHAT THIS DOES
--   1. job_announceable_to(job, user) is the open_jobs_browse gate for one
--      recipient who is not a party to the job, minus the clock: open,
--      funded, a living poster who is not the recipient, no live direct
--      offer, not a hidden fixture, and not above the recipient's credential
--      tier. Every job_match producer asks it; the clock is
--      early_access_visible_at(user, created_at) <= now(), the one ladder the
--      feed also reads (20260925053412).
--   2. job_match_queue holds each instant or parish match until the job is in
--      that user's feed. UNIQUE (user_id, job_id) is the server-side dedupe:
--      a row is never deleted when it settles (status sent / digested /
--      dropped), so a re-trigger inserts nothing and notifies nobody twice.
--      It cascades away with the job or the user. Server-only.
--   3. enqueue_instant_job_match(job, matches) is what the edge function now
--      calls instead of inserting notifications itself. It takes the scored
--      matches in rank order, keeps the first 20 the gate admits (already
--      queued ones count, so a re-trigger cannot reach past the top 20),
--      queues them, and sends the ones already visible at once.
--   4. deliver_job_match(id) is the one send path for the queue. At send time
--      it re-checks the gate, the clock, the recipient (verified, active,
--      Job Matches on, no block either way with the poster) and that nobody
--      already told this user about this job (a job_match row carrying
--      job_id: the parish fan-out and the instant match now dedupe against
--      each other). Digest-mode users get the daily digest instead.
--   5. sweep_job_match_queue(), every minute ('job-match-queue'), sends rows
--      that have become visible. FOR UPDATE SKIP LOCKED, NOWAIT on the job and
--      a 5s lock_timeout, as the saved-search sweep: it never waits on the
--      funding transaction, and a row it cannot lock stays queued.
--   6. notify_helpers_on_job_post asks the gate, sends inline only to users
--      the job is already visible to, and queues the rest.
--   7. sweep_daily_job_digest counts only jobs the gate admits and the
--      recipient can already see.
--   8. job_match_digest_rows(ids) lets daily-match-digest re-check its queued
--      rows at digest time (a job hired since it was queued is not sent).
--
-- Guards: src/test/jobAnnouncementsApplyBrowseGate.test.ts (the class: every
-- job_match producer asks the gate and the clock) and
-- src/test/pglite/jobMatchesWaitForEarlyAccess.pglite.mjs (behaviour; RED on
-- the previous definitions).
--
-- Replay-safe: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, ON
-- CONFLICT for the liveness row, cron.schedule upserts by name, and every
-- reserved-schema touch is guarded.

-- ── 1. the gate, once ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.job_announceable_to(p_job public.jobs, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- open_jobs_browse's WHERE for a recipient who is neither the poster nor
  -- the offered helper, with get_user_credential_tier(recipient) in place of
  -- my_credential_tier(). The early-access clock is NOT here: a caller that
  -- may queue asks early_access_visible_at() itself.
  SELECT COALESCE(
        p_user_id IS NOT NULL
    AND p_job.status = 'open'
    AND p_job.customer_id IS NOT NULL
    AND p_job.customer_id <> p_user_id
    AND COALESCE(p_job.payment_status, '') = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND (p_job.offered_to_helper_id IS NULL
         OR COALESCE(p_job.direct_offer_status, 'pending') IN ('declined', 'expired'))
    AND (NOT COALESCE(p_job.is_seed, false) OR NOT public.seed_jobs_hidden_publicly())
    AND (COALESCE(p_job.credential_tier, 0) = 0
         OR COALESCE(public.get_user_credential_tier(p_user_id), 0) >= p_job.credential_tier),
    false);
$function$;

REVOKE ALL ON FUNCTION public.job_announceable_to(public.jobs, uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. the queue (and the dedupe ledger) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_match_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('instant', 'parish')),
  notify_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT NOT NULL,
  send_email BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'digested', 'dropped')),
  drop_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,
  CONSTRAINT job_match_queue_user_job_unique UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_job_match_queue_queued
  ON public.job_match_queue (notify_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_job_match_queue_job_id
  ON public.job_match_queue (job_id);

ALTER TABLE public.job_match_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_match_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_match_queue TO service_role;

COMMENT ON TABLE public.job_match_queue IS
  'Q392: instant and parish job-match notifications, held until the job is visible to the user under early access and the browse gate (job_announceable_to). One row per (user_id, job_id), kept after it settles: it is the dedupe ledger. Sent by deliver_job_match().';

-- ── 3. the one send path for queued matches ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.deliver_job_match(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.job_match_queue%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_digest BOOLEAN;
  v_reason TEXT;
BEGIN
  SELECT * INTO r FROM public.job_match_queue
   WHERE id = p_id AND status = 'queued'
     FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- FOR SHARE: the job cannot be hired, cancelled or unfunded between this
  -- check and the send. NOWAIT: a writer holding the row (the funding
  -- transaction, a hire) raises lock_not_available and the row stays queued.
  SELECT * INTO v_job FROM public.jobs WHERE id = r.job_id FOR SHARE NOWAIT;

  IF NOT public.job_announceable_to(v_job, r.user_id) THEN
    v_reason := 'not in the recipient''s browse feed';
  END IF;

  -- Q392: never before the job is in this user's feed. Not a drop: it waits.
  IF v_reason IS NULL AND public.early_access_visible_at(r.user_id, v_job.created_at) > now() THEN
    RETURN false;
  END IF;

  IF v_reason IS NULL THEN
    SELECT COALESCE(np.match_digest_mode, false)
      INTO v_digest
      FROM public.profiles p
      LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
     WHERE p.user_id = r.user_id
       AND p.email_verified
       AND COALESCE(p.ban_status, 'active') = 'active'
       AND COALESCE(np.job_matches, true) IS TRUE;
    IF NOT FOUND THEN
      v_reason := 'recipient not eligible (unverified, restricted or Job Matches off)';
    END IF;
  END IF;

  IF v_reason IS NULL AND EXISTS (
    SELECT 1 FROM public.user_blocks b
     WHERE (b.blocker_id = v_job.customer_id AND b.blocked_id = r.user_id)
        OR (b.blocker_id = r.user_id AND b.blocked_id = v_job.customer_id)
  ) THEN
    v_reason := 'a block stands between the two accounts';
  END IF;

  -- One job_match per (job, user), whichever producer got there first.
  IF v_reason IS NULL AND EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.user_id = r.user_id AND n.job_id = r.job_id AND n.type = 'job_match'
  ) THEN
    v_reason := 'already notified about this job';
  END IF;

  -- The parish fan-out's N-007 hourly cap, applied when its row is sent.
  IF v_reason IS NULL AND r.source = 'parish' AND (
    SELECT count(*) FROM public.notifications n
     WHERE n.user_id = r.user_id AND n.type = 'job_match'
       AND n.created_at > now() - interval '1 hour'
  ) >= 10 THEN
    v_reason := 'hourly job_match cap';
  END IF;

  IF v_reason IS NULL AND v_digest AND NOT COALESCE(v_job.is_urgent, false) THEN
    IF r.source = 'parish' THEN
      -- The parish fan-out never pings a digest user; sweep_daily_job_digest covers them.
      v_reason := 'digest mode (parish digest covers it)';
    ELSE
      INSERT INTO public.match_digest_queue (user_id, job_id)
      VALUES (r.user_id, r.job_id)
      ON CONFLICT (user_id, job_id) DO NOTHING;
      UPDATE public.job_match_queue SET status = 'digested', settled_at = now() WHERE id = r.id;
      RETURN false;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.job_match_queue
       SET status = 'dropped', drop_reason = v_reason, settled_at = now()
     WHERE id = r.id;
    RETURN false;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (r.user_id, r.title, r.message, 'job_match', r.link, r.job_id);

  IF r.send_email THEN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', r.user_id,
        'title', r.title,
        'message', r.message,
        'type', 'job_match',
        'link', r.link
      )
    );
  END IF;

  UPDATE public.job_match_queue SET status = 'sent', settled_at = now() WHERE id = r.id;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.deliver_job_match(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. what instant-job-match calls ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_instant_job_match(p_job_id uuid, p_matches jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs%ROWTYPE;
  m jsonb;
  v_uid uuid;
  v_id uuid;
  v_eligible integer := 0;
  v_queued integer := 0;
  v_already integer := 0;
  v_sent integer := 0;
  v_limit CONSTANT integer := 20;
BEGIN
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' THEN
    RAISE EXCEPTION 'p_matches must be a JSON array';
  END IF;

  -- FOR SHARE: the gate below decides what is queued, so the job cannot be
  -- hired, cancelled or unfunded mid-scan. The webhook calls this after the
  -- funding transaction has committed; a sweep that meets this lock gets
  -- lock_not_available (NOWAIT) and retries its row next minute.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', 0, 'queued', 0, 'already', 0, 'sent_now', 0);
  END IF;

  FOR m IN
    SELECT e.value FROM jsonb_array_elements(p_matches) WITH ORDINALITY AS e(value, ord) ORDER BY e.ord
  LOOP
    EXIT WHEN v_eligible >= v_limit;
    v_uid := NULLIF(m->>'user_id', '')::uuid;
    CONTINUE WHEN v_uid IS NULL OR NOT public.job_announceable_to(v_job, v_uid);
    -- An in-app path only: '/x', never '//host' (protocol-relative) or a URL.
    IF NULLIF(m->>'title', '') IS NULL OR NULLIF(m->>'message', '') IS NULL
       OR left(COALESCE(m->>'link', ''), 1) <> '/' OR left(m->>'link', 2) = '//' OR strpos(m->>'link', '://') > 0 THEN
      RAISE EXCEPTION 'match for % has no title, message or in-app link', v_uid;
    END IF;
    v_eligible := v_eligible + 1;

    v_id := NULL;
    INSERT INTO public.job_match_queue (user_id, job_id, source, notify_at, title, message, link)
    VALUES (v_uid, v_job.id, 'instant', public.early_access_visible_at(v_uid, v_job.created_at),
            m->>'title', m->>'message', m->>'link')
    ON CONFLICT (user_id, job_id) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      -- Q392 dedupe: already queued or settled for this (job, user).
      v_already := v_already + 1;
      CONTINUE;
    END IF;
    v_queued := v_queued + 1;

    -- Already in this user's feed: send now. A send that cannot get its locks
    -- (or raises) leaves the row queued for the every-minute sweep.
    IF public.early_access_visible_at(v_uid, v_job.created_at) <= now() THEN
      BEGIN
        IF public.deliver_job_match(v_id) THEN
          v_sent := v_sent + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'enqueue_instant_job_match: % left queued: %', v_id, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('eligible', v_eligible, 'queued', v_queued, 'already', v_already, 'sent_now', v_sent);
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_instant_job_match(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_instant_job_match(uuid, jsonb) TO service_role;

-- ── 5. the sweep ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_job_match_queue()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_sent integer := 0;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- Due = the job is in the user's feed by their CURRENT tier. (user_id, id)
  -- order, as the saved-search sweep, so overlapping runs lock in one order.
  FOR r IN
    SELECT q.id, q.user_id, q.job_id, COALESCE(j.is_seed, false) AS job_is_seed
      FROM public.job_match_queue q
      JOIN public.jobs j ON j.id = q.job_id
     WHERE q.status = 'queued'
       AND public.early_access_visible_at(q.user_id, j.created_at) <= now()
     ORDER BY q.user_id, q.id
     LIMIT 1000
       FOR UPDATE OF q SKIP LOCKED
  LOOP
    BEGIN
      IF public.deliver_job_match(r.id) THEN
        v_sent := v_sent + 1;
      END IF;
    EXCEPTION
      WHEN lock_not_available THEN
        -- The job is held by another writer: the row stays queued.
        NULL;
      WHEN OTHERS THEN
        -- Only this send rolls back; the row is dropped (never re-sent every
        -- minute) and the failure is logged. A seed job logs under '-seed'.
        UPDATE public.job_match_queue
           SET status = 'dropped', drop_reason = 'error: ' || SQLERRM, settled_at = now()
         WHERE id = r.id;
        INSERT INTO public.error_logs (severity, message, tags)
        VALUES ('error', 'job match not sent: ' || SQLERRM,
                jsonb_build_object('source', 'job-match-queue' || CASE WHEN r.job_is_seed THEN '-seed' ELSE '' END,
                                   'area', 'notifications', 'seed', r.job_is_seed,
                                   'job_id', r.job_id, 'user_id', r.user_id));
    END;
  END LOOP;

  RETURN v_sent;
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_job_match_queue() FROM PUBLIC, anon, authenticated;

-- ── 6. the parish fan-out: the gate, and a queue for not-yet-visible users ──
CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  helper_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
  v_visible_at TIMESTAMPTZ;
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

  v_title := 'New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/home?job=' || NEW.id::text;

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
      -- CHANGED 2026-09-11. This read `np.new_offers`, which is the switch
      -- labelled "Job Offers" on the prefs screen and belongs to DIRECT
      -- offers. Unset still means on: most accounts have no preferences row.
      AND COALESCE(np.job_matches, true) IS TRUE
      -- Digest mode is an explicit "batch these, don't ping me". This producer
      -- stands down and sweep_daily_job_digest covers them.
      AND COALESCE(np.match_digest_mode, false) IS FALSE
      -- Q392: the browse gate for this recipient (ownerless, credential tier,
      -- funded, offer, fixture), the one open_jobs_browse applies.
      AND public.job_announceable_to(NEW, c.user_id)
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
    -- Q392: early access. Not yet in this user's feed: queue it (no send and
    -- no lock inside the funding write); the sweep sends it when it is.
    v_visible_at := public.early_access_visible_at(helper_record.helper_id, NEW.created_at);
    IF v_visible_at > now() THEN
      INSERT INTO public.job_match_queue (user_id, job_id, source, notify_at, title, message, link, send_email)
      VALUES (helper_record.helper_id, NEW.id, 'parish', v_visible_at, v_title, v_message, v_link, true)
      ON CONFLICT (user_id, job_id) DO NOTHING;
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (helper_record.helper_id, v_title, v_message, 'job_match', v_link, NEW.id);

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', helper_record.helper_id,
        'title', v_title,
        'message', v_message,
        'type', 'job_match',
        'link', v_link
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

-- ── 7. the daily parish digest counts only what the recipient can see ───────
CREATE OR REPLACE FUNCTION public.sweep_daily_job_digest()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_sent integer := 0;
  budget_lo integer;
  budget_hi integer;
BEGIN
  FOR rec IN
    WITH new_jobs AS (
      SELECT j AS job, j.id, j.parish, j.budget, j.created_at, COALESCE(j.is_seed, false) AS is_seed
      FROM public.jobs j
      WHERE j.status = 'open'
        AND j.created_at > NOW() - INTERVAL '24 hours'
        AND j.parish IS NOT NULL
        AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    )
    SELECT
      p.user_id,
      p.parish,
      pc.cnt,
      pc.min_budget,
      pc.max_budget
    FROM public.profiles p
    LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*)        AS cnt,
        MIN(nj.budget)  AS min_budget,
        MAX(nj.budget)  AS max_budget
      FROM new_jobs nj
      WHERE nj.parish = p.parish
        -- Q392: the browse gate (funded, living poster not the recipient, no
        -- live offer, credential tier) and the early-access clock.
        AND public.job_announceable_to(nj.job, p.user_id)
        AND public.early_access_visible_at(p.user_id, nj.created_at) <= now()
        -- Q137: a seed job is news only to a seed account.
        AND (NOT nj.is_seed OR COALESCE(p.is_seed, false))
    ) pc
    WHERE p.parish IS NOT NULL
      AND pc.cnt > 0
      AND p.email_verified
      AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
      AND (np.user_id IS NULL OR COALESCE(np.job_matches, true) IS TRUE)
      AND EXISTS (
        SELECT 1 FROM public.applications WHERE helper_id = p.user_id
        UNION ALL
        SELECT 1 FROM public.jobs WHERE customer_id = p.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = p.user_id
          AND n.title LIKE 'New jobs in%'
          AND n.created_at > NOW() - INTERVAL '23 hours'
      )
  LOOP
    BEGIN
      budget_lo := FLOOR(rec.min_budget)::integer;
      budget_hi := CEIL(rec.max_budget)::integer;
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.user_id,
        'job_match',
        format('New jobs in %s', rec.parish),
        format(
          '%s new %s posted in the last 24 hours — %s. Tap to browse.',
          rec.cnt,
          CASE WHEN rec.cnt = 1 THEN 'job' ELSE 'jobs' END,
          CASE
            WHEN budget_lo = budget_hi THEN format('$%s', budget_lo)
            ELSE format('$%s to $%s', budget_lo, budget_hi)
          END
        ),
        '/home',
        false
      );
      total_sent := total_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_daily_job_digest', rec.user_id::text, SQLERRM,
        jsonb_build_object('user_id', rec.user_id, 'parish', rec.parish));
      RAISE NOTICE 'sweep_daily_job_digest: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN total_sent;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_daily_job_digest', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'sent_before_failure', total_sent));
  RETURN total_sent;
END;
$function$;

-- ── 8. daily-match-digest re-checks its rows at digest time ─────────────────
CREATE OR REPLACE FUNCTION public.job_match_digest_rows(p_queue_ids uuid[])
 RETURNS TABLE(id uuid, send boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- send = true: still in the recipient's feed, summarise it.
  -- send = false: no longer announceable (hired, cancelled, unfunded,
  --   ownerless, above their tier, or the job is gone): drain it unsent.
  -- Not returned: announceable but not yet visible to them; keep it queued.
  SELECT q.id,
         (j.id IS NOT NULL AND public.job_announceable_to(j, q.user_id)) AS send
    FROM public.match_digest_queue q
    LEFT JOIN public.jobs j ON j.id = q.job_id
   WHERE q.id = ANY(p_queue_ids)
     AND NOT (j.id IS NOT NULL
              AND public.job_announceable_to(j, q.user_id)
              AND public.early_access_visible_at(q.user_id, j.created_at) > now());
$function$;

REVOKE ALL ON FUNCTION public.job_match_digest_rows(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_match_digest_rows(uuid[]) TO service_role;

-- ── 9. schedule + liveness ──────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('job-match-queue', interval '15 minutes',
            'Q392: every-minute send of instant and parish job matches once the job is visible to the user under early access.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('job-match-queue', '* * * * *',
                          'SELECT public.sweep_job_match_queue();');
  END IF;
END
$do$;
