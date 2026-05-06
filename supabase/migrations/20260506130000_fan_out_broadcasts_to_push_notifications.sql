-- Fan out an admin broadcast to per-user notifications. Each notification
-- INSERT triggers the existing fan_out_push_on_notification trigger
-- (migration 20260506120000), so push delivery happens automatically
-- and async via pg_net.
--
-- Eligibility:
--   - User has a row in push_tokens (no point notifying users without
--     a registered device — they'd see the banner anyway when they next
--     visit Dashboard)
--   - notification_preferences either absent (default-allow) OR
--     push_enabled=true AND system_alerts=true
--
-- Returns the count of notifications created.

CREATE OR REPLACE FUNCTION public.fan_out_broadcast_to_notifications(_broadcast_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  bm RECORD;
  inserted_count integer;
BEGIN
  -- Authorization: only admins can fan out broadcasts
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
    RAISE EXCEPTION 'fan_out_broadcast_to_notifications requires admin role';
  END IF;

  SELECT id, title, message INTO bm FROM public.broadcast_messages WHERE id = _broadcast_id;
  IF bm.id IS NULL THEN
    RAISE EXCEPTION 'Broadcast % not found', _broadcast_id;
  END IF;

  -- Bulk-insert one notification per eligible user. The
  -- fan_out_push_on_notification trigger fires per-row via pg_net and
  -- doesn't block this transaction.
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

-- Match security pattern of other admin-only RPCs: revoke from anon,
-- grant only to authenticated (admin check is enforced in body).
REVOKE ALL ON FUNCTION public.fan_out_broadcast_to_notifications(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fan_out_broadcast_to_notifications(uuid) TO authenticated;

COMMENT ON FUNCTION public.fan_out_broadcast_to_notifications(uuid) IS
  'Admin RPC. Inserts one notifications row per eligible user (has push_token + push_enabled + system_alerts) for a broadcast_messages row. Each insert triggers fan_out_push_on_notification -> APNs/FCM push. Returns count of notifications created.';
