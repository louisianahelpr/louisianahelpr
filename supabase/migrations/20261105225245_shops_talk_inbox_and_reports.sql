-- Q1947, the rest of "message a shop" (Shops H1 follow-up; audit ~/.lh-shots/audit-1105-shops.md, owner L48 and O9).
-- Shops stays behind its switch (testers). Builds on 20261105185006_shops_talk (H1) and 20261105182210 (H2).
--
-- What this adds:
--   1. reports can name a shop-chat message: reported_type 'shop_talk_message' (reported_id = shop_talk_messages.id).
--   2. report_message_party_and_copy (RESTATED FROM THE NEWEST CREATE, 20261105182210, verbatim except the new
--      shop_talk_message branch and its three DECLAREd rows): only a side of the chat reports, only the other side's
--      message; the report keeps a copy.
--   3. notify_reporter_report_outcome (RESTATED from 20261105182210, verbatim plus the noun 'a message').
--   4. shops_admin_reported (RESTATED from 20261105182210, plus a third UNION branch): the queue reads a reported
--      chat message's shop, writer and side as admin.
--   5. shops_talk_view / shops_send_talk_message (RESTATED from 20261105185006): the chat reads as closed and refuses a
--      send by shop_state_ok (hidden, a test shop while test data is hidden, the owner's standing), not only by
--      hidden_at (lh-authz-rls note on b5-shops-h1, 11-05).
--   6. NEW shops_open_order_talk(order): the chat for a shop order, from its card, for either side. The buyer gets
--      their thread with the shop; the shop's owner gets their thread with that buyer (made on first use). Not for a
--      stranger, an order whose buyer deleted their account, or a blocked pair.
-- NOT HERE: export_my_data's shop_talks / shop_talk_messages sections (ready/b1-export-item-views restates
-- export_my_data in 20261105184827 and has not landed; the export slice is built on it after it lands).
-- MONEY: none. AUTHZ: the report trigger's party rule, an admin read, one new member RPC (lh-authz-rls).
-- REPLAY-SAFE: DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsTalkInbox.pglite.mjs (3x, Supabase's default anon grant emulated).

-- 1. The list from 20261105182210 plus 'shop_talk_message'.
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reported_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text, 'application'::text, 'declutter_item'::text, 'declutter_wanted'::text, 'declutter_question'::text, 'declutter_answer'::text, 'declutter_review'::text, 'shop'::text, 'shop_item'::text, 'shop_talk_message'::text]));

-- 2. The report keeps a copy of a shop-chat message.
CREATE OR REPLACE FUNCTION public.report_message_party_and_copy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  m public.messages%ROWTYPE;
  w public.declutter_wanted%ROWTYPE;
  q public.declutter_questions%ROWTYPE;
  it public.declutter_items%ROWTYPE;
  dr public.declutter_reviews%ROWTYPE;
  dro public.declutter_orders%ROWTYPE;
  sh public.shops%ROWTYPE;
  si public.shop_items%ROWTYPE;
  stm public.shop_talk_messages%ROWTYPE;
  stt public.shop_talks%ROWTYPE;
  v_stm_side text;
BEGIN
  -- CHANGED (Q1947, Shops messages, 20261105225245): a message in a shop chat (shop_talk_messages). Only a side of
  -- that chat reports it (the member, or the shop's owner, by shop_talk_side), and only the other side's message, never
  -- your own. Anything else reads as not found. The copy keeps the shop's name, who wrote it and the words.
  IF NEW.reported_type = 'shop_talk_message' THEN
    SELECT * INTO stm FROM public.shop_talk_messages WHERE id = NEW.reported_id;
    IF FOUND THEN
      SELECT * INTO stt FROM public.shop_talks WHERE id = stm.talk_id;
      SELECT * INTO sh FROM public.shops WHERE id = stt.shop_id;
    END IF;
    IF stm.id IS NULL OR stt.id IS NULL OR sh.id IS NULL THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NOT public.is_server_context() THEN
      v_stm_side := public.shop_talk_side(stt.id, NEW.reporter_id);
      IF v_stm_side IS NULL THEN
        RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
      END IF;
      IF v_stm_side = stm.sender_side THEN
        RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
      END IF;
    END IF;
    NEW.reported_content := left(concat_ws(E'\n', 'Shop: ' || sh.name,
      CASE WHEN stm.sender_side = 'shop' THEN 'From the shop: ' ELSE 'From the shopper: ' END || stm.body), 4000);
    RETURN NEW;
  END IF;
  -- CHANGED (Shops H2, audit 11-05): a shop or a shop item. A member reports only one they could be shown: the shop
  -- passes shop_state_ok (not hidden by an admin, the owner in good standing, a test shop hidden from members under
  -- the seed switch), and an item is also live. Anything else reads as not found (this runs as the definer, and the
  -- copy is readable by its reporter). Never your own: the shop's owner can't report their own shop or item.
  IF NEW.reported_type IN ('shop', 'shop_item') THEN
    IF NEW.reported_type = 'shop_item' THEN
      SELECT * INTO si FROM public.shop_items WHERE id = NEW.reported_id;
      IF FOUND THEN
        SELECT * INTO sh FROM public.shops WHERE id = si.shop_id;
      END IF;
    ELSE
      SELECT * INTO sh FROM public.shops WHERE id = NEW.reported_id;
    END IF;
    IF sh.id IS NULL OR (NEW.reported_type = 'shop_item' AND si.id IS NULL)
       OR (NOT public.is_server_context()
           AND (NOT public.shop_state_ok(sh.id)
                OR (NEW.reported_type = 'shop_item' AND si.status IS DISTINCT FROM 'live'))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM sh.owner_id THEN
      RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
    END IF;
    NEW.reported_content := left(CASE WHEN NEW.reported_type = 'shop_item'
      THEN concat_ws(E'\n', 'Item: ' || si.title, 'Price: $' || to_char(si.price_cents / 100.0, 'FM999990.00'),
                     NULLIF(btrim(COALESCE(si.description, '')), ''), 'Shop: ' || sh.name)
      ELSE concat_ws(E'\n', 'Shop: ' || sh.name, NULLIF(btrim(COALESCE(sh.about, '')), '')) END, 4000);
    RETURN NEW;
  END IF;
  -- CHANGED (A3-75): a Declutter review. A member reports only a review they could be shown, by declutter_visible_reviews'
  -- rule (20261021023530, restated in this file): not removed, and the order was handed over 14+ days ago or both sides
  -- have reviewed (the blind rule: until then even its subject can't read it); a test account's review stays hidden
  -- from others under the seed switch. Anything else reads as not found (this runs as the definer, and the copy is
  -- readable by its reporter). Never your own words: the reviewer can't report their own review.
  IF NEW.reported_type = 'declutter_review' THEN
    SELECT * INTO dr FROM public.declutter_reviews WHERE id = NEW.reported_id;
    IF FOUND THEN
      SELECT * INTO dro FROM public.declutter_orders WHERE id = dr.order_id;
    END IF;
    IF dr.id IS NULL OR dro.id IS NULL
       OR (NOT public.is_server_context()
           AND (dr.removed_at IS NOT NULL
                OR NOT (dr.reviewer_id IS NOT DISTINCT FROM NEW.reporter_id
                        OR dro.handed_over_at <= now() - interval '14 days'
                        OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = dr.order_id) = 2)
                OR NOT (dr.reviewee_id IS NOT DISTINCT FROM NEW.reporter_id OR dr.is_seed IS NOT TRUE
                        OR NOT (SELECT public.seed_hidden_from_caller())))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM dr.reviewer_id THEN
      RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
    END IF;
    NEW.reported_content := left(concat_ws(': ', dr.stars || CASE WHEN dr.stars = 1 THEN ' star' ELSE ' stars' END,
                                           NULLIF(btrim(COALESCE(dr.comment, '')), '')), 4000);
    RETURN NEW;
  END IF;
  -- CHANGED (B48): a Declutter question or its answer. A member reports only one they could be shown (not removed, on
  -- an item they can read: the seller's own, a live or reserved one, or one they bought), restated from the questions
  -- row policy and the items read policy (20261030080020), since this runs as the definer. Anything else reads as not
  -- found: the copy is readable by its reporter and would otherwise read out a removed question. An answer report
  -- needs an answer. Never your own words: the asker can't report the question, the seller can't report the answer.
  IF NEW.reported_type IN ('declutter_question', 'declutter_answer') THEN
    SELECT * INTO q FROM public.declutter_questions WHERE id = NEW.reported_id;
    IF FOUND THEN
      SELECT * INTO it FROM public.declutter_items WHERE id = q.item_id;
    END IF;
    IF q.id IS NULL OR it.id IS NULL
       OR (NOT public.is_server_context()
           AND (q.removed_at IS NOT NULL
                OR NOT (it.seller_id = NEW.reporter_id
                        OR (it.status IN ('live', 'reserved') AND NOT it.seller_hidden
                            AND (NOT it.is_seed OR NOT (SELECT public.seed_hidden_in_discovery())))
                        OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                                    WHERE c.item_id = it.id AND c.buyer_id = NEW.reporter_id AND c.status = 'paid')))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NEW.reported_type = 'declutter_answer' AND q.answer IS NULL THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NOT public.is_server_context()
       AND ((NEW.reported_type = 'declutter_question' AND NEW.reporter_id IS NOT DISTINCT FROM q.asker_id)
            OR (NEW.reported_type = 'declutter_answer' AND NEW.reporter_id IS NOT DISTINCT FROM it.seller_id)) THEN
      RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
    END IF;
    NEW.reported_content := left(concat_ws(E'\n', 'Question: ' || q.question, 'Answer: ' || q.answer), 4000);
    RETURN NEW;
  END IF;
  IF NEW.reported_type = 'declutter_wanted' THEN
    SELECT * INTO w FROM public.declutter_wanted WHERE id = NEW.reported_id;
    IF NOT FOUND
       OR (NOT public.is_server_context()
           AND (NOT w.public OR w.removed_at IS NOT NULL OR w.user_id = NEW.reporter_id
                OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    NEW.reported_content := left(w.what, 4000);
    RETURN NEW;
  END IF;
  IF NEW.reported_type IS DISTINCT FROM 'message' THEN
    NEW.reported_content := NULL;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM public.messages WHERE id = NEW.reported_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- L6: only someone in the conversation reports its message.
  IF NOT public.is_server_context()
     AND NEW.reporter_id IS DISTINCT FROM m.sender_id
     AND NEW.reporter_id IS DISTINCT FROM m.receiver_id THEN
    RAISE EXCEPTION 'report_not_allowed' USING ERRCODE = '42501';
  END IF;
  NEW.reported_content := left(concat_ws(E'\n',
    NULLIF(m.content, ''),
    CASE WHEN m.attachment_url IS NOT NULL THEN 'Attachment: ' || m.attachment_url END), 4000);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.report_message_party_and_copy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_message_party_and_copy() TO service_role;

-- 3. The reporter's outcome notice names it "a message".
CREATE OR REPLACE FUNCTION public.notify_reporter_report_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_noun text;
  v_case text;
BEGIN
  BEGIN
    IF NEW.reporter_id IS NULL OR NEW.reported_type = 'support' THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.reporter_id)
       OR public.is_test_subject(NEW.reporter_id)
       OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.reporter_id AND p.is_seed IS TRUE) THEN
      RETURN NULL;
    END IF;
    -- Dismissed because the member or job is gone: no one reviewed it.
    IF NEW.status = 'dismissed' AND NEW.reported_id IS NOT NULL AND (
         -- The profile, not auth.users: account deletion removes the profile first and that delete is what
         -- dismisses the report, while the auth row may still exist inside the same transaction.
         (NEW.reported_type = 'user'
           AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.reported_id))
         OR (NEW.reported_type = 'job' AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.reported_id))
       ) THEN
      RETURN NULL;
    END IF;

    v_noun := CASE NEW.reported_type
      WHEN 'job' THEN 'a job'
      WHEN 'user' THEN 'a member'
      WHEN 'message' THEN 'a message'
      WHEN 'review' THEN 'a review'
      WHEN 'application' THEN 'an application'
      WHEN 'declutter_item' THEN 'a listing'
      WHEN 'declutter_wanted' THEN 'a Wanted post'
      WHEN 'declutter_question' THEN 'a question'
      WHEN 'declutter_answer' THEN 'an answer'
      WHEN 'declutter_review' THEN 'a review'
      WHEN 'shop' THEN 'a shop'
      WHEN 'shop_item' THEN 'a shop item'
      WHEN 'shop_talk_message' THEN 'a message'
      ELSE 'a post'
    END;
    v_case := 'HLP-' || upper(left(replace(NEW.id::text, '-', ''), 8));

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      NEW.reporter_id,
      'We looked into your report',
      'Thanks for your report about ' || v_noun || ' (case ' || v_case || '). '
        || CASE WHEN NEW.status = 'resolved'
             THEN 'We looked into it and took action.'
             ELSE 'We looked into it and didn''t find a rule broken. If it keeps happening, report it again or contact support.'
           END,
      'system_alert',
      CASE WHEN NEW.status = 'resolved' THEN NULL ELSE '/support?topic=message' END
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'report outcome notice could not be sent',
            jsonb_build_object('source', 'notify_reporter_report_outcome'),
            jsonb_build_object('report_id', NEW.id::text, 'error', SQLERRM));
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.notify_reporter_report_outcome() FROM PUBLIC, anon, authenticated;

-- 4. The reports queue's read, plus reported shop-chat messages.
CREATE OR REPLACE FUNCTION public.shops_admin_reported(p_ids uuid[])
 RETURNS TABLE(reported_id uuid, kind text, shop_id uuid, owner_id uuid, label text, status text, shop_hidden boolean,
               is_seed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.require_feature('shops');
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, 'shop'::text, s.id, s.owner_id, s.name,
           CASE WHEN s.hidden_at IS NOT NULL THEN 'hidden' WHEN s.paused THEN 'paused' ELSE 'open' END,
           s.hidden_at IS NOT NULL,
           (COALESCE(s.is_seed, false)
            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = s.owner_id AND p.is_seed IS TRUE))
      FROM public.shops s
     WHERE s.id = ANY (COALESCE(p_ids, ARRAY[]::uuid[]))
    UNION ALL
    SELECT i.id, 'shop_item'::text, i.shop_id, i.owner_id, i.title, i.status,
           s.hidden_at IS NOT NULL,
           (COALESCE(i.is_seed, false) OR COALESCE(s.is_seed, false)
            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = i.owner_id AND p.is_seed IS TRUE))
      FROM public.shop_items i
      JOIN public.shops s ON s.id = i.shop_id
     WHERE i.id = ANY (COALESCE(p_ids, ARRAY[]::uuid[]))
    UNION ALL
    -- Q1947: a reported shop-chat message. owner_id is the person who wrote it (the queue's subject); label the shop's
    -- name; status which side wrote it ('buyer' or 'shop').
    SELECT m.id, 'shop_talk_message'::text, s.id, m.sender_id, s.name, m.sender_side,
           s.hidden_at IS NOT NULL,
           (COALESCE(s.is_seed, false)
            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id IN (t.buyer_id, s.owner_id) AND p.is_seed IS TRUE))
      FROM public.shop_talk_messages m
      JOIN public.shop_talks t ON t.id = m.talk_id
      JOIN public.shops s ON s.id = t.shop_id
     WHERE m.id = ANY (COALESCE(p_ids, ARRAY[]::uuid[]))
     LIMIT 500;
END;
$function$;
REVOKE ALL ON FUNCTION public.shops_admin_reported(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_reported(uuid[]) TO authenticated, service_role;

-- 5. The chat follows the shop-state rule.
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
    -- CHANGED (Q1947): the shop-state rule every viewer shares, as the send refuses by it.
    'open', public.shop_state_ok(s.id) AND NOT public.are_users_blocked(t.buyer_id, s.owner_id),
    'messages', v_messages);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_talk_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_talk_view(uuid) TO authenticated, service_role;

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
  -- CHANGED (Q1947, lh-authz-rls note on b5-shops-h1): the whole shop-state rule (hidden, a test shop while test data
  -- is hidden, the owner's standing), not only hidden_at.
  IF NOT public.shop_state_ok(s.id) THEN
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

-- 6. The chat for a shop order, from its card. Either side; made on first use.
CREATE OR REPLACE FUNCTION public.shops_open_order_talk(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders%ROWTYPE;
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
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF FOUND THEN
    SELECT owner_id INTO v_owner FROM public.shops WHERE id = o.shop_id;
  END IF;
  -- Only the order's buyer or the shop's owner; a stranger, a gone shop or a deleted buyer reads as not found.
  IF o.id IS NULL OR v_owner IS NULL OR o.buyer_id IS NULL
     OR (v_uid IS DISTINCT FROM o.buyer_id AND v_uid IS DISTINCT FROM v_owner) THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.buyer_id = v_owner THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  IF public.are_users_blocked(o.buyer_id, v_owner) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.shop_talks (shop_id, buyer_id) VALUES (o.shop_id, o.buyer_id)
  ON CONFLICT (shop_id, buyer_id) DO NOTHING;
  SELECT id INTO v_id FROM public.shop_talks WHERE shop_id = o.shop_id AND buyer_id = o.buyer_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_open_order_talk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_open_order_talk(uuid) TO authenticated, service_role;
