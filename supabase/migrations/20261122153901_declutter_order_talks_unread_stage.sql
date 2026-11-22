-- Audit 1122 #138: Messages -> Declutter rows had no unread state and no order status, so a buyer's message about a
-- paid pickup never counted as unread and never showed under Unread, and a paid order waiting for its handover read
-- the same as any other. declutter_my_order_talks() (newest body: 20261111155616) now also returns, per row:
--   unread  true when the last message is the other side's and is newer than the caller's own read mark
--           (buyer_read_at / seller_read_at, set by declutter_mark_talk_read, 20261101200929): the same rule the unread
--           reminders use;
--   stage   the order's status (paid, handed_over, refunded, ...), so the row can say where the order stands.
-- Nothing else changes: still the caller's own orders only (buyer or seller = auth.uid()), still no person's id, no
-- name and no message words (left as built in 20261030004216; see the lead's note on #138). Grants restated unchanged.
-- Replay-safe: CREATE OR REPLACE, same signature and return type.
CREATE OR REPLACE FUNCTION public.declutter_my_order_talks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.last_at DESC, x.order_id)
      FROM (
        SELECT o.id AS order_id,
               s.side AS side,
               first_item.title AS title,
               (SELECT p.storage_path FROM public.declutter_item_photos p
                 WHERE p.item_id = first_item.id ORDER BY p.position, p.id LIMIT 1) AS photo_path,
               last.created_at AS last_at,
               last.sender_side = s.side AS last_mine,
               (public.declutter_order_talk_until(o.id) > now() AND o.buyer_id IS NOT NULL AND o.seller_id IS NOT NULL
                AND NOT public.are_users_blocked(o.buyer_id, o.seller_id)) AS open,
               (last.sender_side IS DISTINCT FROM s.side
                AND (s.my_read_at IS NULL OR last.created_at > s.my_read_at)) AS unread,
               o.status AS stage
          FROM public.declutter_order_talks t
          JOIN public.declutter_orders o ON o.id = t.order_id
          CROSS JOIN LATERAL (
            SELECT d.side, CASE WHEN d.side = 'buyer' THEN t.buyer_read_at ELSE t.seller_read_at END AS my_read_at
              FROM (SELECT public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) AS side) d) s
          CROSS JOIN LATERAL (
            SELECT m.created_at, m.sender_side FROM public.declutter_order_talk_messages m
             WHERE m.talk_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) last
          LEFT JOIN LATERAL (
            SELECT i.id, i.title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
             WHERE c.order_id = o.id ORDER BY c.created_at, c.id LIMIT 1) first_item ON true
         WHERE o.buyer_id = v_uid OR o.seller_id = v_uid
         ORDER BY last.created_at DESC
         LIMIT 50) x), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_order_talks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_order_talks() TO authenticated, service_role;
