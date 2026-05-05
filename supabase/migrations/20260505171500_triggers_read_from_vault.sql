-- Switch trigger-emitted email sends from `current_setting('app.settings.*')`
-- (which is NULL because ALTER DATABASE for app.settings.* was denied) to
-- `vault.decrypted_secrets` (populated 2026-05-05 by cowork's vault.create_secret
-- writes for `service_role_key` and `supabase_url`).
--
-- Functions touched (5 net.http_post call sites across 3 trigger functions):
--   1. notify_on_application — INSERT (job owner) + UPDATE accepted (helper) +
--      UPDATE rejected (helper) email sends. From migration 20260312192651.
--   2. notify_helpers_on_job_post — fan-out by parish. From 20260504184309.
--   3. notify_saved_searches_on_new_job — fan-out by saved search. From 20260504184309.
--
-- Pattern: `current_setting('app.settings.X', true)` →
--   `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'X' LIMIT 1)`
-- All three functions are SECURITY DEFINER so they can read vault.decrypted_secrets
-- without granting wider access. Each subquery is evaluated once per row in the
-- LOOP body — fine for the volumes involved (single applications, dozens of
-- helpers per parish), and Postgres caches the inner SELECT plan.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. notify_on_application
-- ──────────────────────────────────────────────────────────────────────────────
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

  RETURN NEW;
END;
$function$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. notify_helpers_on_job_post
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  helper_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
BEGIN
  IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  v_title := '🎯 New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/dashboard?job=' || NEW.id::text;

  FOR helper_record IN
    SELECT DISTINCT hpp.helper_id
    FROM public.helper_preferred_parishes hpp
    JOIN public.profiles p ON p.user_id = hpp.helper_id
    WHERE hpp.parish = NEW.parish
      AND public.has_role(p.user_id, 'helper'::app_role)
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND hpp.helper_id <> NEW.customer_id
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (helper_record.helper_id, v_title, v_message, 'job_match', v_link);

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
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. notify_saved_searches_on_new_job
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  FOR match_record IN
    SELECT DISTINCT s.id, s.user_id, s.name
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    WHERE s.notify_enabled = true
      AND public.has_role(p.user_id, 'helper'::app_role)
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      AND (s.category IS NULL OR s.category = NEW.category::text)
      AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget)
      AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (
        s.location_keyword IS NULL
        OR NEW.location ILIKE '%' || s.location_keyword || '%'
      )
      AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
  LOOP
    v_title := '🎯 New job matches your saved search';
    v_message := 'A new job matches "' || match_record.name || '": ' || NEW.title || ' ($' || NEW.budget || ')';
    v_link := '/dashboard?job=' || NEW.id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (match_record.user_id, v_title, v_message, 'job_match', v_link);

    UPDATE public.saved_searches
       SET last_notified_at = now()
     WHERE id = match_record.id;

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', match_record.user_id,
        'title', v_title,
        'message', v_message,
        'type', 'job_match',
        'link', v_link
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;
