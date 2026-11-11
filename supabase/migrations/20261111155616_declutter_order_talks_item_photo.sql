-- F422 (whole-app audit 2026-11-10; owner pop-up 11-11 morning): Messages rows are title first WITH their photo.
-- A Declutter order chat's row showed a grey sofa icon where a job row shows a picture. The row now leads with the
-- photo of the same item whose title it shows: `photo_path`, the storage path (public Declutter photos bucket) of
-- that item's first photo by position, or null when the item or its photos are gone.
--
-- Everything else is 20261030004216_declutter_order_talk.sql's definition, unchanged: the caller's side, when the
-- last message was sent and whether it was theirs, and whether the chat is open. Still no ids of people, no names,
-- no words. Replay-safe: CREATE OR REPLACE of the same signature, grants restated.
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
               public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) AS side,
               first_item.title AS title,
               (SELECT p.storage_path FROM public.declutter_item_photos p
                 WHERE p.item_id = first_item.id ORDER BY p.position, p.id LIMIT 1) AS photo_path,
               last.created_at AS last_at,
               last.sender_side = public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) AS last_mine,
               (public.declutter_order_talk_until(o.id) > now() AND o.buyer_id IS NOT NULL AND o.seller_id IS NOT NULL
                AND NOT public.are_users_blocked(o.buyer_id, o.seller_id)) AS open
          FROM public.declutter_order_talks t
          JOIN public.declutter_orders o ON o.id = t.order_id
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
