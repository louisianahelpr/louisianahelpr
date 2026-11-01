-- B48 (OWNER DECISION 10-31 via the lead, App Store guideline 1.2): the public questions and answers on a Declutter listing
-- could not be reported. A member reports a question ('declutter_question') or the seller's answer ('declutter_answer');
-- reported_id is the question's id either way. Never your own words. An admin removes the question or the answer from
-- the reports queue; test data never reaches the queue (declutter_admin_reported_questions.is_seed).
-- RESTATED FROM THE NEWEST CREATE on origin/main a0ed8c8d77, checked by name:
--   reports_reported_type_check      from 20261030225143 (newest), plus 'declutter_question'
--   report_message_party_and_copy     from 20261030225143 (newest); only the declutter_question/answer branch is new
-- NEW: declutter_admin_remove_question(question, part, note, report), declutter_admin_reported_questions(ids).
-- REPLAY-SAFE: DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE. Grants: the new RPC authenticated + service_role,
-- never PUBLIC or anon. No new table. Proof: src/test/pglite/declutterQuestionReport.pglite.mjs (3x).

-- 1. The prod list (20261030225143) plus 'declutter_question' and 'declutter_answer'.
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reported_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text, 'application'::text, 'declutter_item'::text, 'declutter_wanted'::text, 'declutter_question'::text, 'declutter_answer'::text]));

-- 2. The report keeps a copy of the question and its answer, as a message or Wanted report does.
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
BEGIN
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
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF NEW.reported_type = 'declutter_answer' AND q.answer IS NULL THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
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
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
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
    RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
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

-- 3. An admin removes a reported question (members stop seeing it: the row policy and declutter_item_questions skip
--    removed_at) or only its answer (the question shows as waiting again, and the seller may answer anew). The report
--    resolves and the step is logged. Not an admin who asked the question or sells the item.
CREATE OR REPLACE FUNCTION public.declutter_admin_remove_question(p_question_id uuid, p_part text, p_note text, p_report_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  q public.declutter_questions%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF p_part IS NULL OR p_part NOT IN ('question', 'answer') THEN
    RAISE EXCEPTION 'invalid_part' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO q FROM public.declutter_questions WHERE id = p_question_id FOR UPDATE;
  IF NOT FOUND OR q.removed_at IS NOT NULL OR (p_part = 'answer' AND q.answer IS NULL) THEN
    RAISE EXCEPTION 'question_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF q.asker_id = v_uid OR EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = q.item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'own_question' USING ERRCODE = '42501';
  END IF;
  IF p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports rp
        WHERE rp.id = p_report_id AND rp.reported_type IN ('declutter_question', 'declutter_answer') AND rp.reported_id = p_question_id) THEN
    RAISE EXCEPTION 'report_not_for_question' USING ERRCODE = '22023';
  END IF;
  IF p_part = 'question' THEN
    UPDATE public.declutter_questions SET removed_at = now() WHERE id = p_question_id;
  ELSE
    UPDATE public.declutter_questions SET answer = NULL, answered_at = NULL WHERE id = p_question_id;
  END IF;
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE p_part WHEN 'question' THEN 'declutter_question_removed' ELSE 'declutter_answer_removed' END,
          'declutter_question', p_question_id::text,
          jsonb_build_object('note', NULLIF(v_note, ''), 'report_id', p_report_id, 'item_id', q.item_id,
                             'answer', CASE WHEN p_part = 'answer' THEN q.answer END));
  RETURN 'removed';
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_remove_question(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_remove_question(uuid, text, text, uuid) TO authenticated, service_role;

-- 4. The reports queue's half: the questions behind question and answer reports, read as admin (the row policy hides
--    removed ones). is_seed (a test listing, or a test asker) lets the queue drop test data (owner rule: test data
--    never shows to the owner), as declutter_admin_reported_wanted does for Wanted posts.
CREATE OR REPLACE FUNCTION public.declutter_admin_reported_questions(p_question_ids uuid[])
 RETURNS TABLE(question_id uuid, item_id uuid, item_title text, asker_id uuid, seller_id uuid, question text, answer text,
               removed boolean, is_seed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.require_feature('declutter');
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT q.id, q.item_id, i.title, q.asker_id, i.seller_id, q.question, q.answer, q.removed_at IS NOT NULL,
           (COALESCE(i.is_seed, false)
            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id IN (q.asker_id, i.seller_id) AND p.is_seed IS TRUE))
      FROM public.declutter_questions q
      JOIN public.declutter_items i ON i.id = q.item_id
     WHERE q.id = ANY (COALESCE(p_question_ids, ARRAY[]::uuid[]))
     LIMIT 500;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_reported_questions(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_reported_questions(uuid[]) TO authenticated, service_role;
