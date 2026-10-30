-- The admin problem card shows the paid-order chat too (audit 1028 part 2, D2-1 leftover; plan approved by the lead
-- 2026-10-30). Before: declutter_admin_problem_talk returned the pre-checkout handover chat and the item questions,
-- but not the chat the buyer and seller had AFTER paying (20261030004216_declutter_order_talk), which is where a
-- problem or a refund is usually talked through. Now a third kind, 'order_chat', lists that order's messages:
-- who wrote each line is the side kept on the message (sender_side), never a name or an id.
-- Restated VERBATIM from prod's effective body (pg_get_functiondef, read 2026-10-30; prosrc md5
-- ce405411580112438ce48e019334d41c), plus only the third UNION ALL branch. Same signature and return columns, so
-- CREATE OR REPLACE; grants restated as live. Admin only, as before (has_role admin, checked first).
-- Replay-safe: CREATE OR REPLACE; the order-chat tables come from 20261030004216 (earlier on this train).

CREATE OR REPLACE FUNCTION public.declutter_admin_problem_talk(p_problem_id uuid)
 RETURNS TABLE(kind text, side text, body text, said_at timestamp with time zone, answer text, answered_at timestamp with time zone, removed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_order public.declutter_orders%ROWTYPE;
  v_from timestamptz;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  SELECT o.* INTO v_order
    FROM public.declutter_problems p JOIN public.declutter_orders o ON o.id = p.order_id
   WHERE p.id = p_problem_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- The order's own window: from its first line entering the cart to the payment (a talk opens only while a line is
  -- in the cart, so a chat about an earlier or later sale between the same two is not this order's).
  SELECT min(c.created_at) INTO v_from FROM public.declutter_cart_items c WHERE c.order_id = v_order.id;
  RETURN QUERY
    SELECT x.kind, x.side, x.body, x.said_at, x.answer, x.answered_at, x.removed
      FROM (
        SELECT 'chat'::text AS kind,
               CASE WHEN m.sender_id = t.buyer_id THEN 'buyer' ELSE 'seller' END AS side,
               m.body, m.created_at AS said_at, NULL::text AS answer, NULL::timestamptz AS answered_at, false AS removed,
               m.id AS sort_id
          FROM public.declutter_handover_talks t
          JOIN public.declutter_handover_talk_messages m ON m.talk_id = t.id
         WHERE t.buyer_id = v_order.buyer_id AND t.seller_id = v_order.seller_id
           AND t.opened_at >= COALESCE(v_from, v_order.created_at)
           AND t.opened_at <= COALESCE(v_order.paid_at, now())
        UNION ALL
        SELECT 'question'::text,
               CASE WHEN q.asker_id = v_order.buyer_id THEN 'buyer' ELSE 'another_member' END,
               q.question, q.created_at, q.answer, q.answered_at, q.removed_at IS NOT NULL,
               q.id
          FROM public.declutter_questions q
         WHERE q.item_id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = v_order.id)
        UNION ALL
        -- D2-1: the chat after payment, this order's only (one chat per order). The side is the message's own.
        SELECT 'order_chat'::text,
               om.sender_side,
               om.body, om.created_at, NULL::text, NULL::timestamptz, false,
               om.id
          FROM public.declutter_order_talks ot
          JOIN public.declutter_order_talk_messages om ON om.talk_id = ot.id
         WHERE ot.order_id = v_order.id
      ) x
     ORDER BY x.said_at, x.sort_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_problem_talk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_problem_talk(uuid) TO authenticated, service_role;
