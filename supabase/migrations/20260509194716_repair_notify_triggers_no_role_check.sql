-- P0 hotfix: notify_helpers_on_job_post + notify_saved_searches_on_new_job
-- in production are still on the pre-unification version that references
-- the dropped `profiles.role` column. Result: every POST /rest/v1/jobs
-- 400's with `column p.role does not exist`. Job posting is broken
-- end-to-end on the live DB.
--
-- The behavior-based rewrites in 20260506380000 have the correct shape
-- (no `p.role` references) but appear to not have been applied in prod.
-- This migration re-applies just the two broken functions with a higher
-- timestamp so it WILL run regardless of prior migration state.
--
-- Identical bodies to 20260506380000 (verified line-by-line). Idempotent
-- via CREATE OR REPLACE. The trigger bindings (set up in earlier migrations)
-- stay unchanged — these only redefine the functions the triggers call.
--
-- Both functions intentionally drop the role gate per the original
-- cleanup intent: helper_preferred_parishes and saved_searches are
-- already opt-in by design (users explicitly populate those tables to
-- declare helper-side intent). Filtering further by role was redundant
-- AND silently broken once profiles.role was dropped.

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

  v_title := '🎯 New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/dashboard?job=' || NEW.id::text;

  -- helper_preferred_parishes is opt-in (users who set parish prefs are
  -- expressing helper intent by definition). NO role gate.
  FOR helper_record IN
    SELECT DISTINCT hpp.helper_id
    FROM public.helper_preferred_parishes hpp
    JOIN public.profiles p ON p.user_id = hpp.helper_id
    WHERE hpp.parish = NEW.parish
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
$function$;

CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  match_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  -- saved_searches is opt-in (users explicitly created the search).
  -- NO role gate.
  FOR match_record IN
    SELECT DISTINCT s.id, s.user_id, s.name
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    WHERE s.notify_enabled = true
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
$function$;
