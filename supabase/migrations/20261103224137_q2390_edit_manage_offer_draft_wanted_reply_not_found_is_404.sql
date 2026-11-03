-- Q2390 packet 38 (REGULAR packet: lead review): "not found" answers HTTP 404, not 500, for five Declutter functions
-- that still raised P0002 (owner rule 11-03: Jobs and Declutter first; no testers-only features). Each raise comes at
-- the function's first existence check or locked read, BEFORE any write:
--   declutter_edit_listing (not the seller's item), declutter_manage (manager mode: the target is not the seller's),
--   declutter_respond_offer (2: not a side of the offer; seller out or blocked, reached only on accept/counter, before
--   any write), declutter_update_draft (not the seller's draft), declutter_wanted_reply (3: not the seller's item; the
--   post is private, closed, blocked or hidden; a test listing hidden from the poster).
-- The app maps all five by message; no edge function reads their code; no migration catches P0002. No edge map
-- changes, no deploy. PostgREST maps P0002 to 500; RAISE ... USING ERRCODE = 'PT404' answers 404.
-- declutter_porch_photo is left out: wip/b67-medium restates it (20261103202118), not landed yet.
--
-- Each is restated VERBATIM from its newest migration copy, whose md5(prosrc) and md5(pg_get_functiondef) equal prod
-- (read 2026-11-03 by Builder 75; 1 overload each; grants as prod: authenticated, service_role). The ONLY change:
-- ERRCODE 'P0002' -> 'PT404'.
--   declutter_edit_listing   20261031083708 52dfd9b0607d5a8d4f798a167fbc3fb2
--   declutter_manage         20261101181005 2ed697c5cf8f209db5349bd26b0b461b
--   declutter_respond_offer  20261102113853 0346331d3bf83e80165f72425a12e731
--   declutter_update_draft   20261027170717 41f618c8af0711a0600297638943bfaf
--   declutter_wanted_reply   20261030154707 d41b85fefbfd23fb46c6b3f7d1203789

-- declutter_edit_listing: restated from 20261031083708_declutter_edit_tells_offer_holders_what_matters.sql.
CREATE OR REPLACE FUNCTION public.declutter_edit_listing(p_item_id uuid, p_title text, p_description text, p_category text, p_condition_stars integer, p_delivery_size text, p_handovers text[], p_bought_for_personal_use boolean, p_not_in_the_business boolean, p_not_a_frequent_seller boolean, p_keeps_item_until_handover boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_ways text[];
  v_title text := btrim(COALESCE(p_title, ''));
  v_description text := COALESCE(btrim(p_description), '');
  v_big boolean;
  v_changed text[];
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);

  -- Every edit says the four facts again (owner 2026-10-29); all four, or nothing is saved.
  IF NOT (COALESCE(p_bought_for_personal_use, false) AND COALESCE(p_not_in_the_business, false)
          AND COALESCE(p_not_a_frequent_seller, false) AND COALESCE(p_keeps_item_until_handover, false)) THEN
    RAISE EXCEPTION 'attestation_required' USING ERRCODE = '22023';
  END IF;

  -- The set, each way once, in one order; NULLs dropped (as declutter_set_handovers).
  SELECT COALESCE(array_agg(DISTINCT w ORDER BY w), ARRAY[]::text[]) INTO v_ways
    FROM unnest(COALESCE(p_handovers, ARRAY[]::text[])) AS w WHERE w IS NOT NULL;
  IF cardinality(v_ways) < 1 OR NOT (v_ways <@ ARRAY['porch', 'seller_delivery', 'meetup', 'delivery']::text[]) THEN
    RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023',
      HINT = 'Tick at least one way buyers can get it: porch pickup, you deliver, a safe meeting spot or Helpr delivery.';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- A free item is claimed through the free checkout, which takes porch pickup only.
  IF v_item.price_cents = 0 AND v_ways <> ARRAY['porch']::text[] THEN
    RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023', HINT = 'A free item is picked up from your porch.';
  END IF;

  -- "Big" is decided from what actually changed, against the stored row.
  v_big := v_item.title IS DISTINCT FROM v_title
        OR v_item.description IS DISTINCT FROM v_description
        OR v_item.category IS DISTINCT FROM p_category;
  -- BUY-11 (buying audit 10-30 #11, new): what an offer holder decided on, changed without a re-check. Named in the
  -- notice below, so nobody pays for a lower condition, a different size (the delivery price) or a way taken away.
  v_changed := array_remove(ARRAY[
    CASE WHEN v_item.condition_stars IS DISTINCT FROM p_condition_stars THEN 'condition' END,
    CASE WHEN v_item.delivery_size IS DISTINCT FROM p_delivery_size THEN 'size' END,
    CASE WHEN v_item.handovers IS DISTINCT FROM v_ways THEN 'ways to get it' END], NULL);

  INSERT INTO public.declutter_tax_attestations AS a
    (item_id, seller_id, bought_for_personal_use, not_in_the_business, not_a_frequent_seller, keeps_item_until_handover)
  VALUES (p_item_id, v_uid, true, true, true, true)
  ON CONFLICT (item_id) DO UPDATE
    SET seller_id = EXCLUDED.seller_id, bought_for_personal_use = true, not_in_the_business = true,
        not_a_frequent_seller = true, keeps_item_until_handover = true, attested_at = now();

  PERFORM set_config('declutter.editing_listing', p_item_id::text, true);
  UPDATE public.declutter_items
     SET title = v_title,
         description = v_description,
         category = p_category,
         condition_stars = p_condition_stars,
         delivery_size = p_delivery_size,
         handovers = v_ways,
         porch_ok = ('porch' = ANY (v_ways)),
         updated_at = now()
   WHERE id = p_item_id AND seller_id = v_uid;
  PERFORM set_config('declutter.editing_listing', '', true);

  IF NOT v_big THEN
    -- BUY-11 (new): open offers stay open, and each buyer is told what changed.
    IF cardinality(v_changed) > 0 THEN
      FOR r IN
        SELECT DISTINCT o.buyer_id FROM public.declutter_offers o
         WHERE o.item_id = p_item_id AND o.status = 'open'
      LOOP
        PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing updated',
          format('The seller changed the %s on "%s". Check it before your offer is answered.',
                 CASE WHEN cardinality(v_changed) = 1 THEN v_changed[1]
                      ELSE array_to_string(v_changed[1:cardinality(v_changed) - 1], ', ') || ' and ' || v_changed[cardinality(v_changed)] END,
                 v_title),
          '/declutter/item/' || p_item_id::text, v_uid);
      END LOOP;
    END IF;
    RETURN 'live';
  END IF;

  -- The text the automatic check judged is gone (B19): it judges again right
  -- away (the app asks for it after saving; declutter_record_ai_check puts a
  -- clean listing back live by itself). Until then buyers do not see it.
  UPDATE public.declutter_item_private
     SET ai_checked_at = NULL, ai_flag_reason = NULL, updated_at = now()
   WHERE item_id = p_item_id;
  -- Owner/lead 2026-10-30: open offers stay open; each buyer is told the
  -- listing changed, so nobody pays for something that changed under them.
  -- Only a flag on the re-check closes them (declutter_record_ai_check).
  FOR r IN
    SELECT DISTINCT o.buyer_id FROM public.declutter_offers o
     WHERE o.item_id = p_item_id AND o.status = 'open'
  LOOP
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing updated',
      format('The seller updated "%s". Check it before your offer is answered.', v_title),
      '/declutter/item/' || p_item_id::text, v_uid);
  END LOOP;
  UPDATE public.declutter_items
     SET status = 'pending_review', submitted_at = now(), updated_at = now()
   WHERE id = p_item_id;
  RETURN 'pending_review';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_edit_listing(uuid, text, text, text, integer, text, text[], boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_edit_listing(uuid, text, text, text, integer, text, text[], boolean, boolean, boolean, boolean) TO authenticated, service_role;

-- declutter_manage: restated from 20261101181005_declutter_manager_mode.sql.
CREATE OR REPLACE FUNCTION public.declutter_manage(p_seller uuid, p_action text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_mgr uuid := (SELECT auth.uid());
  v_a jsonb := COALESCE(p_args, '{}'::jsonb);
  v_perm text;
  v_g public.declutter_manager_grants%ROWTYPE;
  v_target uuid;
  v_ok boolean;
  v_prev_sub text;
  v_prev_claims text;
  v_result jsonb;
  v_item public.declutter_items%ROWTYPE;
  v_path text;
  v_pos smallint;
  v_attested_at timestamptz;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  IF v_mgr IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  v_perm := CASE p_action
    WHEN 'create_item' THEN 'list'
    WHEN 'update_draft' THEN 'list'
    WHEN 'add_item_photo' THEN 'list'
    WHEN 'remove_item_photo' THEN 'list'
    WHEN 'submit_for_approval' THEN 'list'
    WHEN 'edit_listing' THEN 'list'
    WHEN 'set_handovers' THEN 'list'
    WHEN 'pause_listing' THEN 'list'
    WHEN 'withdraw_item' THEN 'list'
    WHEN 'set_listing_price' THEN 'prices'
    WHEN 'set_listing_drops' THEN 'prices'
    WHEN 'respond_offer' THEN 'offers'
    WHEN 'set_offer_rules' THEN 'offers'
    WHEN 'answer_question' THEN 'messages'
    WHEN 'send_order_message' THEN 'messages'
    WHEN 'order_talk_view' THEN 'messages'
    WHEN 'set_pickup_windows' THEN 'pickups'
    WHEN 'confirm_handover' THEN 'pickups'
    ELSE NULL END;
  IF v_perm IS NULL THEN
    RAISE EXCEPTION 'unknown_action' USING ERRCODE = '22023';
  END IF;
  v_g := public.declutter_manager_grant_for(p_seller, v_perm);

  -- The target is the seller's SELLING side: her item, an offer on her item, her sale, a question on her item.
  IF p_action IN ('update_draft', 'add_item_photo', 'submit_for_approval', 'edit_listing', 'set_handovers',
                  'pause_listing', 'withdraw_item', 'set_listing_price', 'set_listing_drops', 'set_offer_rules') THEN
    v_target := (v_a ->> 'item_id')::uuid;
    v_ok := EXISTS (SELECT 1 FROM public.declutter_items WHERE id = v_target AND seller_id = p_seller);
  ELSIF p_action = 'remove_item_photo' THEN
    v_target := (v_a ->> 'photo_id')::uuid;
    v_ok := EXISTS (SELECT 1 FROM public.declutter_item_photos ph JOIN public.declutter_items i ON i.id = ph.item_id
                     WHERE ph.id = v_target AND i.seller_id = p_seller AND i.status = 'draft');
  ELSIF p_action = 'respond_offer' THEN
    v_target := (v_a ->> 'offer_id')::uuid;
    v_ok := EXISTS (SELECT 1 FROM public.declutter_offers WHERE id = v_target AND seller_id = p_seller);
  ELSIF p_action = 'answer_question' THEN
    v_target := (v_a ->> 'question_id')::uuid;
    v_ok := EXISTS (SELECT 1 FROM public.declutter_questions q JOIN public.declutter_items i ON i.id = q.item_id
                     WHERE q.id = v_target AND i.seller_id = p_seller);
  ELSIF p_action IN ('send_order_message', 'order_talk_view', 'confirm_handover') THEN
    v_target := (v_a ->> 'order_id')::uuid;
    v_ok := EXISTS (SELECT 1 FROM public.declutter_orders WHERE id = v_target AND seller_id = p_seller);
  ELSE
    -- create_item (a new id the seller does not own yet) and set_pickup_windows (the seller's own windows).
    v_target := NULLIF(v_a ->> 'item_id', '')::uuid;
    v_ok := p_action = 'set_pickup_windows'
      OR (v_target IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.declutter_items WHERE id = v_target));
  END IF;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'PT404';
  END IF;

  -- A draft waiting for the seller's OK is hers to decide: the manager changes it only after she sends it back.
  IF p_action IN ('update_draft', 'add_item_photo', 'remove_item_photo', 'set_handovers', 'submit_for_approval')
     AND EXISTS (SELECT 1 FROM public.declutter_manager_submissions sub
                  WHERE sub.status = 'waiting'
                    AND sub.item_id = CASE WHEN p_action = 'remove_item_photo'
                                           THEN (SELECT ph.item_id FROM public.declutter_item_photos ph WHERE ph.id = v_target)
                                           ELSE v_target END) THEN
    RAISE EXCEPTION 'waiting_for_seller' USING ERRCODE = '22023',
      HINT = 'The seller is reviewing this draft. You can change it if they send it back.';
  END IF;

  -- Owner 11-01: the manager sends a finished draft to the seller; it is never posted by the manager.
  IF p_action = 'submit_for_approval' THEN
    SELECT * INTO v_item FROM public.declutter_items WHERE id = v_target FOR UPDATE;
    IF v_item.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023', HINT = 'Only a draft can be sent for approval.';
    END IF;
    INSERT INTO public.declutter_manager_submissions (item_id, grant_id, seller_id, manager_id, status, note, submitted_at, decided_at)
    VALUES (v_target, v_g.id, p_seller, v_mgr, 'waiting', NULL, now(), NULL)
    ON CONFLICT (item_id) DO UPDATE SET grant_id = EXCLUDED.grant_id, manager_id = EXCLUDED.manager_id, status = 'waiting',
      note = NULL, submitted_at = now(), decided_at = NULL;
    INSERT INTO public.declutter_manager_actions (grant_id, seller_id, manager_id, action, target_id)
    VALUES (v_g.id, p_seller, v_mgr, p_action, v_target);
    SELECT count(*) INTO v_pos FROM public.declutter_manager_submissions sub
     WHERE sub.seller_id = p_seller AND sub.manager_id = v_mgr AND sub.status = 'waiting';
    PERFORM public.declutter_notify(p_seller, 'declutter_listings', 'Waiting for your OK',
      format('%s listed %s for you. Review and post %s.', public.declutter_manager_first_name(v_mgr),
             CASE WHEN v_pos = 1 THEN '1 item' ELSE v_pos::text || ' items' END,
             CASE WHEN v_pos = 1 THEN 'it' ELSE 'them' END),
      '/declutter?tab=selling', v_mgr);
    RETURN jsonb_build_object('result', 'waiting');
  END IF;

  -- Photos: the manager's OWN upload in their own folder for this item, on the seller's draft.
  IF p_action = 'add_item_photo' THEN
    v_path := v_a ->> 'storage_path';
    SELECT * INTO v_item FROM public.declutter_items WHERE id = v_target FOR UPDATE;
    IF v_item.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023', HINT = 'Photos can be added to drafts.';
    END IF;
    IF v_path IS NULL
       OR split_part(v_path, '/', 1) IS DISTINCT FROM v_mgr::text
       OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(v_path, '/', 3) IS DISTINCT FROM v_target::text
       OR NOT EXISTS (
         SELECT 1 FROM storage.objects o
          WHERE o.bucket_id = 'job-photos'
            AND o.name = v_path
            AND (o.owner_id = v_mgr::text OR o.owner = v_mgr)
            AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
            AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    SELECT g.p INTO v_pos FROM generate_series(0, 11) AS g(p)
     WHERE NOT EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.item_id = v_target AND ph.position = g.p)
     ORDER BY g.p LIMIT 1;
    IF v_pos IS NULL THEN
      RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'A listing has at most 12 photos.';
    END IF;
    INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
    VALUES (v_target, p_seller, v_path, v_pos)
    RETURNING jsonb_build_object('result', id) INTO v_result;
    UPDATE public.declutter_items SET updated_at = now() WHERE id = v_target;
    INSERT INTO public.declutter_manager_actions (grant_id, seller_id, manager_id, action, target_id)
    VALUES (v_g.id, p_seller, v_mgr, p_action, v_target);
    RETURN v_result;
  END IF;

  -- Lead 11-01 (supersedes 10:31): the seller attests only herself, at approval or on her own edits. A manager's edit
  -- of a live listing never touches her attestation: declutter_edit_listing requires the four answers and re-stamps
  -- the row, so the manager's own answers are ignored, hers are passed through, and her row is put back as it was.
  IF p_action = 'edit_listing' THEN
    SELECT a.attested_at INTO v_attested_at FROM public.declutter_tax_attestations a WHERE a.item_id = v_target;
    IF v_attested_at IS NULL THEN
      RAISE EXCEPTION 'attestation_required' USING ERRCODE = '22023',
        HINT = 'The seller has to confirm this listing herself first.';
    END IF;
    v_a := v_a || jsonb_build_object('bought_for_personal_use', true, 'not_in_the_business', true,
                                     'not_a_frequent_seller', true, 'keeps_item_until_handover', true);
  END IF;

  -- Act as the seller for this one call.
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  v_prev_claims := current_setting('request.jwt.claims', true);
  PERFORM set_config('request.jwt.claim.sub', p_seller::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_set(COALESCE(NULLIF(v_prev_claims, '')::jsonb, '{}'::jsonb), '{sub}', to_jsonb(p_seller::text))::text, true);
  BEGIN
    IF (SELECT auth.uid()) IS DISTINCT FROM p_seller THEN
      RAISE EXCEPTION 'act_as_seller_failed' USING ERRCODE = '42501';
    END IF;
    v_result := CASE p_action
      WHEN 'create_item' THEN to_jsonb(public.declutter_create_item_with_id(
        v_target, v_a ->> 'title', v_a ->> 'description', v_a ->> 'category', (v_a ->> 'condition_stars')::integer,
        v_a ->> 'delivery_size', (v_a ->> 'price_cents')::integer, (v_a ->> 'floor_price_cents')::integer,
        v_a ->> 'area_label', v_a ->> 'pickup_address', (v_a ->> 'pickup_lat')::numeric, (v_a ->> 'pickup_lng')::numeric))
      WHEN 'update_draft' THEN to_jsonb(public.declutter_update_draft(
        v_target, v_a ->> 'title', v_a ->> 'description', v_a ->> 'category', (v_a ->> 'condition_stars')::integer,
        v_a ->> 'delivery_size', (v_a ->> 'price_cents')::integer, (v_a ->> 'floor_price_cents')::integer,
        v_a ->> 'area_label', v_a ->> 'pickup_address', (v_a ->> 'pickup_lat')::numeric, (v_a ->> 'pickup_lng')::numeric))
      WHEN 'remove_item_photo' THEN to_jsonb(public.declutter_remove_item_photo(v_target))
      WHEN 'edit_listing' THEN to_jsonb(public.declutter_edit_listing(v_target, v_a ->> 'title', v_a ->> 'description',
        v_a ->> 'category', (v_a ->> 'condition_stars')::integer, v_a ->> 'delivery_size',
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_a -> 'handovers', '[]'::jsonb))),
        (v_a ->> 'bought_for_personal_use')::boolean, (v_a ->> 'not_in_the_business')::boolean,
        (v_a ->> 'not_a_frequent_seller')::boolean, (v_a ->> 'keeps_item_until_handover')::boolean))
      WHEN 'set_handovers' THEN to_jsonb(public.declutter_set_handovers(v_target,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_a -> 'handovers', '[]'::jsonb)))))
      WHEN 'pause_listing' THEN to_jsonb(public.declutter_pause_listing(v_target))
      WHEN 'withdraw_item' THEN to_jsonb(public.declutter_withdraw_item(v_target))
      WHEN 'set_listing_price' THEN to_jsonb(public.declutter_set_listing_price(v_target,
        (v_a ->> 'price_cents')::integer, (v_a ->> 'floor_price_cents')::integer))
      WHEN 'set_listing_drops' THEN to_jsonb(public.declutter_set_listing_drops(v_target, (v_a ->> 'on')::boolean))
      WHEN 'respond_offer' THEN to_jsonb(public.declutter_respond_offer(v_target, v_a ->> 'action',
        (v_a ->> 'amount_cents')::integer))
      WHEN 'set_offer_rules' THEN to_jsonb(public.declutter_set_offer_rules(v_target,
        (v_a ->> 'accepts_offers')::boolean, (v_a ->> 'auto_offers')::boolean)::text)
      WHEN 'answer_question' THEN to_jsonb(public.declutter_answer_question(v_target, v_a ->> 'answer'))
      WHEN 'send_order_message' THEN to_jsonb(public.declutter_send_order_message(v_target, v_a ->> 'body'))
      WHEN 'order_talk_view' THEN public.declutter_order_talk_view(v_target)
      WHEN 'set_pickup_windows' THEN to_jsonb(public.declutter_set_pickup_windows(COALESCE(v_a -> 'windows', '[]'::jsonb)))
      WHEN 'confirm_handover' THEN public.declutter_confirm_handover(v_target, v_a ->> 'method', v_a ->> 'code')
    END;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
    PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), true);
  IF (SELECT auth.uid()) IS DISTINCT FROM v_mgr THEN
    RAISE EXCEPTION 'act_as_seller_not_restored' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'edit_listing' THEN
    UPDATE public.declutter_tax_attestations SET seller_id = p_seller, attested_at = v_attested_at WHERE item_id = v_target;
  END IF;
  INSERT INTO public.declutter_manager_actions (grant_id, seller_id, manager_id, action, target_id)
  VALUES (v_g.id, p_seller, v_mgr, p_action, v_target);
  IF p_action = 'answer_question' THEN
    INSERT INTO public.declutter_manager_messages (kind, message_id, grant_id, seller_id, manager_id)
    VALUES ('answer', v_target, v_g.id, p_seller, v_mgr)
    ON CONFLICT (kind, message_id) DO UPDATE SET grant_id = EXCLUDED.grant_id, manager_id = EXCLUDED.manager_id,
      created_at = now();
  ELSIF p_action = 'send_order_message' THEN
    INSERT INTO public.declutter_manager_messages (kind, message_id, grant_id, seller_id, manager_id)
    VALUES ('order_talk', (v_result #>> '{}')::uuid, v_g.id, p_seller, v_mgr);
  END IF;
  RETURN jsonb_build_object('result', v_result);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_manage(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manage(uuid, text, jsonb) TO authenticated, service_role;

-- declutter_respond_offer: restated from 20261102113853_declutter_notices_retire_when_their_subject_moves_on.sql.
CREATE OR REPLACE FUNCTION public.declutter_respond_offer(p_offer_id uuid, p_action text, p_amount_cents integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item_id uuid;
  v_side text;
  o record;
  v_item record;
  v_other uuid;
  v_rules record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_action IS NULL OR p_action NOT IN ('accept', 'decline', 'counter', 'withdraw') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  -- Learn the item, then lock ITEM before the thread (lock order item ->
  -- offer): two answers on one item serialize on the item row.
  SELECT f.item_id INTO v_item_id FROM public.declutter_offers f
   WHERE f.id = p_offer_id AND (f.buyer_id = v_uid OR f.seller_id = v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT i.id, i.status, i.title, i.current_price_cents, i.accepts_offers INTO v_item
    FROM public.declutter_items i WHERE i.id = v_item_id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_offers f WHERE f.id = p_offer_id FOR UPDATE;
  IF o.status <> 'open' THEN
    RAISE EXCEPTION 'offer_not_open' USING ERRCODE = '55000', HINT = 'This offer is already closed.';
  END IF;
  v_side := CASE WHEN o.buyer_id = v_uid THEN 'buyer' ELSE 'seller' END;
  v_other := CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END;

  IF p_action = 'withdraw' THEN
    IF v_side <> 'buyer' THEN
      RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
    END IF;
    UPDATE public.declutter_offers SET status = 'withdrawn', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (p_offer_id, 'buyer', 'withdraw');
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'Offer withdrawn',
      format('The buyer took back their offer on "%s".', v_item.title), '/declutter?tab=selling', o.buyer_id);
    RETURN 'withdrawn';
  END IF;

  IF o.awaiting <> v_side THEN
    RAISE EXCEPTION 'not_your_turn' USING ERRCODE = '55000', HINT = 'Waiting for the other side to answer.';
  END IF;
  IF o.respond_by <= now() THEN
    RAISE EXCEPTION 'offer_expired' USING ERRCODE = '55000', HINT = 'This offer ran out of time.';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.declutter_offers SET status = 'declined', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (p_offer_id, v_side, 'decline');
    -- One wording for every decline (B26): never says why.
    PERFORM public.declutter_notify(v_other, 'new_offers', 'Offer declined',
      format('Your offer on "%s" was declined. Nothing was charged.', v_item.title),
      CASE WHEN v_side = 'seller' THEN '/declutter/item/' || o.item_id::text ELSE '/declutter?tab=selling' END, v_uid);
    RETURN 'declined';
  END IF;

  -- accept / counter: the item must still be for sale, both sides still in.
  IF v_item.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'This item is no longer for sale.';
  END IF;
  IF public.declutter_seller_out(o.seller_id) OR public.are_users_blocked(o.seller_id, o.buyer_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF public.declutter_member_out(v_other) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;

  IF p_action = 'counter' THEN
    -- Smart offers (owner 2026-10-29): with offers off the seller takes Buy only; a buyer's counter is refused,
    -- open threads stay and the seller may still answer them.
    IF v_side = 'buyer' AND NOT v_item.accepts_offers THEN
      RAISE EXCEPTION 'offers_off' USING ERRCODE = '55000', HINT = 'This seller is not taking offers. You can still buy it.';
    END IF;
    IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents > v_item.current_price_cents THEN
      RAISE EXCEPTION 'invalid_offer_amount' USING ERRCODE = '22023';
    END IF;
    IF v_side = 'buyer' AND p_amount_cents * 2 < v_item.current_price_cents THEN
      RAISE EXCEPTION 'offer_too_low' USING ERRCODE = '22023', HINT = 'Offers must be at least half the current price.';
    END IF;
    IF p_amount_cents = o.amount_cents THEN
      RAISE EXCEPTION 'counter_same_amount' USING ERRCODE = '22023', HINT = 'To agree to this amount, accept it.';
    END IF;
    -- Smart offers: the seller's automatic answer. A buyer's counter at or above the seller's lowest price, with
    -- auto on and that price below today's, is accepted at once below, exactly as the seller tapping Accept.
    IF v_side = 'buyer' THEN
      SELECT p.auto_offers, p.floor_price_cents INTO v_rules FROM public.declutter_item_private p WHERE p.item_id = o.item_id;
      IF COALESCE(v_rules.auto_offers, false) AND v_rules.floor_price_cents < v_item.current_price_cents
         AND p_amount_cents >= v_rules.floor_price_cents THEN
        UPDATE public.declutter_offers SET amount_cents = p_amount_cents, updated_at = now()
         WHERE id = p_offer_id AND status = 'open';
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
        VALUES (p_offer_id, 'buyer', 'counter', p_amount_cents);
        o.amount_cents := p_amount_cents;
        v_side := 'seller';
        p_action := 'accept';
      END IF;
    END IF;
  END IF;

  IF p_action = 'counter' THEN
    UPDATE public.declutter_offers
       SET amount_cents = p_amount_cents,
           awaiting = CASE WHEN v_side = 'buyer' THEN 'seller' ELSE 'buyer' END,
           respond_by = now() + interval '48 hours',
           counter_count = counter_count + 1,
           updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
    VALUES (p_offer_id, v_side, 'counter', p_amount_cents);
    PERFORM public.declutter_notice_ref(p_offer_id); -- Q2659
    PERFORM public.declutter_notify(v_other, 'new_offers', 'New counteroffer',
      format('You got a $%s counteroffer on "%s". Accept, decline or counter within 48 hours.',
             to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.title),
      '/declutter?tab=' || CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'buying' END, v_uid);
    RETURN 'countered';
  END IF;

  -- accept. The buyer pays, so the buyer needs a card on file and to be 18+
  -- (row 53) even when it is the seller who accepts.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = o.buyer_id) THEN
    RAISE EXCEPTION 'card_required' USING ERRCODE = '42501',
      HINT = 'The buyer needs a saved card. It is never charged until checkout.';
  END IF;
  IF public.member_under_18(o.buyer_id) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;
  -- B28: an agreed amount above today's price (the price dropped since the
  -- counter) is charged at today's price: accepting never costs more than Buy.
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (p_offer_id, v_side, 'accept', least(o.amount_cents, v_item.current_price_cents));
  PERFORM public.declutter_take_item(o.item_id, o.buyer_id, least(o.amount_cents, v_item.current_price_cents), 'offer', p_offer_id);
  IF v_side = 'seller' AND v_uid = o.buyer_id THEN
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'Offer accepted automatically',
      format('Accepted automatically at or above your lowest price: $%s for "%s".',
             to_char(least(o.amount_cents, v_item.current_price_cents) / 100.0, 'FM999990.00'), v_item.title),
      '/declutter?tab=selling', o.buyer_id);
  END IF;
  RETURN 'accepted';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_respond_offer(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_respond_offer(uuid, text, integer) TO authenticated, service_role;

-- declutter_update_draft: restated from 20261027170717_declutter_free_section.sql.
CREATE OR REPLACE FUNCTION public.declutter_update_draft(
  p_item_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_condition_stars integer,
  p_delivery_size text,
  p_price_cents integer,
  p_floor_price_cents integer,
  p_area_label text,
  p_pickup_address text,
  p_pickup_lat numeric,
  p_pickup_lng numeric
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_at timestamptz := now();
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- Free (20261027170717): price 0 and a 0 floor.
  IF p_price_cents = 0 THEN
    IF COALESCE(p_floor_price_cents, 0) <> 0 THEN
      RAISE EXCEPTION 'invalid_floor_price' USING ERRCODE = '22023', HINT = 'A free item has no lowest price.';
    END IF;
    p_floor_price_cents := 0;
  ELSIF p_price_cents IS NULL OR p_floor_price_cents IS NULL
     OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;
  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;
  IF public.declutter_area_label_problem(p_area_label, p_pickup_address) IS NOT NULL THEN
    RAISE EXCEPTION 'area_looks_like_address'
      USING ERRCODE = '22023', HINT = 'Use your neighborhood or town, not a street address.';
  END IF;

  -- lh-authz-rls review must-fix 3: the AI judged THIS text; changed text is
  -- unjudged (B19). And the four confirmations were made for the item as it
  -- was described: an edit asks for them again (review nit 7).
  IF v_item.title IS DISTINCT FROM btrim(p_title)
     OR v_item.description IS DISTINCT FROM COALESCE(btrim(p_description), '')
     OR v_item.category IS DISTINCT FROM p_category THEN
    UPDATE public.declutter_item_private
       SET ai_checked_at = NULL, ai_flag_reason = NULL
     WHERE item_id = p_item_id;
    DELETE FROM public.declutter_tax_attestations WHERE item_id = p_item_id;
  END IF;

  UPDATE public.declutter_items
     SET title = btrim(p_title),
         description = COALESCE(btrim(p_description), ''),
         category = p_category,
         condition_stars = p_condition_stars,
         delivery_size = p_delivery_size,
         price_cents = p_price_cents,
         current_price_cents = p_price_cents,
         area_label = btrim(p_area_label),
         area_lat = round(p_pickup_lat, 2),
         area_lng = round(p_pickup_lng, 2),
         updated_at = v_at
   WHERE id = p_item_id;
  UPDATE public.declutter_item_private
     SET floor_price_cents = p_floor_price_cents,
         pickup_address = btrim(p_pickup_address),
         pickup_lat = p_pickup_lat,
         pickup_lng = p_pickup_lng,
         updated_at = v_at
   WHERE item_id = p_item_id AND seller_id = v_uid;
  RETURN v_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_update_draft(uuid, text, text, text, integer, text, integer, integer, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_update_draft(uuid, text, text, text, integer, text, integer, integer, text, text, numeric, numeric) TO authenticated, service_role;

-- declutter_wanted_reply: restated from 20261030154707_declutter_wanted_email.sql.
CREATE OR REPLACE FUNCTION public.declutter_wanted_reply(p_wanted_id uuid, p_item_id uuid, p_amount_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  w public.declutter_wanted;
  i record;
  v_id uuid;
  v_message text;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF public.declutter_seller_out(v_uid) THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Item first, then the post (the offer paths lock item -> offer; nothing else locks a post then an item).
  SELECT it.id, it.seller_id, it.status, it.sale_mode, it.current_price_cents, it.title, it.is_seed,
         it.area_lat, it.area_lng INTO i
    FROM public.declutter_items it WHERE it.id = p_item_id AND it.seller_id = v_uid FOR UPDATE;
  IF i.id IS NULL OR i.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  -- One answer for every post you may not reply to: no oracle for private, blocked or hidden posts.
  IF w.id IS NULL OR NOT w.public OR w.status <> 'open' OR w.expires_at <= now() OR w.user_id = v_uid
     OR public.are_users_blocked(v_uid, w.user_id)
     OR public.declutter_member_out(w.user_id)
     OR public.member_under_18(w.user_id)
     OR public.declutter_seller_hidden(w.user_id)
     OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())) THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF i.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Only a listing that is for sale now can answer.';
  END IF;
  IF i.is_seed IS TRUE AND public.seed_hidden_for(w.user_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- W6: inside the post's distance, measured listing to post (as the match alerts do). IS NOT TRUE: a NULL distance
  -- refuses, never skips the RAISE.
  IF (public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles) IS NOT TRUE THEN
    RAISE EXCEPTION 'listing_too_far' USING ERRCODE = '22023',
      HINT = 'This listing is farther away than the buyer will travel.';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents > least(w.max_price_cents, i.current_price_cents) THEN
    RAISE EXCEPTION 'invalid_reply_amount' USING ERRCODE = '22023',
      HINT = 'Your price is at most their Wanted price and at most your listing''s price.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.wanted_id = w.id AND o.seller_id = v_uid) THEN
    RAISE EXCEPTION 'already_replied' USING ERRCODE = '23505', HINT = 'You already answered this Wanted post.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_reply:' || v_uid::text));
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.seller_id = v_uid AND o.wanted_id IS NOT NULL AND o.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'reply_rate_limited' USING ERRCODE = '54000', HINT = 'You can answer 10 Wanted posts a day.';
  END IF;
  -- Only a listing with no open offer can answer: the answer then depends on the seller's own listing only, never on
  -- WHO the poster is (an "already open between you two" refusal named the poster: review #2).
  IF EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.item_id = i.id AND o.status = 'open') THEN
    RAISE EXCEPTION 'listing_has_open_offer' USING ERRCODE = '55000', HINT = 'This listing has an open offer. Answer with another listing, or after it closes.';
  END IF;
  -- At most 5 answers a day per POST (lead ruling on review N1, 10-21): a per-poster refusal would tell a seller that
  -- two posts share one poster. With at most 10 open posts a poster, that still bounds every later notice the offer
  -- paths send (expiry, voided, closed); the per-poster bound is the silent alert cap below.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_post_answers:' || w.id::text));
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.wanted_id = w.id AND o.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'wanted_busy' USING ERRCODE = '54000', HINT = 'This post has enough answers for today. Try tomorrow.';
  END IF;
  -- The Wanted post is the poster's opening ask; the answer is the seller's counter to it (counter_count 1, a
  -- 'counter' event), so the existing offer wording ("You did not answer the counteroffer within 48 hours",
  -- "The buyer did not answer your counteroffer") is true for it.
  INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, counter_count, wanted_id)
  VALUES (i.id, w.user_id, v_uid, p_amount_cents, 'buyer', now() + interval '48 hours', 1, w.id)
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (v_id, 'seller', 'counter', p_amount_cents);
  -- At most 5 "match" alerts a day per poster (this one included), silently: later answers still arrive as offers,
  -- and nothing the seller sees depends on it.
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.buyer_id = w.user_id AND o.wanted_id IS NOT NULL AND o.created_at > now() - interval '24 hours') <= 5 THEN
    v_message := format('A seller near you has "%s" for $%s, at or under your Wanted price. Accept, counter or decline within 48 hours.',
             i.title, to_char(p_amount_cents / 100.0, 'FM999990.00'));
    -- Q2489: the poster is the buyer on this offer, so the notice opens Buying.
    PERFORM public.declutter_notify(w.user_id, 'new_offers', 'A seller has a match', v_message, '/declutter?tab=buying', v_uid);
    -- D4-11: the same words by email, under the Wanted email switch. Same rule as the writer: a test seller never
    -- reaches a real member.
    IF NOT (COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = v_uid), false)
            AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = w.user_id), false)) THEN
      PERFORM public.declutter_wanted_email(w.user_id, 'A seller has a match', v_message, '/declutter?tab=buying');
    END IF;
  END IF;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_wanted_reply(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_reply(uuid, uuid, integer) TO authenticated, service_role;
