-- Auto-fire send-push-notification edge function on every public.notifications
-- INSERT, respecting the user's notification_preferences (master push_enabled
-- toggle + per-category bool).
--
-- Falls back to "fire push" when no preferences row exists yet — better UX
-- to ship the first push (which prompts the user to fine-tune settings) than
-- to silently swallow it.

CREATE OR REPLACE FUNCTION public.fan_out_push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  prefs public.notification_preferences;
  category_allowed boolean := true;
  supabase_url text;
  service_role_key text;
BEGIN
  -- Load prefs (may be NULL if user hasn't customized — default to allow)
  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;

  IF prefs.user_id IS NOT NULL THEN
    -- Master toggle short-circuits all push regardless of category
    IF prefs.push_enabled IS NOT TRUE THEN
      RETURN NEW;
    END IF;

    -- Map notification.type -> the preference category bool. Unknown types
    -- pass through (default-on for new categories until prefs are extended).
    category_allowed := CASE NEW.type
      WHEN 'application'      THEN prefs.job_applications
      WHEN 'job_update'       THEN prefs.job_updates
      WHEN 'job_updates'      THEN prefs.job_updates
      WHEN 'job_match'        THEN prefs.job_updates
      WHEN 'expired'          THEN prefs.job_updates
      WHEN 'work_status'      THEN prefs.work_status
      WHEN 'transit_updates'  THEN prefs.transit_updates
      WHEN 'new_offers'       THEN prefs.new_offers
      WHEN 'review'           THEN prefs.reviews
      WHEN 'payment'          THEN prefs.payments
      WHEN 'financial_alerts' THEN prefs.financial_alerts
      WHEN 'system_alert'     THEN prefs.system_alerts
      WHEN 'verified'         THEN prefs.system_alerts
      ELSE true
    END;

    IF category_allowed IS NOT TRUE THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Read vault secrets the same way our other cron-invoking triggers do
  -- (see migration 20260505171500_triggers_read_from_vault.sql).
  SELECT decrypted_secret INTO supabase_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO service_role_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'fan_out_push_on_notification: vault secrets missing — push skipped for notification %', NEW.id;
    RETURN NEW;
  END IF;

  -- Fire async — pg_net is non-blocking, so the INSERT completes and the
  -- HTTP call happens in the background. Failures don't roll back the
  -- notification row.
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_role_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      'body', NEW.message,
      'link', NEW.link,
      'thread_id', NEW.type
    )
  );

  RETURN NEW;
END;
$function$;

-- AFTER INSERT so the notification row is committed before push fires.
-- pg_net's http_post is async (returns request_id immediately), so even
-- with thousands of notifications/min the trigger doesn't block.
DROP TRIGGER IF EXISTS notifications_fan_out_to_push ON public.notifications;
CREATE TRIGGER notifications_fan_out_to_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fan_out_push_on_notification();

-- Match the security pattern of other internal trigger functions: revoke
-- direct EXECUTE so anon/authenticated can't fire this via /rest/v1/rpc/.
REVOKE ALL ON FUNCTION public.fan_out_push_on_notification() FROM PUBLIC, anon, authenticated;
