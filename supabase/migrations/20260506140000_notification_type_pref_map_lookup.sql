-- Replace the hardcoded CASE statement in fan_out_push_on_notification
-- with a lookup table. New notification types can now be added without a
-- migration to the trigger function — just INSERT a row.
--
-- Schema: each row maps notifications.type -> the column name in
-- notification_preferences that gates push for that type. NULL means
-- "no per-category gate, only the master push_enabled toggle applies".

CREATE TABLE IF NOT EXISTS public.notification_type_pref_map (
  type text PRIMARY KEY,
  pref_column text,
  description text
);

ALTER TABLE public.notification_type_pref_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read" ON public.notification_type_pref_map;
CREATE POLICY "Authenticated read"
  ON public.notification_type_pref_map FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('application',      'job_applications', 'New application on customer''s posted job'),
  ('job_update',       'job_updates',      'Status change on a job (singular form)'),
  ('job_updates',      'job_updates',      'Status change on a job'),
  ('job_match',        'job_updates',      'Job feed match for helper'),
  ('expired',          'job_updates',      'Job expired without bookings'),
  ('work_status',      'work_status',      'Helper status update (started/completed)'),
  ('transit_updates',  'transit_updates',  'Helper transit status (on the way / arrived)'),
  ('new_offers',       'new_offers',       'Direct offer made to specific helper'),
  ('review',           'reviews',          'Review posted on completed job'),
  ('payment',          'payments',         'Payment escrowed / released / refunded'),
  ('financial_alerts', 'financial_alerts', 'Tip received, payout sent, refund'),
  ('system_alert',     'system_alerts',    'Admin broadcast or platform-wide alert'),
  ('verified',         'system_alerts',    'IDV / business verification result')
ON CONFLICT (type) DO UPDATE SET
  pref_column = EXCLUDED.pref_column,
  description = EXCLUDED.description;

CREATE OR REPLACE FUNCTION public.fan_out_push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  prefs public.notification_preferences;
  pref_col text;
  category_allowed boolean := true;
  pref_value boolean;
  supabase_url text;
  service_role_key text;
BEGIN
  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;

  IF prefs.user_id IS NOT NULL THEN
    IF prefs.push_enabled IS NOT TRUE THEN
      RETURN NEW;
    END IF;

    SELECT pref_column INTO pref_col
      FROM public.notification_type_pref_map
      WHERE type = NEW.type;

    IF pref_col IS NOT NULL THEN
      -- Dynamic column read. pref_col comes from a controlled lookup
      -- table (PRIMARY KEY type, columns we control); no user input
      -- reaches this format() call, so no SQL injection vector.
      EXECUTE format('SELECT ($1).%I', pref_col) INTO pref_value USING prefs;
      IF pref_value IS NOT TRUE THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  SELECT decrypted_secret INTO supabase_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO service_role_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'fan_out_push_on_notification: vault secrets missing — push skipped for notification %', NEW.id;
    RETURN NEW;
  END IF;

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

REVOKE ALL ON FUNCTION public.fan_out_push_on_notification() FROM PUBLIC, anon, authenticated;
