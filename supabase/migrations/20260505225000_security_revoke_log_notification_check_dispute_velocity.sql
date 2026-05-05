-- Two server-only RPCs that have no frontend callsites:
--   - log_notification: called only from send-notification-email edge function (service_role)
--   - check_dispute_velocity: 0 callsites in repo (probably trigger helper)
-- Safe to revoke from PUBLIC, anon, and authenticated. service_role
-- (edge functions) keeps access via the explicit grant.
DO $$
DECLARE
  fn_name TEXT;
  fns TEXT[] := ARRAY['log_notification', 'check_dispute_velocity'];
BEGIN
  FOREACH fn_name IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM PUBLIC', fn_name);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM anon', fn_name);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM authenticated', fn_name);
  END LOOP;
END $$;
