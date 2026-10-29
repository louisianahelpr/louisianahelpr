-- AL-6 "Chats saved and filtered" (owner 2026-10-28, anti-lying measures, ~/.lh-wt/declutter-next-queue-1028.md #6:
-- "the per-sale buyer-seller chat and the questions keep history and the contact-leak filter. Verify the history is
-- kept and visible to admin in disputes").
--
-- VERIFIED BEFORE THIS (code read of the newest definitions on this branch, 2026-10-28):
--   * The handover chat (20261028235249_declutter_handover_talk): no member grant but SELECT on either table, no
--     DELETE anywhere (a talk is only ever closed: closed_at), every message through declutter_send_handover_message,
--     the contact-leak trigger on INSERT and UPDATE of body. Proven in src/test/pglite/declutterHandoverChoices.pglite.mjs.
--   * Item questions (20261014193955_declutter_foundation): the same contact-leak trigger on question and answer;
--     a question is hidden with removed_at, never deleted by any function; members read it without asker_id
--     (20261021122157_declutter_item_questions).
--   What no one could do: read either one for a reported problem. The admin problem card had only the report.
--
-- declutter_admin_problem_talk(p_problem_id) (new, read-only): for one reported problem, every message of the handover
-- chats between that order's buyer and seller opened while its items waited in the buyer's cart (from the first
-- line's cart time to the payment), and every question on the order's items with its answer, removed ones included
-- (marked), oldest first. Who wrote it is a SIDE only: 'buyer' / 'seller', or 'another_member' for a question someone
-- else asked; never a name, id, email or address (an admin reads the order's two names on the card already).
-- has_role admin is the FIRST statement (42501 not_admin). No require_feature on purpose (row 62: open problems on paid
-- sales stay decidable with the switch off). Admin-only personal data (members' words): needs lh-authz-rls.
-- STABLE SECURITY DEFINER, search_path pinned; REVOKE FROM PUBLIC, anon; GRANT authenticated (the admin console calls
-- it as the admin), service_role.
-- REPLAY-SAFETY: CREATE OR REPLACE of a new function; REVOKE/GRANT repeat.
-- Proof: src/test/pglite/declutterHandoverChoices.pglite.mjs T9 (applied 3x).

CREATE OR REPLACE FUNCTION public.declutter_admin_problem_talk(p_problem_id uuid)
RETURNS TABLE(kind text, side text, body text, said_at timestamptz, answer text, answered_at timestamptz, removed boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
      ) x
     ORDER BY x.said_at, x.sort_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_problem_talk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_problem_talk(uuid) TO authenticated, service_role;
