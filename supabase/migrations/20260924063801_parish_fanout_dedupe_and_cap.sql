-- N-007: notify_helpers_on_job_post fanned out to every matching Helpr with
-- no dedupe and no cooldown. The UPDATE trigger re-arms whenever a funded job
-- returns to 'open', so a job cycling out of and back into 'open' re-notified
-- (and re-emailed) the whole parish each time; prod already holds one
-- duplicate (user, job) job_match pair. Body is the live definition
-- (2026-09-24) plus two candidate predicates: once per (job, Helpr), and at
-- most 10 job_match notifications per Helpr per hour.

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
  v_link := '/dashboard?job=' || NEW.id::text;

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
      -- offers. A helper muting direct offers silently muted parish matches
      -- too, and a helper wanting to mute matches had no way to. Unset still
      -- means on: most accounts have no preferences row.
      AND COALESCE(np.job_matches, true) IS TRUE
      -- Digest mode is an explicit "batch these, don't ping me". This producer
      -- has no queue to route into, so it stands down and sweep_daily_job_digest
      -- covers them.
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

CREATE INDEX IF NOT EXISTS idx_notifications_user_type_created
  ON public.notifications (user_id, type, created_at DESC);
