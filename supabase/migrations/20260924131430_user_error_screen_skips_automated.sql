-- Ledger 3a8fb52e: a HeadlessChrome (Playwright) boot on a stale deploy was
-- counted as a real guest and paged as a user-error-screen. The client now
-- tags every error_logs row from a WebDriver/CDP-driven browser with
-- tags.automated = true (src/lib/errorLogger.ts, navigator.webdriver, the
-- signal Sentry already uses for Q275). A test runner's screen is not a
-- person's, so it neither opens nor keeps open a user-error-screen item.
-- The tag is client-set: a browser can hide only its own reports with it.
CREATE OR REPLACE FUNCTION public.user_error_screen_is_real(p_user_id uuid, p_tags jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT public.error_log_is_seed(p_tags)
     AND coalesce(p_tags ->> 'automated', '') <> 'true'
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p_user_id IS NOT NULL
                        AND p.user_id = p_user_id
                        AND p.is_seed IS TRUE)
$function$;

REVOKE ALL ON FUNCTION public.user_error_screen_is_real(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_error_screen_is_real(uuid, jsonb) TO service_role;
