-- Move broadcast undo from a React-state countdown to a server-side
-- pending_push_fan_out_at column. Tab-close, refresh, network drop —
-- none of these cause the push to silently never fire (or fire when an
-- admin thought they cancelled).
--
-- Design:
--   pending_push_fan_out_at  = target time push should fan out
--   push_fanned_out_at       = when sweeper actually fanned out (idempotency marker)
--   BEFORE INSERT trigger    = sets pending_push_fan_out_at := NOW() + 30s
--                              + enforces the per-admin rate limit at insert
--                                time so the row is never created if limit hit
--   Cancel from UI           = UPDATE pending_push_fan_out_at = NULL
--                              (sweeper skips, banner hidden via expires_at)
--   pg_cron every 1 minute   = inlines the fan-out logic, marks push_fanned_out_at
--
-- 1-minute cron means actual fan-out fires 30-90s after insert in the
-- worst case. Acceptable for an admin tool — the undo guarantee is what
-- matters, not the exact fire time.

ALTER TABLE public.broadcast_messages
  ADD COLUMN IF NOT EXISTS pending_push_fan_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS push_fanned_out_at timestamptz;

CREATE INDEX IF NOT EXISTS broadcast_messages_pending_fan_out_idx
  ON public.broadcast_messages (pending_push_fan_out_at)
  WHERE push_fanned_out_at IS NULL AND pending_push_fan_out_at IS NOT NULL;

-- BEFORE INSERT: stamp the target fire time + enforce rate limit. Pulling
-- the rate limit forward to insert time means the row is never created
-- in the over-limit case — UI shows the error immediately rather than
-- letting the row sit pending and then erroring at fan-out.
CREATE OR REPLACE FUNCTION public.set_broadcast_pending_fan_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recent_broadcast_count integer;
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    SELECT COUNT(*) INTO recent_broadcast_count
      FROM public.broadcast_messages
      WHERE created_by = NEW.created_by
        AND created_at > NOW() - INTERVAL '24 hours';
    IF recent_broadcast_count >= 3 THEN
      RAISE EXCEPTION 'Broadcast rate limit exceeded: % broadcasts in last 24h (max 3). Wait before sending more.', recent_broadcast_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.pending_push_fan_out_at IS NULL AND NEW.push_fanned_out_at IS NULL THEN
    NEW.pending_push_fan_out_at := NOW() + INTERVAL '30 seconds';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_broadcast_pending_fan_out_tg ON public.broadcast_messages;
CREATE TRIGGER set_broadcast_pending_fan_out_tg
  BEFORE INSERT ON public.broadcast_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_broadcast_pending_fan_out();

-- Sweeper: runs from pg_cron context, no auth checks (rate limit + admin
-- gate happen at INSERT time on broadcast_messages). LIMIT 50 keeps a
-- single tick bounded; absurd backlogs catch up over multiple ticks
-- rather than holding the cron worker.
CREATE OR REPLACE FUNCTION public.sweep_pending_broadcast_fan_outs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  this_pushed integer;
BEGIN
  FOR rec IN
    SELECT id, title, message
    FROM public.broadcast_messages
    WHERE pending_push_fan_out_at IS NOT NULL
      AND pending_push_fan_out_at <= NOW()
      AND push_fanned_out_at IS NULL
    ORDER BY pending_push_fan_out_at
    LIMIT 50
  LOOP
    BEGIN
      WITH eligible AS (
        SELECT DISTINCT pt.user_id
        FROM public.push_tokens pt
        LEFT JOIN public.notification_preferences np ON np.user_id = pt.user_id
        WHERE np.user_id IS NULL
           OR (np.push_enabled IS TRUE AND COALESCE(np.system_alerts, true) IS TRUE)
      )
      INSERT INTO public.notifications (user_id, type, title, message, read)
      SELECT user_id, 'system_alert', rec.title, rec.message, false
      FROM eligible;

      GET DIAGNOSTICS this_pushed = ROW_COUNT;
      total_pushed := total_pushed + this_pushed;

      UPDATE public.broadcast_messages
      SET push_fanned_out_at = NOW(),
          pending_push_fan_out_at = NULL
      WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sweep_pending_broadcast_fan_outs: row % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN total_pushed;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_pending_broadcast_fan_outs() FROM PUBLIC, anon, authenticated;

-- Schedule. Unschedule first to make this migration idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('sweep-pending-broadcast-fan-outs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'sweep-pending-broadcast-fan-outs',
  '* * * * *',
  $cron$SELECT public.sweep_pending_broadcast_fan_outs();$cron$
);
