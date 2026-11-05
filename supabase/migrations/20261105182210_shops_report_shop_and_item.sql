-- Shops H2 (audit ~/.lh-shots/audit-1105-shops.md, 2026-11-05): a shop or a shop item can be reported. Owner rule
-- (admin reviews only on report, 10-29 and 10-31): content goes live at once and admin acts only on a report or a
-- failed automatic check, so Shops needs a way in. Reports reuse the one pipeline (public.reports, the shared
-- ReportDialog, the admin reports queue); nothing Shops-only is added to it. Shops stays behind its switch (testers).
-- Patterns: 20261102040000 (Declutter review reports), 20261101021934 (question reports).
-- RESTATED FROM THE NEWEST CREATE on origin/main, checked by name:
--   reports_reported_type_check    from 20261102040000 (newest), plus 'shop' and 'shop_item'
--   report_message_party_and_copy   from 20261103222939 (newest); only the shop / shop_item branch and its two
--                                   DECLAREd rows are new
--   notify_reporter_report_outcome  from 20261102040000 (newest); only the 'shop' / 'shop_item' nouns are new
-- NEW: shops_admin_reported(ids) (the queue's read of reported shops and items, as admin) and
-- shops_admin_take_down_item(item, note, report) (an admin takes a reported item down: it is rejected with the note,
-- the 30-day re-check after a rejection starts, the owner is told, the report resolves). Hiding a reported shop
-- reuses shops_admin_set_hidden (20261103052255) unchanged; the queue resolves that report the usual way.
-- NOT CHANGED, checked: a taken-down item's open orders keep going (money is Builder 4's lane; the buyer already paid
-- or holds a card hold the shop answers). reports_dismiss_for_deleted_target (20261031211327) dismisses only user and
-- job reports; a deleted shop's report stays for the admin, who sees "Deleted shop".
-- REPLAY-SAFE: DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE. Grants: the new RPCs authenticated +
-- service_role, never PUBLIC or anon; the restated functions keep their grants as stated.
-- MONEY: none. AUTHZ: the trigger's visibility rule and two admin RPCs (lh-authz-rls).
-- Proof: src/test/pglite/shopsReport.pglite.mjs (3x, Supabase's default anon grant emulated).

-- 1. The list from 20261102040000 plus 'shop' and 'shop_item' (reported_id is the shops / shop_items id).
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reported_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text, 'application'::text, 'declutter_item'::text, 'declutter_wanted'::text, 'declutter_question'::text, 'declutter_answer'::text, 'declutter_review'::text, 'shop'::text, 'shop_item'::text]));

-- 2. The report keeps a copy of the shop ("Shop: <name>" + about) or item (title, price, description, shop).
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
BEGIN
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

-- 3. The reporter's outcome notice names it "a shop" or "a shop item".
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

-- 4. The reports queue's half: the shops and items behind shop reports, read as admin (members can't read the
--    tables). is_seed (a test shop or item, or a test owner) lets the queue drop test data (owner rule 10-27).
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
     LIMIT 500;
END;
$function$;
REVOKE ALL ON FUNCTION public.shops_admin_reported(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_reported(uuid[]) TO authenticated, service_role;

-- 5. An admin takes a reported item down. It is rejected with the admin's note (the owner reads it in the editor,
--    shops_my_item_review), which also starts the 30-day re-check of every new publish (shops_publish_item reads the
--    'shop_item_rejected' audit row with owner_id). The owner is told; the report resolves. Not an admin's own item.
CREATE OR REPLACE FUNCTION public.shops_admin_take_down_item(p_item_id uuid, p_note text, p_report_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  i public.shop_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) < 3 THEN
    RAISE EXCEPTION 'review_note_required' USING ERRCODE = '22023', HINT = 'Say why the item came down.';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO i FROM public.shop_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR i.status NOT IN ('live', 'pending_review') THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF i.owner_id = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '42501', HINT = 'Another admin must act on your own item.';
  END IF;
  IF p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports rp
        WHERE rp.id = p_report_id AND rp.reported_type = 'shop_item' AND rp.reported_id = p_item_id) THEN
    RAISE EXCEPTION 'report_not_for_item' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_items SET status = 'rejected', updated_at = now() WHERE id = p_item_id;
  UPDATE public.shop_item_private
     SET review_note = v_note, admin_rejected_at = now(), updated_at = now()
   WHERE item_id = p_item_id;
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shop_item_rejected', 'shop_item', p_item_id::text,
          -- owner_id is what shops_publish_item's 30-day hold reads.
          jsonb_build_object('note', v_note, 'owner_id', i.owner_id, 'shop_id', i.shop_id, 'report_id', p_report_id,
                             'title', i.title, 'taken_down_from', i.status));
  PERFORM public.declutter_notify(i.owner_id, 'warning', 'An item came off your shop',
    left('We took "' || i.title || '" down after a report: ' || v_note, 1000), '/shops/mine');
  RETURN 'rejected';
END;
$function$;
REVOKE ALL ON FUNCTION public.shops_admin_take_down_item(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_take_down_item(uuid, text, uuid) TO authenticated, service_role;
