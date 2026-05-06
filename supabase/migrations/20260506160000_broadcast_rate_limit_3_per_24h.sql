-- Rate-limit admin broadcasts to 3 per 24h per admin. Without this,
-- one runaway admin (or a misclick on a hot iOS-cached form) could
-- nuke push reputation by spamming every device.
--
-- Enforced inside fan_out_broadcast_to_notifications since that's the
-- single chokepoint every broadcast goes through. Returns count on
-- success, raises exception when over the limit.

CREATE OR REPLACE FUNCTION public.fan_out_broadcast_to_notifications(_broadcast_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  bm RECORD;
  inserted_count integer;
  recent_broadcast_count integer;
  caller_id uuid;
BEGIN
  caller_id := (SELECT auth.uid());
  IF NOT public.has_role(caller_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'fan_out_broadcast_to_notifications requires admin role';
  END IF;

  SELECT COUNT(*) INTO recent_broadcast_count
    FROM public.broadcast_messages
    WHERE created_by = caller_id
      AND created_at > NOW() - INTERVAL '24 hours';
  IF recent_broadcast_count > 3 THEN
    RAISE EXCEPTION 'Broadcast rate limit exceeded: % broadcasts in last 24h (max 3). Wait before sending more.', recent_broadcast_count;
  END IF;

  SELECT id, title, message INTO bm FROM public.broadcast_messages WHERE id = _broadcast_id;
  IF bm.id IS NULL THEN
    RAISE EXCEPTION 'Broadcast % not found', _broadcast_id;
  END IF;

  WITH eligible AS (
    SELECT DISTINCT pt.user_id
    FROM public.push_tokens pt
    LEFT JOIN public.notification_preferences np ON np.user_id = pt.user_id
    WHERE np.user_id IS NULL
       OR (np.push_enabled IS TRUE AND COALESCE(np.system_alerts, true) IS TRUE)
  )
  INSERT INTO public.notifications (user_id, type, title, message, read)
  SELECT user_id, 'system_alert', bm.title, bm.message, false
  FROM eligible;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fan_out_broadcast_to_notifications(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fan_out_broadcast_to_notifications(uuid) TO authenticated;
