-- Q392 (instant half of PR #1810): an instant job-match notification reaches a
-- user only when the job is in that user's browse feed, and only once per
-- (job, user). The daily parish digest counts only jobs the recipient can see.
--
-- WHAT WAS BROKEN
--   instant-job-match (the edge function stripe-webhook calls after funding)
--   inserted "Match for you: <title> in <area> · $<budget>" for up to 20
--   users the moment escrow was funded. Every browse surface hides that job
--   from a user until early_access_visible_at(user, created_at) (20 minutes
--   for a free account) and hides a credential-gated job from a user below
--   its credential_tier (open_jobs_browse). The match ignored both, and
--   nothing deduped it: a re-trigger re-notified every matched user. The daily
--   parish digest (sweep_daily_job_digest) counted unfunded, ownerless,
--   offered and not-yet-visible jobs.
--
-- WHAT THIS DOES
--   1. job_announceable_to(job, user): open_jobs_browse's WHERE for one
--      recipient who is not a party to the job, minus the clock (open, funded,
--      a living poster who is not the recipient, no live direct offer, not a
--      hidden fixture, not above the recipient's credential tier).
--   2. job_match_queue: each instant match, held until the job is in that
--      user's feed. UNIQUE (user_id, job_id) is the permanent dedupe ledger (a
--      settled row is never deleted). `source` admits 'parish' so the parish
--      path can record its sends here later without a reshape (MQ29); nothing
--      writes 'parish' rows yet. Server-only.
--   3. deliver_job_match(id): the one send path. Re-checks the gate, the
--      clock, the recipient (verified, active, Job Matches on, no block either
--      way with the poster) and that no job_match for this (job, user) exists.
--   4. enqueue_instant_job_match(job, matches): what the edge function calls
--      instead of inserting notifications itself.
--   5. sweep_job_match_queue(), every minute ('job-match-queue').
--   6. sweep_daily_job_digest (restated from 20260924220318) counts only jobs
--      the gate admits and the recipient can already see.
--   7. job_match_digest_rows(ids) lets daily-match-digest re-check its queued
--      rows at digest time.
--   8. export_my_data (restated from 20260926180859) exports job_match_queue.
--
-- NOT HERE: the parish fan-out (notify_helpers_on_job_post,
-- deliver_parish_match_alert, parish_match_alert_queue) keeps main's
-- 20260926041132 behaviour.
--
-- Guards: src/test/jobAnnouncementsApplyBrowseGate.test.ts and
-- src/test/pglite/jobMatchesWaitForEarlyAccess.pglite.mjs.
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
  'Q392: job-match notifications (instant now; parish may record here later), held until the job is visible to the user under early access and the browse gate (job_announceable_to). One row per (user_id, job_id), kept after it settles: it is the dedupe ledger. Sent by deliver_job_match().';

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
  v_notified uuid;
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
  VALUES (r.user_id, r.title, r.message, 'job_match', r.link, r.job_id)
  RETURNING id INTO v_notified;

  -- trg_notifications_seed_boundary can suppress the row (a seed job, a real
  -- recipient): nothing was delivered, so the ledger says dropped, not sent.
  IF v_notified IS NULL THEN
    UPDATE public.job_match_queue
       SET status = 'dropped', drop_reason = 'suppressed by the seed boundary', settled_at = now()
     WHERE id = r.id;
    RETURN false;
  END IF;

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
  -- FOUND must be read here: PERFORM below resets it to true.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', 0, 'queued', 0, 'already', 0, 'sent_now', 0);
  END IF;
  -- Two runs for one job (a Stripe redelivery racing the webhook, or the
  -- poster's own call) insert the same (user, job) keys in an order the
  -- scorer does not fix; FOR SHARE does not serialise them. One at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('enqueue_instant_job_match:' || p_job_id::text, 0));

  FOR m IN
    SELECT e.value FROM jsonb_array_elements(p_matches) WITH ORDINALITY AS e(value, ord) ORDER BY e.ord
  LOOP
    EXIT WHEN v_eligible >= v_limit;
    v_uid := NULLIF(m->>'user_id', '')::uuid;
    CONTINUE WHEN v_uid IS NULL OR NOT public.job_announceable_to(v_job, v_uid);
    -- An in-app path only: '/x...', never '//host' or '/\host' (both read as
    -- protocol-relative by browsers) or a URL.
    IF NULLIF(m->>'title', '') IS NULL OR NULLIF(m->>'message', '') IS NULL
       OR COALESCE(m->>'link', '') !~ '^/[A-Za-z0-9]' OR strpos(m->>'link', '://') > 0 THEN
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
      WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
        -- Transient: the job is held by another writer, or this send lost a
        -- deadlock / serialization race. The row stays queued for next run.
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

-- ── 6. the daily parish digest counts only what the recipient can see ───────
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

REVOKE ALL ON FUNCTION public.sweep_daily_job_digest() FROM PUBLIC, anon, authenticated;

-- ── 7. daily-match-digest re-checks its rows at digest time ─────────────────
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
  -- The recipient is re-checked too, as deliver_job_match does: verified,
  -- active, Job Matches on, and no block either way with the poster.
  SELECT q.id,
         (j.id IS NOT NULL AND public.job_announceable_to(j, q.user_id)
          AND EXISTS (
            SELECT 1 FROM public.profiles p
              LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
             WHERE p.user_id = q.user_id
               AND p.email_verified
               AND COALESCE(p.ban_status, 'active') = 'active'
               AND COALESCE(np.job_matches, true) IS TRUE)
          AND NOT EXISTS (
            SELECT 1 FROM public.user_blocks b
             WHERE (b.blocker_id = j.customer_id AND b.blocked_id = q.user_id)
                OR (b.blocker_id = q.user_id AND b.blocked_id = j.customer_id))) AS send
    FROM public.match_digest_queue q
    LEFT JOIN public.jobs j ON j.id = q.job_id
   WHERE q.id = ANY(p_queue_ids)
     AND NOT (j.id IS NOT NULL
              AND public.job_announceable_to(j, q.user_id)
              AND public.early_access_visible_at(q.user_id, j.created_at) > now());
$function$;

REVOKE ALL ON FUNCTION public.job_match_digest_rows(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_match_digest_rows(uuid[]) TO service_role;

-- ── 8. export_my_data: restated from 20260926180859, plus job_match_queue ──
DROP FUNCTION IF EXISTS public.export_my_data();

CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;

-- ── 9. schedule + liveness ──────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('job-match-queue', interval '15 minutes',
            'Q392: every-minute send of queued job matches once the job is visible to the user under early access.',
            'exempt',
            'An empty queue is the normal minute. Every row settles to a status in job_match_queue, and a send that raises writes error_logs.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('job-match-queue', '* * * * *',
                          $c$SELECT public.cron_record_work('job-match-queue', to_jsonb(public.sweep_job_match_queue()));$c$);
  END IF;
END
$do$;
