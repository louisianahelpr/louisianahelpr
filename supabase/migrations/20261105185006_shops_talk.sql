-- Shops H1 (audit ~/.lh-shots/audit-1105-shops.md, 2026-11-05; owner L48 "messages any time" and O9 "a Shops section
-- inbox"): a member can message a shop any time, before and after ordering, and the shop answers. Shops stays behind
-- its switch (testers). Pattern: 20261030004216_declutter_order_talk.sql (the same leak filter, block check, rate
-- limit and notice throttle), keyed by (shop, buyer) instead of an order, so one thread carries the questions before
-- an order and the talk about it after.
--
-- What this adds:
--   1. shop_talks (one per shop + member) and shop_talk_messages. RLS on, no member grant; the RPCs are the only way in.
--   2. shops_open_talk(shop): the member's thread with a shop they can see, made on first use (never their own shop).
--   3. shops_talk_view(talk): the caller's side, the other side's label (the shop's name, or the member's first name
--      for the shop), whether it is open, and the history, each message "mine" or not (no ids of people).
--   4. shops_send_talk_message(talk, body): either side, while neither has blocked the other and the shop is not
--      hidden; contact_leak_reason; 30 an hour; the other side is told at most once per 15 minutes, never the words.
--      The notice links to the shop's page with ?talk=<id>, which opens the thread there.
--   5. shops_my_talks(): the caller's threads for Messages -> Shops, newest first, both sides.
--   6. shops_mark_talk_read(talk): the caller's read mark, so the inbox can show unread.
-- Every RPC starts with require_feature('shops'). MONEY: none.
-- REPLAY-SAFE: CREATE TABLE / INDEX IF NOT EXISTS, triggers dropped then created, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsTalk.pglite.mjs (3x, Supabase's default anon grant emulated).

-- 1. The thread and its messages.
CREATE TABLE IF NOT EXISTS public.shop_talks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  buyer_notified_at timestamptz,
  shop_notified_at timestamptz,
  buyer_read_at timestamptz,
  shop_read_at timestamptz,
  CONSTRAINT shop_talks_one_per_pair UNIQUE (shop_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS shop_talks_buyer_idx ON public.shop_talks (buyer_id);
ALTER TABLE public.shop_talks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_talks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_talks TO service_role;

CREATE TABLE IF NOT EXISTS public.shop_talk_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talk_id uuid NOT NULL REFERENCES public.shop_talks(id) ON DELETE CASCADE,
  -- The side is kept, so a message still reads as the shop's or the member's after its sender deletes their account.
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_side text NOT NULL CHECK (sender_side IN ('buyer', 'shop')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_talk_messages_talk_idx ON public.shop_talk_messages (talk_id, created_at);
CREATE INDEX IF NOT EXISTS shop_talk_messages_sender_idx ON public.shop_talk_messages (sender_id, created_at);
ALTER TABLE public.shop_talk_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_talk_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_talk_messages TO service_role;

-- Q807: writes from an unconfirmed email are refused on every public table (the gate's own statement trigger).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The contact-leak filter, as on listings, questions and the Declutter chats (contact_leak_reason).
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_shop_talk()
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
      MESSAGE = v_reason || ' in the message. Keep phone numbers, emails and payment out of the chat; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_shop_talk() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_shop_talk ON public.shop_talk_messages;
CREATE TRIGGER trg_reject_contact_leak_in_shop_talk
  BEFORE INSERT OR UPDATE OF body ON public.shop_talk_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_shop_talk();

-- The caller's side of a thread: 'buyer', 'shop' (the shop's owner), or NULL.
CREATE OR REPLACE FUNCTION public.shop_talk_side(p_talk_id uuid, p_uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_uid IS NULL THEN NULL
              WHEN t.buyer_id = p_uid THEN 'buyer'
              WHEN s.owner_id = p_uid THEN 'shop' END
    FROM public.shop_talks t JOIN public.shops s ON s.id = t.shop_id
   WHERE t.id = p_talk_id;
$fn$;
REVOKE ALL ON FUNCTION public.shop_talk_side(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_talk_side(uuid, uuid) TO service_role;

-- 2. Open (or find) the caller's thread with a shop they can see.
CREATE OR REPLACE FUNCTION public.shops_open_talk(p_shop_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT owner_id INTO v_owner FROM public.shops WHERE id = p_shop_id;
  IF v_owner IS NULL OR NOT public.shop_state_ok(p_shop_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  IF public.are_users_blocked(v_uid, v_owner) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.shop_talks (shop_id, buyer_id) VALUES (p_shop_id, v_uid)
  ON CONFLICT (shop_id, buyer_id) DO NOTHING;
  SELECT id INTO v_id FROM public.shop_talks WHERE shop_id = p_shop_id AND buyer_id = v_uid;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_open_talk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_open_talk(uuid) TO authenticated, service_role;

-- 3. The thread as the caller sees it.
CREATE OR REPLACE FUNCTION public.shops_talk_view(p_talk_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.shop_talks%ROWTYPE;
  s public.shops%ROWTYPE;
  v_side text;
  v_messages jsonb;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_side := public.shop_talk_side(p_talk_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'talk_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO t FROM public.shop_talks WHERE id = p_talk_id;
  SELECT * INTO s FROM public.shops WHERE id = t.shop_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_side = v_side, 'body', m.body, 'created_at', m.created_at)
                            ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO v_messages
    FROM public.shop_talk_messages m WHERE m.talk_id = t.id;
  RETURN jsonb_build_object(
    'talk_id', t.id,
    'shop_id', s.id,
    'side', v_side,
    -- The shop's name for the member; the member's first name for the shop (never a full name or an id).
    'other_label', CASE WHEN v_side = 'buyer' THEN s.name
                        ELSE COALESCE(NULLIF(split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = t.buyer_id)), ' ', 1), ''), 'A shopper') END,
    'open', s.hidden_at IS NULL AND NOT public.are_users_blocked(t.buyer_id, s.owner_id),
    'messages', v_messages);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_talk_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_talk_view(uuid) TO authenticated, service_role;

-- 4. A message.
CREATE OR REPLACE FUNCTION public.shops_send_talk_message(p_talk_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.shop_talks%ROWTYPE;
  s public.shops%ROWTYPE;
  v_side text;
  v_body text := btrim(COALESCE(p_body, ''));
  v_id uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock: a stranger never locks someone else's thread.
  v_side := public.shop_talk_side(p_talk_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'talk_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO t FROM public.shop_talks WHERE id = p_talk_id FOR UPDATE;
  SELECT * INTO s FROM public.shops WHERE id = t.shop_id;
  IF s.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'talk_closed' USING ERRCODE = '22023', HINT = 'This shop is not on Helpr right now.';
  END IF;
  IF public.are_users_blocked(t.buyer_id, s.owner_id) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023', HINT = 'Write a message of up to 1,000 characters.';
  END IF;
  IF (SELECT count(*) FROM public.shop_talk_messages m
       WHERE m.talk_id = t.id AND m.sender_id = v_uid AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'message_rate_limited' USING ERRCODE = '42501', HINT = 'Slow down a little, then send again.';
  END IF;
  INSERT INTO public.shop_talk_messages (talk_id, sender_id, sender_side, body)
  VALUES (t.id, v_uid, v_side, v_body)
  RETURNING id INTO v_id;
  -- The sender has read everything up to their own message.
  UPDATE public.shop_talks
     SET buyer_read_at = CASE WHEN v_side = 'buyer' THEN now() ELSE buyer_read_at END,
         shop_read_at = CASE WHEN v_side = 'shop' THEN now() ELSE shop_read_at END
   WHERE id = t.id;
  -- Tell the other side, at most once per 15 minutes, never with the words themselves.
  IF v_side = 'buyer' AND (t.shop_notified_at IS NULL OR t.shop_notified_at < now() - interval '15 minutes') THEN
    PERFORM public.declutter_notify(s.owner_id, 'info', 'New message for your shop',
      format('A shopper sent %s a message.', s.name), '/shops/' || s.id::text || '?talk=' || t.id::text, v_uid);
    UPDATE public.shop_talks SET shop_notified_at = now() WHERE id = t.id;
  ELSIF v_side = 'shop' AND (t.buyer_notified_at IS NULL OR t.buyer_notified_at < now() - interval '15 minutes') THEN
    PERFORM public.declutter_notify(t.buyer_id, 'info', 'New message from a shop',
      format('%s answered you.', s.name), '/shops/' || s.id::text || '?talk=' || t.id::text, v_uid);
    UPDATE public.shop_talks SET buyer_notified_at = now() WHERE id = t.id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_send_talk_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_send_talk_message(uuid, text) TO authenticated, service_role;

-- 5. The caller's threads for Messages -> Shops: one row per thread that has a message, newest first, both sides.
CREATE OR REPLACE FUNCTION public.shops_my_talks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.last_at DESC, x.talk_id)
      FROM (
        SELECT t.id AS talk_id,
               CASE WHEN t.buyer_id = v_uid THEN 'buyer' ELSE 'shop' END AS side,
               CASE WHEN t.buyer_id = v_uid THEN s.name
                    ELSE COALESCE(NULLIF(split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = t.buyer_id)), ' ', 1), ''), 'A shopper') END AS other_label,
               last.created_at AS last_at,
               last.sender_side = CASE WHEN t.buyer_id = v_uid THEN 'buyer' ELSE 'shop' END AS last_mine,
               last.created_at > COALESCE(CASE WHEN t.buyer_id = v_uid THEN t.buyer_read_at ELSE t.shop_read_at END, '-infinity'::timestamptz)
                 AND last.sender_side <> CASE WHEN t.buyer_id = v_uid THEN 'buyer' ELSE 'shop' END AS unread
          FROM public.shop_talks t
          JOIN public.shops s ON s.id = t.shop_id
          CROSS JOIN LATERAL (
            SELECT m.created_at, m.sender_side FROM public.shop_talk_messages m
             WHERE m.talk_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) last
         WHERE t.buyer_id = v_uid OR s.owner_id = v_uid
         ORDER BY last.created_at DESC
         LIMIT 50) x), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_talks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_talks() TO authenticated, service_role;

-- 6. The caller has read the thread.
CREATE OR REPLACE FUNCTION public.shops_mark_talk_read(p_talk_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_side text;
BEGIN
  PERFORM public.require_feature('shops');
  v_side := public.shop_talk_side(p_talk_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'talk_not_found' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.shop_talks
     SET buyer_read_at = CASE WHEN v_side = 'buyer' THEN now() ELSE buyer_read_at END,
         shop_read_at = CASE WHEN v_side = 'shop' THEN now() ELSE shop_read_at END
   WHERE id = p_talk_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_mark_talk_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_mark_talk_read(uuid) TO authenticated, service_role;
