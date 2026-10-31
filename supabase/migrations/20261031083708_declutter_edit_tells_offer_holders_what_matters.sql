-- BUY-11 (buying audit 10-30 #11): a seller's edit to condition, size or the ways to get an item counted as small:
-- no re-check (right) and no notice (wrong). A seller could drop condition from 5 stars to 1, change the size (and so
-- the Helpr delivery price) or take porch pickup away while a buyer's offer stood, and the buyer was never told; only
-- title, description and category told offer holders.
-- declutter_edit_listing is restated verbatim from 20261030071816_declutter_live_on_post.sql with one change: on a
-- small edit that changes condition, size or ways, every open-offer buyer gets the same "Listing updated" notice the
-- big edit sends, naming what changed. Offers stay open (owner/lead 2026-10-30). The item stays live; no re-check.
-- Grants unchanged. Replay-safe: CREATE OR REPLACE; REVOKE/GRANT are idempotent.

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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
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
