-- Add in-app + push notifications for counter-offer negotiation events.
--
-- Three new cases added to notify_on_application():
--   1. Poster sent counter  (negotiation_status: open → countered)
--      → helper receives: "Poster sent a counter-offer"
--   2. Helper accepted counter (negotiation_status: countered → counter_accepted)
--      → poster receives: "Counter accepted!"
--   3. Helper declined counter (negotiation_status: countered → counter_declined)
--      → poster receives: "Counter declined"
--
-- The rest of the function body is preserved verbatim from
-- 20260505171500_triggers_read_from_vault.sql (vault-based secret lookup,
-- email send via send-notification-email edge function).
--
-- No table schema changes. CREATE OR REPLACE makes this replay-safe.

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
  v_poster_name TEXT;
  v_helper_name TEXT;
BEGIN
  SELECT title, customer_id INTO job_title, job_owner FROM public.jobs WHERE id = NEW.job_id;

  -- New application: notify job owner
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

  -- Application accepted: notify helper
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
          'user_id', v_user_id,
          'title', v_title,
          'message', v_message,
          'type', v_type,
          'link', v_link
        )
      );
    END IF;
  END IF;

  -- Application rejected: notify helper
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
          'user_id', v_user_id,
          'title', v_title,
          'message', v_message,
          'type', v_type,
          'link', v_link
        )
      );
    END IF;
  END IF;

  -- ── Counter-offer: poster sent a counter (open → countered) ────────────────
  -- Notify the helper so they can respond.
  IF TG_OP = 'UPDATE' AND NEW.negotiation_status = 'countered' AND OLD.negotiation_status = 'open' THEN
    SELECT full_name INTO v_poster_name FROM public.profiles WHERE user_id = job_owner;

    v_user_id := NEW.helper_id;
    v_title := 'Poster sent a counter-offer';
    v_message := COALESCE(v_poster_name, 'The poster') || ' countered your bid on "' || job_title || '"';
    v_type := 'info';
    v_link := '/activity?tab=myjobs';

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
          'user_id', v_user_id,
          'title', v_title,
          'message', v_message,
          'type', v_type,
          'link', v_link
        )
      );
    END IF;
  END IF;

  -- ── Counter-offer: helper accepted (countered → counter_accepted) ──────────
  -- Notify the poster — they can now proceed to hire.
  IF TG_OP = 'UPDATE' AND NEW.negotiation_status = 'counter_accepted' AND OLD.negotiation_status = 'countered' THEN
    SELECT full_name INTO v_helper_name FROM public.profiles WHERE user_id = NEW.helper_id;

    v_user_id := job_owner;
    v_title := 'Counter accepted!';
    v_message := COALESCE(v_helper_name, 'The helper') || ' accepted your counter on "' || job_title || '"';
    v_type := 'success';
    v_link := '/activity?tab=myposts';

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
          'user_id', v_user_id,
          'title', v_title,
          'message', v_message,
          'type', v_type,
          'link', v_link
        )
      );
    END IF;
  END IF;

  -- ── Counter-offer: helper declined (countered → counter_declined) ──────────
  -- Notify the poster so they know the negotiation ended.
  IF TG_OP = 'UPDATE' AND NEW.negotiation_status = 'counter_declined' AND OLD.negotiation_status = 'countered' THEN
    SELECT full_name INTO v_helper_name FROM public.profiles WHERE user_id = NEW.helper_id;

    v_user_id := job_owner;
    v_title := 'Counter declined';
    v_message := COALESCE(v_helper_name, 'The helper') || ' declined your counter on "' || job_title || '"';
    v_type := 'info';
    v_link := '/activity?tab=myposts';

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
          'user_id', v_user_id,
          'title', v_title,
          'message', v_message,
          'type', v_type,
          'link', v_link
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
