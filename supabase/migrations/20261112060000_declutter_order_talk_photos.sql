-- Declutter order chat: a photo on a message (audit 11-10 F389, Builder 1 lane b1h, overnight 11-12).
--
-- Before: the order chat had a text box only, though "is it scratched?" / "here's the dent" is what buyers and
-- sellers of used things most often need to show. Now either side of the order may send ONE photo with a message
-- (with or without words).
--
-- Reused, not new (the order's other private photos: porch, problem and return photos, 20261017055502 /
-- 20261030071818):
--   * the PRIVATE declutter-handover bucket (public = false, image/jpeg only, 10 MB), served only by a signed URL;
--   * its path rule <uid>/declutter/<kind>/<order>/<file>, a NEW kind 'talk';
--   * its one access function, declutter_handover_photo_access, restated from 20261030071818 verbatim plus 'talk';
--   * the app cleans each photo exactly as every Declutter photo (cleanListingPhoto: metadata incl. GPS stripped,
--     at most 1920 px, JPEG). No AI check: the listing photo check decides whether an ITEM may be sold, which a
--     chat photo is not; job chat attachments have none either. Content goes live at once; the other side can
--     still Report a problem on the order (owner 11-01: admin only on reports / failed auto-checks).
--
-- What this does:
--   1. declutter_order_talk_messages.photo_path (nullable). A message is words (1-1000) OR a photo with no words;
--      the photo path must be the 'talk' shape, and one photo belongs to one message (unique).
--   2. declutter_handover_photo_access: 'talk' folder.
--        WRITE  your own <uid> folder, an order you are a side of, while that order's chat is OPEN (paid and within
--               declutter_order_talk_until, both sides still have accounts, neither blocked the other) and you
--               are not banned.
--        READ   the two sides only, and NOT when the photo is the other side's and either blocked the other or
--               either is banned (declutter_names_hidden, the rule that hides names). An admin reads a talk photo
--               only on an order with a problem report (admin sees reports, not chats).
--   3. declutter_order_talk_view: each message also carries photo_path (null when none, or when hidden as above:
--      then photo_hidden is true). Restated from 20261103050349 verbatim otherwise.
--   4. declutter_send_order_message(order, body, photo_path DEFAULT NULL): restated from 20261103055505 verbatim plus
--      the photo: it must be the caller's own 'talk' object for THIS order, already uploaded, not on another
--      message. A photo with no words is allowed. The notice says "sent you a photo" (never the words or the photo).
--      The old two-argument form is dropped; two-argument calls (older apps, manager mode's dispatcher) resolve to
--      the new one through the default.
--
-- MONEY: none. No switch gate (row 62, as 20261030004216).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT/INDEX IF EXISTS before ADD/CREATE, DROP FUNCTION IF EXISTS,
-- CREATE OR REPLACE. Proof: src/test/pglite/declutterOrderTalkPhotos.pglite.mjs (3x).

-- 1. The column.
ALTER TABLE public.declutter_order_talk_messages ADD COLUMN IF NOT EXISTS photo_path text;
ALTER TABLE public.declutter_order_talk_messages DROP CONSTRAINT IF EXISTS declutter_order_talk_messages_body_check;
ALTER TABLE public.declutter_order_talk_messages DROP CONSTRAINT IF EXISTS declutter_order_talk_messages_body_or_photo;
ALTER TABLE public.declutter_order_talk_messages ADD CONSTRAINT declutter_order_talk_messages_body_or_photo
  CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000 OR (body = '' AND photo_path IS NOT NULL));
ALTER TABLE public.declutter_order_talk_messages DROP CONSTRAINT IF EXISTS declutter_order_talk_messages_photo_path_shape;
ALTER TABLE public.declutter_order_talk_messages ADD CONSTRAINT declutter_order_talk_messages_photo_path_shape
  CHECK (photo_path IS NULL
         OR photo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/declutter/talk/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$');
DROP INDEX IF EXISTS public.declutter_order_talk_messages_photo_idx;
CREATE UNIQUE INDEX declutter_order_talk_messages_photo_idx
  ON public.declutter_order_talk_messages (photo_path) WHERE photo_path IS NOT NULL;
COMMENT ON COLUMN public.declutter_order_talk_messages.photo_path IS
  'F389: storage path in the PRIVATE declutter-handover bucket (<uid>/declutter/talk/<order>/<file>), never a URL. Read by signed URL; declutter_handover_photo_access decides who.';

-- 2. Who may write or read an object of the bucket, from its path alone.
CREATE OR REPLACE FUNCTION public.declutter_handover_photo_access(p_name text, p_write boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
BEGIN
  IF v_uid IS NULL OR p_name IS NULL OR p_write IS NULL
     -- Exactly <uid>/declutter/<handover|problem|return|talk>/<order>/<file>: no extra or empty segments.
     OR array_length(string_to_array(p_name, '/'), 1) IS DISTINCT FROM 5
     OR split_part(p_name, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_name, '/', 3) NOT IN ('handover', 'problem', 'return', 'talk')
     OR split_part(p_name, '/', 4) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR split_part(p_name, '/', 5) = ''
     OR split_part(p_name, '/', 6) <> '' THEN
    RETURN false;
  END IF;
  v_order := split_part(p_name, '/', 4)::uuid;
  -- F389 (20261112060000): an order chat photo.
  IF split_part(p_name, '/', 3) = 'talk' THEN
    IF p_write THEN
      -- Into your own folder, on an order you are a side of, only while its chat is open and you may write in it.
      RETURN split_part(p_name, '/', 1) = v_uid::text
         AND NOT public.is_caller_banned()
         AND EXISTS (SELECT 1 FROM public.declutter_orders o
                      WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid)
                        AND o.buyer_id IS NOT NULL AND o.seller_id IS NOT NULL
                        AND public.declutter_order_talk_until(o.id) > now()
                        AND NOT public.are_users_blocked(o.buyer_id, o.seller_id));
    END IF;
    -- The two sides; the other side's photo not once either blocked the other or either is banned (as names).
    -- An admin only on an order with a problem report.
    RETURN EXISTS (SELECT 1 FROM public.declutter_orders o
                    WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid)
                      AND (split_part(p_name, '/', 1) = v_uid::text
                           OR (split_part(p_name, '/', 1) IN (o.buyer_id::text, o.seller_id::text)
                               AND NOT public.declutter_names_hidden(o.buyer_id, o.seller_id))))
        OR (public.has_role(v_uid, 'admin')
            AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = v_order));
  END IF;
  IF p_write THEN
    -- A return photo (20261030071818): into your own folder, only while the order's refund request is returning.
    IF split_part(p_name, '/', 3) = 'return' THEN
      RETURN split_part(p_name, '/', 1) = v_uid::text
         AND EXISTS (SELECT 1 FROM public.declutter_orders o
                       JOIN public.declutter_refund_requests r ON r.order_id = o.id
                      WHERE o.id = v_order AND r.status = 'returning' AND (o.buyer_id = v_uid OR o.seller_id = v_uid));
    END IF;
    -- Only into your own folder, only for an order you are a party of, and
    -- only while it is paid (both RPCs take a photo only then; lh-authz-rls
    -- review of lane J, should-fix 2: no uploads to a refunded or closed order).
    -- D2-3 (Builder 45, measured live 2026-10-29): problem and refund photos are taken after the handover too, so
    -- the 'problem' folder also takes uploads while the order is handed over and a problem can still be reported,
    -- a refund request waits for an answer, or a problem is open (the other side adds theirs). Handover photos: paid only.
    RETURN split_part(p_name, '/', 1) = v_uid::text
       AND EXISTS (SELECT 1 FROM public.declutter_orders o
                    WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid)
                      AND (o.status = 'paid'
                           OR (split_part(p_name, '/', 3) = 'problem' AND o.status = 'handed_over'
                               AND (public.declutter_problem_window_open(o.id)
                                    OR EXISTS (SELECT 1 FROM public.declutter_refund_requests r
                                                WHERE r.order_id = o.id AND r.status IN ('open', 'offered', 'returning'))
                                    OR EXISTS (SELECT 1 FROM public.declutter_problems x
                                                WHERE x.order_id = o.id AND x.status = 'open')))));
  END IF;
  RETURN public.has_role(v_uid, 'admin')
      OR EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_handover_photo_access(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_handover_photo_access(text, boolean) TO authenticated, service_role;

-- 3. The chat as the caller sees it (restated from 20261103050349; only the message's photo is new).
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_until := public.declutter_order_talk_until(o.id);
  IF v_until IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_side = v_side, 'body', m.body, 'created_at', m.created_at,
                            -- CHANGED 20261112060000 (F389): the photo, none of the other side's once names are hidden.
                            'photo_path', CASE WHEN m.sender_side <> v_side AND public.declutter_names_hidden(o.buyer_id, o.seller_id)
                                               THEN NULL ELSE m.photo_path END,
                            'photo_hidden', m.photo_path IS NOT NULL AND m.sender_side <> v_side
                                            AND public.declutter_names_hidden(o.buyer_id, o.seller_id))
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

REVOKE ALL ON FUNCTION public.declutter_order_talk_view(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_talk_view(p_order_id uuid) TO authenticated, service_role;

-- 4. A message, now optionally with a photo (restated from 20261103055505; the old two-argument form goes).
DROP FUNCTION IF EXISTS public.declutter_send_order_message(uuid, text);
CREATE OR REPLACE FUNCTION public.declutter_send_order_message(p_order_id uuid, p_body text, p_photo_path text DEFAULT NULL)
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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
  -- CHANGED 20261112060000 (F389): a photo may go with no words.
  IF (char_length(v_body) < 1 AND p_photo_path IS NULL) OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023', HINT = 'Write a message of up to 1,000 characters.';
  END IF;
  INSERT INTO public.declutter_order_talks (order_id) VALUES (o.id) ON CONFLICT (order_id) DO NOTHING;
  SELECT * INTO v_talk FROM public.declutter_order_talks t WHERE t.order_id = o.id FOR UPDATE;
  -- At most 30 messages an hour from one person in one chat.
  IF (SELECT count(*) FROM public.declutter_order_talk_messages m
       WHERE m.talk_id = v_talk.id AND m.sender_id = v_uid AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'message_rate_limited' USING ERRCODE = '42501', HINT = 'Slow down a little, then send again.';
  END IF;
  -- CHANGED 20261112060000 (F389): the photo is the caller's own 'talk' object for THIS order, uploaded, on no other message.
  IF p_photo_path IS NOT NULL AND (
       split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'talk'
       OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
       OR split_part(p_photo_path, '/', 5) = ''
       OR split_part(p_photo_path, '/', 6) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path)
       OR EXISTS (SELECT 1 FROM public.declutter_order_talk_messages x WHERE x.photo_path = p_photo_path)) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_order_talk_messages (talk_id, sender_id, sender_side, body, photo_path)
  VALUES (v_talk.id, v_uid, v_side, v_body, p_photo_path)
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
      format('The %s sent you a %s about "%s".', v_side, CASE WHEN p_photo_path IS NULL THEN 'message' ELSE 'photo' END,
             COALESCE(v_title, 'your Declutter order')),
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

REVOKE ALL ON FUNCTION public.declutter_send_order_message(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_send_order_message(uuid, text, text) TO authenticated, service_role;
