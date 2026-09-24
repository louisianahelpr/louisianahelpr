-- Drop the Broadcasts feature (owner MQ19, 2026-09-24; S-004; Q363 + dead-code a8).
-- The owner removed Broadcasts on 2026-09-01. The client banner and admin
-- screen were deleted in ad146f151. Measured live 2026-09-24: broadcast_messages
-- 0 rows, broadcast_dismissals 0 rows. purge_user_data reaches
-- broadcast_dismissals only behind to_regclass(...) IS NOT NULL, so it keeps
-- working once the table is gone.

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-pending-broadcast-fan-outs') THEN
    PERFORM cron.unschedule('sweep-pending-broadcast-fan-outs');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.sweep_pending_broadcast_fan_outs();
DROP FUNCTION IF EXISTS public.fan_out_broadcast_to_notifications(uuid);

-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.broadcast_dismissals
-- ACK-REASON: Broadcasts removed by the owner 2026-09-01; deletion approved 2026-09-24 (MQ19).
-- ACK-DATA-LOSS: none; the table held 0 rows when measured live 2026-09-24 17:40Z.
DROP TABLE IF EXISTS public.broadcast_dismissals;
-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.broadcast_messages
-- ACK-REASON: Broadcasts removed by the owner 2026-09-01; deletion approved 2026-09-24 (MQ19).
-- ACK-DATA-LOSS: none; the table held 0 rows when measured live 2026-09-24 17:40Z.
DROP TABLE IF EXISTS public.broadcast_messages;

-- Its trigger went with the table; the trigger function is now unused.
DROP FUNCTION IF EXISTS public.set_broadcast_pending_fan_out();
