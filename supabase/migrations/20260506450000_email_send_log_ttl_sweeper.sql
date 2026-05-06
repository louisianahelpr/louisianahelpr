-- email_send_log TTL sweeper.
--
-- email_send_log records every transactional email + its terminal
-- delivery status. Without TTL it grows forever — a marketplace
-- sending a few thousand emails/month accumulates ~50K rows/year.
-- The Resend dashboard is the canonical send history; our copy is
-- for in-app surfacing (AdminNotificationLogs) and quick joins
-- against profiles/templates.
--
-- 90-day retention on terminal statuses matches industry norms for
-- email-deliverability audit + matches the other two TTL sweepers
-- shipped today (notifications + error_logs).
--
-- Status values (from the CHECK constraint):
--   pending                       — in flight (do NOT auto-delete; might be hung)
--   sent / suppressed             — successful terminal states
--   failed / bounced / complained — failed terminal states
--   dlq                           — dead-letter queue (manual triage)
--
-- Retention rules:
--   - sent / suppressed       → 90 days
--   - failed / bounced /
--     complained              → 90 days  (Resend dashboard archives these too)
--   - dlq                     → KEEP FOREVER (manual triage queue;
--                              admins decide when to delete)
--   - pending                 → KEEP FOREVER (something's broken if
--                              an email is "pending" past 24h, but
--                              auto-deleting would hide that bug —
--                              process-email-queue should resolve
--                              pending rows; if it can't, that's a
--                              real incident, not a TTL concern)
--
-- Daily cron at 04:00 UTC = 23:00 CST.

CREATE OR REPLACE FUNCTION public.sweep_old_email_send_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  DELETE FROM public.email_send_log
  WHERE status IN ('sent', 'suppressed', 'failed', 'bounced', 'complained')
    AND created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_old_email_send_log() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sweep_old_email_send_log() IS
'Daily TTL sweep for email_send_log. Deletes rows in terminal sent/suppressed/failed/bounced/complained status >90d. Keeps dlq + pending forever (manual triage / hung-message detection respectively).';

-- Daily cron at 04:00 UTC (15 min after error_logs sweeper).
DO $$
BEGIN
  PERFORM cron.unschedule('sweep-old-email-send-log');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sweep-old-email-send-log',
  '0 4 * * *',
  $cron$SELECT public.sweep_old_email_send_log();$cron$
);
