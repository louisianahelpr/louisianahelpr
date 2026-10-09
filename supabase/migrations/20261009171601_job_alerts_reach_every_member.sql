-- Every new job is emailed to every member (owner, 2026-10-09: "just send
-- emails when any job is posted no matter what parish"; no digest emails now).
--
-- Measured on prod 2026-10-09: of 9 real members who joined that day, the
-- instant "New job in your parish" alert reached only Ben, because
-- notify_helpers_on_job_post queued a member only if they lived in the job's
-- parish AND had already applied to or worked a job. A brand-new member got
-- nothing until the next morning's in-app digest, which sends no email.
--
-- notify_helpers_on_job_post: candidates are now every member (any parish, no
-- prior-work test). Every other gate is unchanged: email verified, not banned,
-- the browse gate (job_announceable_to: open, funded, not their own job, no live
-- direct offer, credential tier), blocks either way, the 'Job Matches' switch
-- (np.job_matches; an opted-out member gets nothing), digest mode stands down,
-- once per (job, member), at most 10 an hour, queued until the job is in that
-- member's feed (early access).
-- deliver_parish_match_alert: no longer requires the recipient's parish; the
-- title says a job was posted and the message names the job's parish.
-- enqueue_instant_job_match: its rows now send the email too (send_email true).
-- Names still say "parish" (deliver_parish_match_alert, parish_match_alert_queue,
-- source 'parish'): the fan-out is statewide now; renaming is a separate change.
--
-- Guards: src/test/parishFanoutIsBounded.test.ts (N-007 predicates and the
-- queue-only shape), src/test/jobAlertsReachEveryMember.test.ts (this change),
-- PGlite: src/test/pglite/jobAlertsReachEveryMember.pglite.mjs.
-- Replay-safe: CREATE OR REPLACE with unchanged signatures; grants restated.

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
  -- Q723: except a row an error dropped; nothing was delivered, so it retries.
  IF EXISTS (
    SELECT 1 FROM public.job_match_queue l
     WHERE l.user_id = p_user_id AND l.job_id = p_job_id
       AND NOT (l.status = 'dropped' AND COALESCE(l.drop_reason, '') LIKE 'error:%')
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
DECLARE
  helper_record RECORD;
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

  FOR helper_record IN
    WITH candidates AS (
      -- Every member (owner, 2026-10-09). Was: same parish AND had already
      -- applied or worked a job, which left every new member out.
      SELECT p2.user_id
      FROM public.profiles p2
      WHERE p2.user_id IS NOT NULL
        -- Test accounts (is_seed) are not told about real jobs (review, 2026-10-09).
        AND NOT COALESCE(p2.is_seed, false)
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
      -- Q723: a row an error dropped does not count; it retries.
      AND NOT EXISTS (
        SELECT 1 FROM public.job_match_queue l
         WHERE l.user_id = c.user_id AND l.job_id = NEW.id
           AND NOT (l.status = 'dropped' AND COALESCE(l.drop_reason, '') LIKE 'error:%')
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

-- The location-matched instant path claims the same once-per-(member, job) ledger
-- slot. It queued with send_email = false, so a member it reached first never got
-- the email the owner asked for (review, 2026-10-09). Now it emails too, through
-- deliver_job_match and send-notification-email, which honour the email switch.
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
    INSERT INTO public.job_match_queue (user_id, job_id, source, notify_at, title, message, link, send_email)
    VALUES (v_uid, v_job.id, 'instant', public.early_access_visible_at(v_uid, v_job.created_at),
            m->>'title', m->>'message', m->>'link', true)
    -- Q723: a row an error dropped is queued again with this copy; any other
    -- row (queued, sent, digested, or dropped for a reason) still wins.
    ON CONFLICT (user_id, job_id) DO UPDATE
       SET source = 'instant', notify_at = EXCLUDED.notify_at, title = EXCLUDED.title,
           message = EXCLUDED.message, link = EXCLUDED.link, send_email = true,
           status = 'queued', drop_reason = NULL, settled_at = NULL, attempts = 0, retry_after = NULL
     WHERE public.job_match_queue.status = 'dropped'
       AND public.job_match_queue.drop_reason LIKE 'error:%'
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
      EXCEPTION
        WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
          -- Transient: not an attempt. The sweep sends it next minute.
          NULL;
        WHEN OTHERS THEN
          -- Q723: this is attempt 1. The sweep retries after 5 minutes.
          UPDATE public.job_match_queue
             SET attempts = attempts + 1,
                 retry_after = now() + interval '5 minutes'
           WHERE id = v_id AND status = 'queued';
          INSERT INTO public.error_logs (severity, message, tags)
          VALUES ('warning', 'job match send failed, will retry: ' || SQLERRM,
                  jsonb_build_object('source', 'job-match-queue' || CASE WHEN COALESCE(v_job.is_seed, false) THEN '-seed' ELSE '' END,
                                     'area', 'notifications', 'seed', COALESCE(v_job.is_seed, false),
                                     'attempt', 1, 'job_id', p_job_id, 'user_id', v_uid));
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('eligible', v_eligible, 'queued', v_queued, 'already', v_already, 'sent_now', v_sent);
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_instant_job_match(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_instant_job_match(uuid, jsonb) TO service_role;
