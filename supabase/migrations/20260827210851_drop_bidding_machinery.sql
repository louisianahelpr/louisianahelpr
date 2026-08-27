-- Remove the dead bidding / counter-offer machinery.
--
-- Bidding was removed from the product (PRICING_MODE_REMOVED, see
-- src/components/postjob/BudgetSection.tsx), but the schema kept the columns,
-- the trigger and the RPCs. That is not merely untidy: the machinery still
-- looks load-bearing, so anything writing to `applications` (a seeding script,
-- a future RPC) happily populates prices nobody will ever honour.
--
-- Verified against prod on 2026-08-27 before writing this: `proposed_price`
-- non-null on 0 of 12 applications, `counter_price` on 0, `negotiation_status
-- <> 'open'` on 1 (a seed row, id 5eed0827-…), `proposed_rate` on 4 (the same
-- seed batch), and `bid_ceiling` / `bid_deadline` / `bids_sealed` on 0 of 26
-- jobs. No real row carried any of it, so dropping is non-destructive.
--
-- What is deliberately KEPT:
--   * applications.poster_viewed_at — not bidding. It backs the helper-side
--     "Seen" chip and the poster's new-applicant badge count, and is written
--     by mark_applications_viewed() / read by notify_helper_application_viewed().
--   * jobs.pricing_mode — every row is 'set_price' and the open_jobs_browse
--     view projects it; the column stays, its CHECK is narrowed below so
--     'accept_bids' / 'smart_price' can never come back in through a write.
--
-- REPLAY-SAFETY: every statement is IF EXISTS-guarded or CREATE OR REPLACE,
-- and nothing here references an object created by a LATER migration.

-- 1. The bid-price lock trigger + its function.
DROP TRIGGER IF EXISTS trg_enforce_bid_price_lock ON public.applications;
DROP FUNCTION IF EXISTS public.enforce_bid_price_lock();

-- 2. The counter-offer RPCs. respond_to_counter_offer() was also the only
--    thing that ever wrote a negotiated price back into jobs.budget.
DROP FUNCTION IF EXISTS public.counter_application_bid(uuid, numeric);
DROP FUNCTION IF EXISTS public.respond_to_counter_offer(uuid, boolean);

-- 3. apply_to_job loses its p_proposed_price parameter. The 3-arg version is
--    dropped and replaced rather than overloaded, so PostgREST has exactly one
--    candidate to resolve against. The client already calls it with only
--    p_job_id + p_message.
DROP FUNCTION IF EXISTS public.apply_to_job(uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid, p_message text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_app_id uuid;
  v_existing int;
  v_status text;
  v_count_1m int;
  v_count_1h int;
  v_count_1d int;
BEGIN
  -- Serialize this helper's concurrent applications so the counts below see
  -- each other's inserts. Released automatically at transaction end.
  PERFORM pg_advisory_xact_lock(hashtextextended('apply_rate:' || auth.uid()::text, 0));

  SELECT COUNT(*) INTO v_count_1m FROM applications
    WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 minute';
  IF v_count_1m >= 10 THEN
    RAISE EXCEPTION 'rate_limit_minute' USING HINT = 'Too many applications — try again in a minute';
  END IF;

  SELECT COUNT(*) INTO v_count_1h FROM applications
    WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 hour';
  IF v_count_1h >= 50 THEN
    RAISE EXCEPTION 'rate_limit_hour' USING HINT = 'Hourly application limit reached — try again later';
  END IF;

  SELECT COUNT(*) INTO v_count_1d FROM applications
    WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 day';
  IF v_count_1d >= 200 THEN
    RAISE EXCEPTION 'rate_limit_day' USING HINT = 'Daily application limit reached — try again tomorrow';
  END IF;

  -- FOR SHARE: composes with accept_application's FOR UPDATE so an application
  -- can't be inserted against a job being accepted in the same instant.
  SELECT status INTO v_status
  FROM jobs WHERE id = p_job_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_status != 'open' THEN
    RAISE EXCEPTION 'Job is no longer accepting applications';
  END IF;
  IF EXISTS (SELECT 1 FROM jobs WHERE id = p_job_id AND customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Cannot apply to your own job';
  END IF;
  SELECT COUNT(*) INTO v_existing
  FROM applications WHERE job_id = p_job_id AND helper_id = auth.uid();
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Already applied to this job';
  END IF;

  INSERT INTO applications (job_id, helper_id, message, status)
  VALUES (p_job_id, auth.uid(), p_message, 'pending')
  RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_to_job(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_to_job(uuid, text) TO authenticated;

-- 3b. notify_on_application() is the applications trigger and it reads
--     NEW.negotiation_status in three counter-offer branches. plpgsql resolves
--     record fields at RUNTIME, so dropping the column without touching this
--     function would make EVERY update to an application (accept, reject) fail
--     with "record new has no field negotiation_status" — the accept path,
--     not just the dead one. The three counter branches are removed here; the
--     insert / accepted / rejected branches are unchanged.
CREATE OR REPLACE FUNCTION public.notify_on_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  job_title TEXT;
  job_owner UUID;
  v_user_id UUID;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
  v_link TEXT;
  v_email_enabled BOOLEAN;
  v_profile RECORD;
BEGIN
  SELECT title, customer_id INTO job_title, job_owner FROM public.jobs WHERE id = NEW.job_id;

  IF TG_OP = 'INSERT' THEN
    v_user_id := job_owner;
    v_title := 'New application';
    v_message := 'Someone applied to "' || job_title || '"';
    v_type := 'application';
    v_link := '/dashboard';

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    IF v_email_enabled IS TRUE THEN
      SELECT email, full_name INTO v_profile FROM public.profiles WHERE user_id = v_user_id;
      IF v_profile.email IS NOT NULL THEN
        PERFORM net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
          ),
          body := jsonb_build_object(
            'user_id', v_user_id,
            'title', v_title,
            'message', v_message,
            'type', v_type,
            'link', v_link
          )
        );
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    v_user_id := NEW.helper_id;
    v_title := 'Application accepted!';
    v_message := 'You were accepted for "' || job_title || '"';
    v_type := 'success';
    v_link := '/dashboard';

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    IF v_email_enabled IS TRUE THEN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', v_user_id, 'title', v_title, 'message', v_message, 'type', v_type, 'link', v_link
        )
      );
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    v_user_id := NEW.helper_id;
    v_title := 'Application update';
    v_message := 'Your application for "' || job_title || '" was not selected';
    v_type := 'info';
    v_link := '/dashboard';

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    IF v_email_enabled IS TRUE THEN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', v_user_id, 'title', v_title, 'message', v_message, 'type', v_type, 'link', v_link
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. The columns themselves, plus their CHECK constraints (dropped implicitly
--    with the columns, but named here so a partial state still replays).
ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_counter_price_check,
  DROP CONSTRAINT IF EXISTS applications_proposed_price_check,
  DROP CONSTRAINT IF EXISTS applications_negotiation_status_check,
  DROP COLUMN IF EXISTS proposed_price,
  DROP COLUMN IF EXISTS counter_price,
  DROP COLUMN IF EXISTS negotiation_status,
  DROP COLUMN IF EXISTS proposed_rate;

ALTER TABLE public.jobs
  DROP COLUMN IF EXISTS bid_ceiling,
  DROP COLUMN IF EXISTS bid_deadline,
  DROP COLUMN IF EXISTS bids_sealed;

-- 5. Narrow pricing_mode to the only mode that exists.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_pricing_mode_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_pricing_mode_check CHECK (pricing_mode = 'set_price');

COMMENT ON COLUMN public.jobs.pricing_mode IS
  'Always ''set_price''. Bidding was removed 2026-08-19; the accept_bids and smart_price modes were dropped from this CHECK on 2026-08-27.';
