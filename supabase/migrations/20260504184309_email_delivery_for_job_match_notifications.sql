-- Wire job-match notification triggers to actually send emails.
--
-- Background: notify_helpers_on_job_post and notify_saved_searches_on_new_job
-- already create in-app notifications.type='job_match' rows when a new job
-- is posted. But there was no path to fire send-notification-email for
-- those — meaning helpers got the in-app badge but never an email,
-- which kills re-engagement for users who aren't currently in the app.
--
-- Mirrors the pattern from notify_on_application (migration
-- 20260312192651): a `net.http_post` call right after the INSERT INTO
-- public.notifications. send-notification-email handles user preference
-- filtering (email_new_offers column) itself, so we don't duplicate the
-- check here. http_post is async (returns a request_id immediately),
-- so it doesn't block the job INSERT even when fanning out to dozens
-- of matching helpers.
--
-- The function bodies are otherwise unchanged from the role-fix migration
-- 20260504142454 — same has_role-based filter, same notification copy.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. notify_helpers_on_job_post — fan-out by parish
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

    -- Async email send. send-notification-email checks user pref
    -- (email_new_offers maps to job_match per its TYPE_MAP) so we don't
    -- need to check it here. Failures are logged in pg_net's _http_response
    -- table — they don't roll back the notification insert.
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
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
-- 2. notify_saved_searches_on_new_job — fan-out by saved search match
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
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
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
