-- Job alerts name the poster's title and the town (owner 2026-10-27).
-- Owner, screenshot of the bell: "just put the title the person typed for the
-- job and where it is. like mow and weed eat was just posted in new iberia.
-- never the parish and never the category." Was: 'A new yard_work job was just
-- posted in Iberia Parish: "Mow and Weed Eat"'. Restated from prod's live body
-- of deliver_parish_match_alert (pg_get_functiondef 2026-10-27) with only the
-- message changed; the in-app notice, push and email all read v_message.

CREATE OR REPLACE FUNCTION public.deliver_parish_match_alert(p_user_id uuid, p_job_id uuid)
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

  -- Owner 2026-10-27: the title the poster typed and the town, never the
  -- parish and never the category: '"Mow and Weed Eat" was just posted in New
  -- Iberia.' The town is the address's city ("4804 Dolphin St, New Iberia, LA
  -- 70560" -> "New Iberia"), never the street; no town, no place.
  v_message := '"' || btrim(v_job.title) || '" was just posted'
    || COALESCE(' in ' || NULLIF(btrim((regexp_match(v_job.location, '(?:^|,)\s*([^,]+?),\s*[A-Za-z]{2}\M'))[1]), ''), '')
    || '.';
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
