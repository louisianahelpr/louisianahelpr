-- Wrap vault secret reads in STABLE helper functions so Postgres caches
-- the result within a single statement.
--
-- The fan_out_push_on_notification trigger fires per-row. When a
-- broadcast fan-out INSERTs N rows in a single statement, the original
-- code did 2*N decrypted_secrets lookups. STABLE-marked functions are
-- guaranteed to return the same result within a statement, so Postgres
-- can call once and reuse — collapsing 2*N to 2.
--
-- (We can't use ALTER DATABASE GUCs — that path was denied per
-- migration 20260505171500_triggers_read_from_vault.sql.)

CREATE OR REPLACE FUNCTION public.get_supabase_url()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_service_role_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_supabase_url() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_service_role_key() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fan_out_push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  prefs public.notification_preferences;
  pref_col text;
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
      EXECUTE format('SELECT ($1).%I', pref_col) INTO pref_value USING prefs;
      IF pref_value IS NOT TRUE THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  supabase_url := public.get_supabase_url();
  service_role_key := public.get_service_role_key();

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
