-- Q1585: every-member job emails, the four follow-ups from the 2026-10-09
-- review (owner decisions, 2026-10-12).
--
-- (b) No daily-list choice for job matches. Owner: every member gets the email
--     for each new job unless they turn job-match emails off (the on/off
--     switch stays). The fan-out (notify_helpers_on_job_post), its sender
--     (deliver_parish_match_alert) and the instant path's sender
--     (deliver_job_match) no longer read notification_preferences
--     .match_digest_mode. The column stays (generated types, older app builds
--     still send it), but a trigger holds it false, so the saved-search pair
--     (notify_saved_searches_on_new_job, deliver_saved_search_alert), which
--     still branch on it, can never batch a member into a list they cannot see
--     or switch off. Measured on prod 2026-10-12: 0 of 80 preference rows had
--     it on, match_digest_queue held 0 rows, so nobody's delivery changes
--     today.
--     sweep_daily_job_digest (the in-app "New jobs in <parish>" list, 7 sent in
--     the 7 days to 2026-10-12 against 14 job_match rows in all) now counts
--     only jobs no per-job alert covered, so it never tells a member about a
--     job twice.
-- (a) The hourly cap of 10 no longer drops an alert. The trigger filtered an
--     over-cap member out at queue time, and the every-minute sweep deletes
--     each parish_match_alert_queue row before deliver_parish_match_alert ran
--     the cap, which then returned false with no ledger row and no log. Now
--     the trigger queues every member and the sender re-queues an over-cap
--     alert with retry_after = when the oldest of the last hour's alerts ages
--     out of the window. deliver_job_match does the same for a parish row
--     (it stays queued with a retry_after instead of being dropped).
-- (c) The trigger's per-profile LOOP is one set-based INSERT ... SELECT ...
--     ON CONFLICT DO NOTHING.
-- (d) is the edge side (send-notification-email's List-Unsubscribe header for
--     job_match mail, email-unsubscribe's job_matches list); nothing here.
--
-- Bodies are the effective definitions (src/test/helpers/effectiveFunctionDefs
-- .ts; no regexp rewrite touches these four), matching pg_get_functiondef on
-- prod 2026-10-12, with only the changes above.
-- Guards: src/test/jobAlertsReachEveryMember.test.ts,
-- src/test/parishFanoutIsBounded.test.ts; PGlite:
-- src/test/pglite/jobMatchEmailsFollowups.pglite.mjs.
-- Replay-safe: CREATE OR REPLACE with unchanged signatures, DROP TRIGGER IF
-- EXISTS before CREATE TRIGGER, an idempotent UPDATE; grants restated.

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
  v_title TEXT := 'New job posted';
  v_message TEXT;
  v_link TEXT;
  v_ledger uuid;
  v_notified uuid;
  v_recent integer;
  v_oldest timestamptz;
BEGIN
  -- FOR SHARE NOWAIT: the job cannot be hired, cancelled or unfunded between
  -- this check and the send, and the sweep never waits on the funding write.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Still what open_jobs_browse shows this user (any parish, 2026-10-09).
  IF NOT public.job_announceable_to(v_job, p_user_id) THEN
    RETURN false;
  END IF;

  -- V-008: never before the job is in this user's feed.
  IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN
    RETURN false;
  END IF;

  -- The recipient: verified, active, opted in. Q1585 (owner, 2026-10-12):
  -- there is no daily-list choice for job matches any more, so digest mode no
  -- longer stands a member down; every member is told about every new job
  -- unless they turn Job Matches off.
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

  -- Q392: a block either way stops the send.
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
     WHERE (b.blocker_id = v_job.customer_id AND b.blocked_id = p_user_id)
        OR (b.blocker_id = p_user_id AND b.blocked_id = v_job.customer_id)
  ) THEN
    RETURN false;
  END IF;

  -- Q392 (MQ29, never twice): the ledger decides, whichever source wrote it.
  -- Q723: except a row an error dropped; nothing was delivered, so it retries.
  IF EXISTS (
    SELECT 1 FROM public.job_match_queue l
     WHERE l.user_id = p_user_id AND l.job_id = p_job_id
       AND NOT (l.status = 'dropped' AND COALESCE(l.drop_reason, '') LIKE 'error:%')
  ) THEN
    RETURN false;
  END IF;

  -- N-007 at send time: once per (job, Helpr) (a saved-search alert for the
  -- same job counts).
  IF EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = p_user_id AND n.job_id = p_job_id AND n.type = 'job_match'
     )
  THEN
    RETURN false;
  END IF;

  -- N-007: at most 10 job matches per Helpr per hour. Q1585 (a): past the cap
  -- the alert WAITS, it is never dropped. The sweep deleted this row before
  -- calling here, so it is queued again, due when the oldest of the last
  -- hour's alerts ages out of the window (a slot opens then). No ledger slot
  -- has been claimed yet, so the later send is a normal one.
  SELECT count(*), min(n.created_at)
    INTO v_recent, v_oldest
    FROM public.notifications n
   WHERE n.user_id = p_user_id AND n.type = 'job_match'
     AND n.created_at > now() - interval '1 hour';
  IF v_recent >= 10 THEN  -- N-007 hourly cap
    INSERT INTO public.parish_match_alert_queue (user_id, job_id, notify_at, retry_after)
    VALUES (p_user_id, p_job_id, public.early_access_visible_at(p_user_id, v_job.created_at),
            GREATEST(v_oldest + interval '1 hour', now() + interval '1 minute'))
    ON CONFLICT (user_id, job_id) DO UPDATE
       SET retry_after = EXCLUDED.retry_after;  -- Q1585 re-queued over the cap
    RETURN false;
  END IF;

  v_message := 'A new ' || COALESCE(v_job.category::text, 'job') || ' job was just posted'
    || COALESCE(' in ' || v_job.parish || ' Parish', '') || ': "' || v_job.title || '"';
  v_link := '/home?job=' || v_job.id::text;

  -- Claim the (user, job) ledger slot first. A concurrent claim from either
  -- source wins the unique constraint and this send stands down. Q723: a row
  -- an error dropped is reclaimed; any other row still wins.
  INSERT INTO public.job_match_queue
    (user_id, job_id, source, notify_at, title, message, link, send_email, status, settled_at)
  VALUES
    (p_user_id, v_job.id, 'parish', public.early_access_visible_at(p_user_id, v_job.created_at),
     v_title, v_message, v_link, true, 'sent', now())
  ON CONFLICT (user_id, job_id) DO UPDATE
     SET source = 'parish', notify_at = EXCLUDED.notify_at, title = EXCLUDED.title,
         message = EXCLUDED.message, link = EXCLUDED.link, send_email = true,
         status = 'sent', drop_reason = NULL, settled_at = now(), attempts = 0, retry_after = NULL
   WHERE public.job_match_queue.status = 'dropped'
     AND public.job_match_queue.drop_reason LIKE 'error:%'
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
       SET status = 'dropped', drop_reason = 'suppressed by the seed boundary', settled_at = now()
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

CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Every member, any parish (owner, 2026-10-09): a job with no parish is
  -- announced too.
  IF NEW.status <> 'open' THEN
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

  -- Q1585 (c): one set-based INSERT, not a loop over every profile inside
  -- the funding transaction. V-008: queued, never sent here, even when already
  -- visible; the sweep sends once the job is in THIS user's feed, and
  -- deliver_parish_match_alert re-checks every predicate below (and claims
  -- the ledger row) at send time.
  INSERT INTO public.parish_match_alert_queue (user_id, job_id, notify_at)
    WITH candidates AS (
      -- Every member (owner, 2026-10-09). Was: same parish AND had already
      -- applied or worked a job, which left every new member out.
      SELECT p2.user_id
      FROM public.profiles p2
      WHERE p2.user_id IS NOT NULL
        -- Test accounts (is_seed) are not told about real jobs (review, 2026-10-09).
        AND NOT COALESCE(p2.is_seed, false)
    )
    SELECT DISTINCT c.user_id, NEW.id, public.early_access_visible_at(c.user_id, NEW.created_at)
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
      -- Q723: a row an error dropped does not count; it retries.
      AND NOT EXISTS (
        SELECT 1 FROM public.job_match_queue l
         WHERE l.user_id = c.user_id AND l.job_id = NEW.id
           AND NOT (l.status = 'dropped' AND COALESCE(l.drop_reason, '') LIKE 'error:%')
      )
      -- 'Job Matches' switch (not 'Job Offers', 2026-09-11). Unset means on.
      -- Q1585 (owner, 2026-10-12): digest mode no longer stands a member down.
      AND COALESCE(np.job_matches, true) IS TRUE
      -- N-007: once per (job, Helpr). A funded job that leaves 'open' and comes
      -- back re-fires this trigger; it must not re-notify the whole parish.
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.user_id = c.user_id AND n.job_id = NEW.id AND n.type = 'job_match'
      )  -- N-007 once per job
      -- N-007's hourly cap is NOT applied here any more (Q1585 a): filtering a
      -- member out at queue time dropped their alert for good. Every member is
      -- queued; deliver_parish_match_alert holds the cap at send time and
      -- re-queues an alert over it for when a slot opens.
  ON CONFLICT (user_id, job_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.deliver_job_match(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.job_match_queue%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_reason TEXT;
  v_notified uuid;
  v_recent integer;
  v_oldest timestamptz;
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

  -- Q1585 (owner, 2026-10-12): no daily-list choice for job matches, so the
  -- recipient check no longer reads digest mode; an instant match is sent.
  IF v_reason IS NULL THEN
    PERFORM 1
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
  -- Q1585 (a): over the cap the row WAITS (still queued, due when the oldest
  -- of the last hour's alerts ages out), never dropped.
  IF v_reason IS NULL AND r.source = 'parish' THEN
    SELECT count(*), min(n.created_at)
      INTO v_recent, v_oldest
      FROM public.notifications n
     WHERE n.user_id = r.user_id AND n.type = 'job_match'
       AND n.created_at > now() - interval '1 hour';
    IF v_recent >= 10 THEN  -- N-007 hourly cap
      UPDATE public.job_match_queue
         SET retry_after = GREATEST(v_oldest + interval '1 hour', now() + interval '1 minute')
       WHERE id = r.id;  -- Q1585 re-queued over the cap
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
        -- Q1585: every member is told about every new job one by one now, so
        -- the daily list counts only jobs no per-job alert covered (never
        -- notified, not waiting in either queue, not in the ledger). Without
        -- this a member heard about the same job twice.
        AND NOT EXISTS (
          SELECT 1 FROM public.notifications n
           WHERE n.user_id = p.user_id AND n.job_id = nj.id AND n.type = 'job_match'
        )  -- Q1585 no double notify
        AND NOT EXISTS (
          SELECT 1 FROM public.parish_match_alert_queue q
           WHERE q.user_id = p.user_id AND q.job_id = nj.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.job_match_queue l
           WHERE l.user_id = p.user_id AND l.job_id = nj.id
             AND NOT (l.status = 'dropped' AND COALESCE(l.drop_reason, '') LIKE 'error:%')
        )
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

-- (b) Nothing can turn digest mode on any more: the switch is gone from the
-- app, and an older build that still sends match_digest_mode = true is held to
-- false here rather than batching that member's matches out of sight.
UPDATE public.notification_preferences SET match_digest_mode = false WHERE match_digest_mode;

CREATE OR REPLACE FUNCTION public.hold_match_digest_mode_off()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.match_digest_mode := false;  -- Q1585 no daily list for job matches
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.hold_match_digest_mode_off() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hold_match_digest_mode_off ON public.notification_preferences;
CREATE TRIGGER trg_hold_match_digest_mode_off
  BEFORE INSERT OR UPDATE OF match_digest_mode ON public.notification_preferences
  FOR EACH ROW
  WHEN (NEW.match_digest_mode IS TRUE)
  EXECUTE FUNCTION public.hold_match_digest_mode_off();
