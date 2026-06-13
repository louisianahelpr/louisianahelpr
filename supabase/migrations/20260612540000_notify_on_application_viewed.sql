-- Notify helper when their application is viewed by the poster for the first time.
--
-- type = 'info' is used instead of 'application' because type 'application'
-- maps to the job_applications push preference in notification_type_pref_map and
-- would trigger a push notification. "Poster viewed your application" is
-- informational, not urgent enough to interrupt with a push.
-- 'info' is a valid type in the notifications_type_check constraint.
--
-- NOTE: 'info' does not appear in notification_type_pref_map, so it falls
-- through to the push fan-out unless the user's master push_enabled toggle is
-- off. This is the closest approximation to "in-app only" in the current schema
-- without adding a new pref_map entry or preference column.

CREATE OR REPLACE FUNCTION public.notify_helper_application_viewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_title text;
BEGIN
  -- Only fire on the first view (NULL → non-NULL transition)
  IF NEW.poster_viewed_at IS NULL OR OLD.poster_viewed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Only notify pending applications (not already decided)
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;

  INSERT INTO public.notifications (
    user_id, title, body, type, link
  ) VALUES (
    NEW.helper_id,
    'Your application was seen',
    'The poster viewed your application for "' || COALESCE(v_job_title, 'a job') || '".',
    'info',
    '/my-jobs?highlight=' || NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_application_viewed ON public.applications;
CREATE TRIGGER on_application_viewed
  AFTER UPDATE OF poster_viewed_at ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_helper_application_viewed();

-- Prevent direct RPC invocation from anon/authenticated roles.
REVOKE ALL ON FUNCTION public.notify_helper_application_viewed() FROM PUBLIC, anon, authenticated;
