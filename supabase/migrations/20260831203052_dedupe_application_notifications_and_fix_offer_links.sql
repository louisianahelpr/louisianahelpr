-- Three notification defects from the 2026-08-31 lifecycle re-drive, all in
-- the accept / decline / direct-offer path.
--
-- 1. ACCEPT sent the helper TWO notifications ~2s apart with DIFFERENT links.
--    Producer A: this trigger's `accepted` branch — "Application accepted!",
--    link '/dashboard', no mention of the response deadline.
--    Producer B: useOfferHandlers.confirmAcceptWithDeadline -> create-notification
--    — "New job offer!", link '/my-jobs?filter=offered', and it names the
--    deadline the poster actually chose.
--    B is the one the helper has to act on; A points at a screen where the
--    offer cannot be accepted, and the offer expires. Drop A. (The email is
--    not lost: create-notification chains send-notification-email with the
--    service key, same as this trigger did.)
--
-- 2. DECLINE also sent two: this trigger's `rejected` branch ("was not
--    selected", link '/dashboard') plus a client insert carrying the poster's
--    actual reason but NO link at all (`link` defaults to null in both
--    src/lib/notifications.ts and create-notification), i.e. a notification
--    with nothing to tap.
--    Here the trigger is the one to KEEP: it is the only producer that covers
--    applications auto-rejected by reject_other_applications_on_accept, which
--    no client ever sees. So the reason moves ONTO the row the trigger writes,
--    via a new applications.decline_reason column, and the client's second
--    insert goes away (see EditJobDialog-adjacent change in
--    useOfferHandlers.declineApplication).
--
-- 3. The direct-offer notification linked to '/activity?tab=offers'.
--    '/activity' was a bare <Navigate to="/my-posts">: it sent the helper to
--    the POSTER surface and dropped the query string on the way, so the offer
--    — which carries a 24h response_deadline — was reachable from nowhere in
--    the app. The route now maps legacy query values properly
--    (src/pages/ActivityLegacyRedirect.tsx), but the link itself should name
--    the real destination rather than lean on a compatibility shim.
--
-- Links point at real filters: activityFilters.ts routes a `rejected`
-- application into the `cancelled` bucket and a pending direct offer into
-- `direct_offer`.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The decline reason, so one notification can carry it.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS decline_reason text;

COMMENT ON COLUMN public.applications.decline_reason IS
  'Optional note the poster typed when declining. Read by notify_on_application() so the helper''s single decline notification carries the reason. Null for auto-rejections (reject_other_applications_on_accept).';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. notify_on_application — accept branch removed, reject branch enriched.
--    Body is otherwise byte-identical to the live definition
--    (20260827210851_drop_bidding_machinery.sql).
-- ───────────────────────────────────────────────────────────────────────────
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
    v_link := '/my-posts';

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

  -- NO 'accepted' branch. The client (useOfferHandlers) is the single
  -- producer for an accept: only it knows the response deadline the poster
  -- picked, and only its link ('/my-jobs?filter=offered') reaches the screen
  -- where the helper can actually accept before that deadline runs out.

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    v_user_id := NEW.helper_id;
    v_title := 'Application update';
    v_message := 'Your application for "' || job_title || '" was not selected';
    -- The poster's own words, when they left any. This is the whole reason
    -- the client used to fire a SECOND notification.
    IF NEW.decline_reason IS NOT NULL AND btrim(NEW.decline_reason) <> '' THEN
      v_message := v_message || ': ' || btrim(NEW.decline_reason);
    END IF;
    v_type := 'info';
    -- A rejected application buckets to `cancelled` on the applied tab
    -- (appliedActivityBucket). '/dashboard' showed the job board instead.
    v_link := '/my-jobs?filter=cancelled';

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

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Direct-offer notification points at a route that exists for a HELPER.
--    Body otherwise identical to 20260824070000.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_helper_on_direct_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_name text;
BEGIN
  IF NEW.offered_to_helper_id IS NOT NULL
     AND NEW.direct_offer_status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.offered_to_helper_id IS DISTINCT FROM NEW.offered_to_helper_id)
  THEN
    SELECT COALESCE(full_name, 'A poster') INTO v_poster_name
      FROM public.profiles WHERE user_id = NEW.customer_id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      NEW.offered_to_helper_id,
      'You got a direct job offer!',
      v_poster_name || ' offered you a job: "' || NEW.title || '" for $' || NEW.budget,
      'new_offers',
      -- was '/activity?tab=offers' — a redirect to the POSTER surface that
      -- also discarded the query string.
      '/my-jobs?filter=direct_offer'
    );
  END IF;
  RETURN NEW;
END;
$function$;
