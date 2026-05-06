-- Three SECURITY DEFINER functions added today were callable via
-- PostgREST RPC by anon + authenticated roles, even though all three
-- are only ever meant to be invoked by triggers (set_broadcast_*,
-- auto_escalate_*) or by service_role / cron (fan_out_broadcast_*).
-- Flagged by the Supabase database linter (anon_security_definer_*,
-- authenticated_security_definer_*).
--
-- Tighten so only triggers + service_role can reach them. The
-- AdminBroadcasts UI no longer calls fan_out_broadcast_to_notifications
-- directly (the new flow goes through the BEFORE INSERT trigger plus
-- the pg_cron sweeper) — confirmed via grep across src/ and
-- supabase/functions/.

REVOKE ALL ON FUNCTION public.auto_escalate_reports() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_broadcast_pending_fan_out() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fan_out_broadcast_to_notifications(uuid) FROM PUBLIC, anon, authenticated;
