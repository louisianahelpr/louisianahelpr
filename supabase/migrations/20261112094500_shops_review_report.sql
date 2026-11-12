-- Q1948 L46 leftovers (Shops audit 11-12 list item 4): a Shops review can be reported, and an admin can take it down.
-- PRIVACY CHECK FIRST (logged in OWNER-DECISIONS 11-12 3:15 AM): shop reviews are NOT folded into the owner's PERSON
-- rating (get_public_profile_stats). A shop never names or links its owner (shops_public_shop returns no owner id; the
-- shop's rating comes from shop reviews only, Q2207), so a person whose only reviews are shop reviews would show the
-- same count and average on their public profile as the signed-out shop page, naming the person behind a home shop.
-- RESTATED FROM THE NEWEST CREATE, checked by name:
--   reports_reported_type_check     from 20261106191100 (newest), plus 'shop_review'
--   report_message_party_and_copy   from 20261106191100 (newest), verbatim plus the shop_review branch and its two
--                                   DECLAREd names
--   notify_reporter_report_outcome  from 20261106191100 (newest), verbatim plus the noun 'a review'
-- NEW: shops_admin_remove_review(review, note, report) and shops_admin_reported_reviews(ids), the Declutter pair's
-- pattern (20261102040000). shop_reviews.removed_at already exists (20261105230819) and every member read already
-- drops a removed review (shop_review_public); a removed review keeps its slot (UNIQUE (order_id, reviewer_side)) and
-- still counts toward the blind rule, as Declutter (5:56 PM 11-05 decision).
-- REPLAY-SAFE: DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE. Grants: the new RPCs authenticated + service_role
-- (admin-checked inside), never PUBLIC or anon. MONEY: none. AUTHZ: lh-authz-rls.
-- Proof: src/test/pglite/shopsReviewReport.pglite.mjs (3x; NEW_MIGRATION=skip red).

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reported_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text, 'application'::text, 'declutter_item'::text, 'declutter_wanted'::text, 'declutter_question'::text, 'declutter_answer'::text, 'declutter_review'::text, 'shop'::text, 'shop_item'::text, 'shop_talk_message'::text, 'home_listing'::text, 'home_talk_message'::text, 'shop_review'::text]));

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
  hl public.rental_listings%ROWTYPE;
  htm public.home_talk_messages%ROWTYPE;
  htt public.home_talks%ROWTYPE;
  v_htm_side text;
  shr public.shop_reviews%ROWTYPE;
  sho public.shop_orders%ROWTYPE;
BEGIN
  -- CHANGED (Q1948, 20261112094500): a Shops review. A member reports only a review they could be shown: public by
  -- shop_review_public (not removed; handed over 14+ days ago or both sides reviewed; a test review hidden under the
  -- seed switch): a BUYER's review on a shop they can see (shop_visible_to; members are shown only buyer reviews), or
  -- the review written ABOUT them (the shop's review of a buyer reaches only that buyer, via Download My Data). Never your own words.
  -- Anything else reads as not found. The copy keeps the stars and the words; never a name.
  IF NEW.reported_type = 'shop_review' THEN
    SELECT * INTO shr FROM public.shop_reviews WHERE id = NEW.reported_id;
    IF FOUND THEN
      SELECT * INTO sho FROM public.shop_orders WHERE id = shr.order_id;
    END IF;
    IF shr.id IS NULL OR sho.id IS NULL
       OR (NOT public.is_server_context()
           AND NOT (public.shop_review_public(shr.id)
                    AND (shr.reviewee_id IS NOT DISTINCT FROM NEW.reporter_id
                         OR (shr.reviewer_side = 'buyer' AND public.shop_visible_to(shr.shop_id, NEW.reporter_id))))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM shr.reviewer_id THEN
      RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
    END IF;
    NEW.reported_content := left(concat_ws(': ', shr.stars || CASE WHEN shr.stars = 1 THEN ' star' ELSE ' stars' END,
                                           NULLIF(btrim(COALESCE(shr.comment, '')), '')), 4000);
    RETURN NEW;
  END IF;
  -- CHANGED (Homes messages, A-H1 / Q2209, 20261106191100): a message in a Homes thread (home_talk_messages). Only a
  -- side of that thread reports it (the member, or the listing's owner, by home_talk_side), and only the other side's
  -- message, never your own. Anything else reads as not found. The 'rentals' switch must be on for the reporter (the
  -- thread is behind it). The copy keeps the listing's headline, which side wrote it and the words; never a name.
  IF NEW.reported_type = 'home_talk_message' THEN
    SELECT * INTO htm FROM public.home_talk_messages WHERE id = NEW.reported_id;
    IF FOUND THEN
      SELECT * INTO htt FROM public.home_talks WHERE id = htm.talk_id;
      SELECT * INTO hl FROM public.rental_listings WHERE id = htt.listing_id;
    END IF;
    IF htm.id IS NULL OR htt.id IS NULL OR hl.id IS NULL THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NOT public.is_server_context() THEN
      v_htm_side := public.home_talk_side(htt.id, NEW.reporter_id);
      IF v_htm_side IS NULL OR NOT public.feature_enabled_for('rentals') THEN
        RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
      END IF;
      IF v_htm_side = htm.sender_side THEN
        RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
      END IF;
    END IF;
    NEW.reported_content := left(concat_ws(E'\n',
      CASE WHEN hl.kind = 'sale' THEN 'Home for sale: ' ELSE 'Home for rent: ' END || hl.headline,
      CASE WHEN htm.sender_side = 'owner' THEN 'From the owner: ' ELSE 'From the member: ' END || htm.body), 4000);
    RETURN NEW;
  END IF;
  -- CHANGED (Homes report, audit 11-05 A-H2, Q2187, 20261106165850): a Homes listing (rental_listings, for rent or for
  -- sale). A member reports only a listing they could be shown: the 'rentals' switch is on for them and the listing
  -- passes rentals_listing_visible (live, not expired, on an approved property, a sale listing's owner still
  -- ID-verified, the owner not banned). Anything else reads as not found (this runs as the definer, and the copy is
  -- readable by its reporter). Never your own: the lister can't report their own listing.
  IF NEW.reported_type = 'home_listing' THEN
    SELECT * INTO hl FROM public.rental_listings WHERE id = NEW.reported_id;
    IF hl.id IS NULL
       OR (NOT public.is_server_context()
           AND (NOT public.feature_enabled_for('rentals') OR NOT public.rentals_listing_visible(hl.id))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'PT404';
    END IF;
    IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM hl.owner_id THEN
      RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
    END IF;
    NEW.reported_content := left(concat_ws(E'\n',
      CASE WHEN hl.kind = 'sale' THEN 'Home for sale: ' ELSE 'Home for rent: ' END || hl.headline,
      NULLIF(btrim(COALESCE(hl.description, '')), '')), 4000);
    RETURN NEW;
  END IF;
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
      WHEN 'home_listing' THEN 'a home listing'
      WHEN 'home_talk_message' THEN 'a message'
      WHEN 'shop_review' THEN 'a review'
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

CREATE OR REPLACE FUNCTION public.shops_admin_remove_review(p_review_id uuid, p_note text, p_report_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  r public.shop_reviews%ROWTYPE;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.shop_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND OR r.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'review_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF r.reviewer_id = v_uid OR r.reviewee_id = v_uid THEN
    RAISE EXCEPTION 'own_review' USING ERRCODE = '42501';
  END IF;
  IF p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports rp
        WHERE rp.id = p_report_id AND rp.reported_type = 'shop_review' AND rp.reported_id = p_review_id) THEN
    RAISE EXCEPTION 'report_not_for_review' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_reviews SET removed_at = now() WHERE id = p_review_id;
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shop_review_removed', 'shop_review', p_review_id::text,
          jsonb_build_object('note', NULLIF(v_note, ''), 'report_id', p_report_id, 'order_id', r.order_id,
                             'stars', r.stars, 'comment', r.comment));
  RETURN 'removed';
END;
$function$;
REVOKE ALL ON FUNCTION public.shops_admin_remove_review(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_remove_review(uuid, text, uuid) TO authenticated, service_role;

-- The reports queue's half: the reviews behind shop review reports, read as admin (members can't read the table).
CREATE OR REPLACE FUNCTION public.shops_admin_reported_reviews(p_review_ids uuid[])
 RETURNS TABLE(review_id uuid, reviewer_id uuid, reviewee_id uuid, reviewer_side text, stars smallint, comment text,
               removed boolean, is_seed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.reviewer_id, r.reviewee_id, r.reviewer_side, r.stars, r.comment, r.removed_at IS NOT NULL,
           (COALESCE(r.is_seed, false) OR COALESCE(o.is_seed, false)
            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id IN (r.reviewer_id, r.reviewee_id) AND p.is_seed IS TRUE))
      FROM public.shop_reviews r
      LEFT JOIN public.shop_orders o ON o.id = r.order_id
     WHERE r.id = ANY (COALESCE(p_review_ids, ARRAY[]::uuid[]))
     LIMIT 500;
END;
$function$;
REVOKE ALL ON FUNCTION public.shops_admin_reported_reviews(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_reported_reviews(uuid[]) TO authenticated, service_role;
