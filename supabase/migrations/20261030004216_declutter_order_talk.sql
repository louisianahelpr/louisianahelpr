-- Declutter: the buyer and seller of a PAID order can message each other (audit 1028 part 2, D2-1; owner
-- decisions via the lead 2026-10-29: SEPARATE tables, not an order_id on declutter_handover_talks; builders 43 and 52).
--
-- Before: once an order was paid, the two had no way to reach each other, yet the refund notices and the refund
-- panel told them to "arrange it in Messages", and Messages has nothing for Declutter. The pre-checkout handover
-- chat (20261028235249) is tied to a buyer/seller PAIR with an agreed, unpaid sale, a 72-hour life and a
-- strike-waiver role in declutter_deadline_sweep, so it cannot carry a paid order's conversation.
--
-- What this adds:
--   1. declutter_order_talks (one per order) + declutter_order_talk_messages. Nobody reads or writes the tables
--      directly (RLS on, no member grant); the two RPCs below are the only way in.
--   2. declutter_order_talk_until(order): when the chat closes, computed from the order's own state (lead,
--      2026-10-29: open from payment until 48 hours after the handover; held open while a problem or a refund
--      request on the order is open; closes 24 hours after that resolves). NULL = never paid, no chat.
--      'infinity' = open with no end yet. An order that ended without a handover closes 24 hours after it ended.
--   3. declutter_order_talk_view(order): the caller's side, whether the chat is open and until when, and the whole
--      history, each message as "mine" or the other side's (no ids, no names).
--   4. declutter_send_order_message(order, body): either side, while the chat is open and neither has blocked the
--      other; the contact-leak filter (contact_leak_reason, as on listings, questions and the handover chat), 30
--      messages an hour, and the other side is told at most once per 15 minutes without the words (kind
--      declutter_sales, the item named so two orders' notices never collapse into one, Q2467).
--
-- No switch gate on purpose (row 62: a paid sale carries on with Declutter switched off, as declutter_report_problem
-- does). MONEY: none. No amount, order, payout or refund changes here.
--
-- REPLAY-SAFE: CREATE TABLE / INDEX IF NOT EXISTS, triggers dropped then created, CREATE OR REPLACE. Applied 3x in
-- PGlite (src/test/pglite/declutterOrderTalk.pglite.mjs).

-- 1. The chat.
CREATE TABLE IF NOT EXISTS public.declutter_order_talks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  buyer_notified_at timestamptz,
  seller_notified_at timestamptz
);
ALTER TABLE public.declutter_order_talks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_order_talks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_order_talks TO service_role;

CREATE TABLE IF NOT EXISTS public.declutter_order_talk_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talk_id uuid NOT NULL REFERENCES public.declutter_order_talks(id) ON DELETE CASCADE,
  -- The side is kept, so a message still reads "the buyer" / "the seller" after its sender deletes their account.
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_side text NOT NULL CHECK (sender_side IN ('buyer', 'seller')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_order_talk_messages_talk_idx
  ON public.declutter_order_talk_messages (talk_id, created_at);
CREATE INDEX IF NOT EXISTS declutter_order_talk_messages_sender_idx
  ON public.declutter_order_talk_messages (sender_id, created_at);
ALTER TABLE public.declutter_order_talk_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_order_talk_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_order_talk_messages TO service_role;

-- Q807: writes from an unconfirmed email are refused on every public table (the gate's own statement trigger).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The contact-leak filter, as on listings, questions and the handover chat (contact_leak_reason).
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_declutter_order_talk()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text := public.contact_leak_reason(NEW.body);
BEGIN
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in the message. Keep contact details and payment out of the chat.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_declutter_order_talk() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_declutter_order_talk ON public.declutter_order_talk_messages;
CREATE TRIGGER trg_reject_contact_leak_in_declutter_order_talk
  BEFORE INSERT OR UPDATE OF body ON public.declutter_order_talk_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_declutter_order_talk();

-- 2. Until when the chat is open, from the order's own rows.
CREATE OR REPLACE FUNCTION public.declutter_order_talk_until(p_order_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN o.id IS NULL OR o.paid_at IS NULL THEN NULL
    WHEN o.status = 'paid'
      OR EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
      OR EXISTS (SELECT 1 FROM public.declutter_refund_requests r
                  WHERE r.order_id = o.id AND r.status IN ('open', 'offered', 'returning', 'to_admin'))
      THEN 'infinity'::timestamptz
    ELSE GREATEST(
      -- 48 hours after the handover.
      CASE WHEN o.status = 'handed_over' OR o.handed_over_at IS NOT NULL
           THEN COALESCE(o.handed_over_at, o.closed_at, o.paid_at) + interval '48 hours' END,
      -- An order that ended another way (refunded, cancelled): 24 hours after it ended.
      CASE WHEN o.status <> 'handed_over' THEN COALESCE(o.closed_at, o.paid_at) + interval '24 hours' END,
      -- 24 hours after a problem or a refund request on it resolved.
      (SELECT max(p.decided_at) FROM public.declutter_problems p WHERE p.order_id = o.id) + interval '24 hours',
      (SELECT max(r.updated_at) FROM public.declutter_refund_requests r WHERE r.order_id = o.id) + interval '24 hours')
  END
  FROM (SELECT 1) AS one
  LEFT JOIN public.declutter_orders o ON o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_talk_until(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_talk_until(uuid) TO service_role;

-- 3. The chat as the caller sees it.
CREATE OR REPLACE FUNCTION public.declutter_order_talk_view(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_until timestamptz;
  v_messages jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF NOT FOUND OR v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_until := public.declutter_order_talk_until(o.id);
  IF v_until IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_side = v_side, 'body', m.body, 'created_at', m.created_at)
                            ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO v_messages
    FROM public.declutter_order_talk_messages m
    JOIN public.declutter_order_talks t ON t.id = m.talk_id
   WHERE t.order_id = o.id;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'side', v_side,
    'open', v_until > now() AND o.buyer_id IS NOT NULL AND o.seller_id IS NOT NULL
            AND NOT public.are_users_blocked(o.buyer_id, o.seller_id),
    'open_until', CASE WHEN v_until = 'infinity'::timestamptz THEN NULL ELSE v_until END,
    'messages', v_messages);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_talk_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_talk_view(uuid) TO authenticated, service_role;

-- 4. A message.
CREATE OR REPLACE FUNCTION public.declutter_send_order_message(p_order_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_talk public.declutter_order_talks%ROWTYPE;
  v_body text := btrim(COALESCE(p_body, ''));
  v_until timestamptz;
  v_to uuid;
  v_title text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock: a stranger never locks someone else's order.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_orders x WHERE x.id = p_order_id AND (x.buyer_id = v_uid OR x.seller_id = v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_until := public.declutter_order_talk_until(o.id);
  IF v_until IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_until <= now() OR o.buyer_id IS NULL OR o.seller_id IS NULL THEN
    RAISE EXCEPTION 'talk_closed' USING ERRCODE = '22023', HINT = 'This chat has ended.';
  END IF;
  IF public.are_users_blocked(o.buyer_id, o.seller_id) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023', HINT = 'Write a message of up to 1,000 characters.';
  END IF;
  INSERT INTO public.declutter_order_talks (order_id) VALUES (o.id) ON CONFLICT (order_id) DO NOTHING;
  SELECT * INTO v_talk FROM public.declutter_order_talks t WHERE t.order_id = o.id FOR UPDATE;
  -- At most 30 messages an hour from one person in one chat.
  IF (SELECT count(*) FROM public.declutter_order_talk_messages m
       WHERE m.talk_id = v_talk.id AND m.sender_id = v_uid AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'message_rate_limited' USING ERRCODE = '42501', HINT = 'Slow down a little, then send again.';
  END IF;
  INSERT INTO public.declutter_order_talk_messages (talk_id, sender_id, sender_side, body)
  VALUES (v_talk.id, v_uid, v_side, v_body)
  RETURNING id INTO v_id;
  -- Tell the other side, at most once per 15 minutes, never with the words themselves; the item is named (Q2467).
  v_to := CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END;
  IF (v_side = 'seller' AND (v_talk.buyer_notified_at IS NULL OR v_talk.buyer_notified_at < now() - interval '15 minutes'))
     OR (v_side = 'buyer' AND (v_talk.seller_notified_at IS NULL OR v_talk.seller_notified_at < now() - interval '15 minutes')) THEN
    SELECT i.title INTO v_title
      FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.order_id = o.id
     ORDER BY c.created_at, c.id LIMIT 1;
    PERFORM public.declutter_notify(v_to, 'declutter_sales', 'New message about your order',
      format('The %s sent you a message about "%s".', v_side, COALESCE(v_title, 'your Declutter order')),
      CASE WHEN v_side = 'seller' THEN '/declutter?tab=buying&order_talk=' ELSE '/declutter?tab=selling&order_talk=' END || o.id::text,
      v_uid);
    UPDATE public.declutter_order_talks
       SET buyer_notified_at = CASE WHEN v_side = 'seller' THEN now() ELSE buyer_notified_at END,
           seller_notified_at = CASE WHEN v_side = 'buyer' THEN now() ELSE seller_notified_at END
     WHERE id = v_talk.id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_send_order_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_send_order_message(uuid, text) TO authenticated, service_role;

-- 5. The caller's order chats for Messages -> Declutter: one row per order chat that has a message, newest first.
--    The item's title, the caller's side, when the last message was sent and whether it was theirs, and whether the
--    chat is still open. No ids of people, no names, no words.
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
               (SELECT i.title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                 WHERE c.order_id = o.id ORDER BY c.created_at, c.id LIMIT 1) AS title,
               last.created_at AS last_at,
               last.sender_side = public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) AS last_mine,
               (public.declutter_order_talk_until(o.id) > now() AND o.buyer_id IS NOT NULL AND o.seller_id IS NOT NULL
                AND NOT public.are_users_blocked(o.buyer_id, o.seller_id)) AS open
          FROM public.declutter_order_talks t
          JOIN public.declutter_orders o ON o.id = t.order_id
          CROSS JOIN LATERAL (
            SELECT m.created_at, m.sender_side FROM public.declutter_order_talk_messages m
             WHERE m.talk_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) last
         WHERE o.buyer_id = v_uid OR o.seller_id = v_uid
         ORDER BY last.created_at DESC
         LIMIT 50) x), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_order_talks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_order_talks() TO authenticated, service_role;
