-- Declutter: a new listing goes LIVE when it is posted (owner 2026-10-29, item B of
-- the Selling audit: "Admin shouldn't need to review nearly anything unless
-- something is reported").
--
-- WHY
--   Before this, declutter_publish_item held every listing of a seller with fewer
--   than 3 admin-approved listings (row 33) for an admin, and a live listing whose
--   title, description or category changed always went back to an admin, because
--   declutter_record_ai_check only judged drafts. Members had no way to report a
--   listing (reports_reported_type_check had no listing type).
--
-- WHAT THIS DOES (each function restated from its EFFECTIVE prod definition,
-- read with pg_get_functiondef on 2026-10-30; the repo's newest copies are
-- 20261027163240 (publish), 20261014200728 (record_ai_check) and 20261029205908
-- (edit_listing)):
--   1. declutter_publish_item: the "first 3 need an admin" rule is gone. A listing
--      is held (pending_review) only when the automatic check flagged it or did
--      not come back (fail-safe); otherwise it goes live. The contact-leak trigger
--      (refuses the write) and the test-data marking are unchanged.
--   2. declutter_record_ai_check: also judges a listing an edit sent back
--      (pending_review, its check cleared, it was live before: live_at set). A
--      clean result puts it back live by itself; a flag keeps it held for an admin
--      and closes its open offers (buyers told, nothing charged). A seller who
--      cannot sell now (restricted, 3 strikes, under 18) stays held, as an admin's
--      approval refuses them (declutter_admin_review_item must-fix 2).
--   3. declutter_edit_listing: a big edit no longer closes open offers. Each buyer
--      with an open offer is told the listing changed and to check it before the
--      offer is answered (lead 2026-10-30). The re-check closes them only on a flag.
--   4. reports_reported_type_check admits 'declutter_item', so a member can report
--      a listing through the shared reports table (RLS: own insert, admins read;
--      the ledger trigger carries it to the admin queue).
--   5. declutter_admin_take_down_item(item, note, report): an admin takes a
--      reported listing down (live / paused / pending_review -> removed), open
--      offers close with a notice, the seller is told why, admin_audit_log keeps
--      the report id, and the report is marked resolved. Never the admin's own.
--   6. declutter_admin_reported_items(ids): the admin reports queue names a
--      reported listing (title, seller, status, test or not) whatever its status.
--
-- Every client RPC starts with require_feature('declutter') and names
-- is_caller_banned() (Q281). Grants by role name: REVOKE ... FROM PUBLIC, anon.
-- Replay-safe: CREATE OR REPLACE and DROP CONSTRAINT IF EXISTS.

-- ---------------------------------------------------------------------------
-- 1. Publish: live unless the automatic check flagged it or did not run.
CREATE OR REPLACE FUNCTION public.declutter_publish_item(p_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_floor integer;
  v_ai_checked timestamptz;
  v_ai_flag text;
  v_photos integer;
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_a_draft' USING ERRCODE = '22023';
  END IF;
  IF v_item.sale_mode <> 'offers' THEN
    -- Row 55: bidding waits for the auctioneer licence.
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;

  -- Row 23 (payout setup before the first listing) is dropped (owner
  -- 2026-10-27, "list first, set up at first sale"): a paid order makes the
  -- seller eligible to set up, and the payout waits until they have.

  SELECT count(*)::integer INTO v_photos FROM public.declutter_item_photos WHERE item_id = p_item_id;
  IF v_photos < 1 OR v_photos > 12 THEN
    RAISE EXCEPTION 'photos_required'
      USING ERRCODE = '22023', HINT = 'Add at least 1 photo (up to 12).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.declutter_tax_attestations a WHERE a.item_id = p_item_id AND a.seller_id = v_uid) THEN
    RAISE EXCEPTION 'attestation_required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = v_uid) THEN
    RAISE EXCEPTION 'pickup_windows_required' USING ERRCODE = '22023';
  END IF;

  SELECT floor_price_cents, ai_checked_at, ai_flag_reason INTO v_floor, v_ai_checked, v_ai_flag
    FROM public.declutter_item_private WHERE item_id = p_item_id FOR UPDATE;
  IF v_floor IS NULL OR v_floor > v_item.current_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price' USING ERRCODE = '22023';
  END IF;

  -- Owner 2026-10-29 (item B): a listing goes live when it is posted. Only a
  -- failed automatic check holds it for an admin: flagged, or never came back
  -- (fail-safe, B19). Row 33's "first 3 listings wait for an admin" is gone.
  v_status := CASE
    WHEN v_ai_checked IS NULL OR v_ai_flag IS NOT NULL THEN 'pending_review'
    ELSE 'live'
  END;

  UPDATE public.declutter_items
     SET status = v_status,
         submitted_at = now(),
         live_at = CASE WHEN v_status = 'live' THEN now() END,
         updated_at = now()
   WHERE id = p_item_id;
  RETURN v_status;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_publish_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_publish_item(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The automatic check also judges a listing an edit sent back.
CREATE OR REPLACE FUNCTION public.declutter_record_ai_check(p_item_id uuid, p_seller_id uuid, p_judged_photo_ids uuid[], p_judged_title text, p_judged_description text, p_judged_category text, p_flag_reason text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.declutter_items%ROWTYPE;
  v_current uuid[];
  v_at timestamptz := now();
  v_flag text := NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), '');
  r record;
BEGIN
  -- A draft (before publishing), or a listing an edit sent back for this check:
  -- it was live before (live_at set) and its result was cleared by the edit. A
  -- listing already judged (flagged, waiting for an admin) is never re-judged,
  -- so a flag cannot be washed off by asking again.
  SELECT i.* INTO v_item FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = p_seller_id
     AND (i.status = 'draft'
          OR (i.status = 'pending_review' AND i.live_at IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                           WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL)))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_current
    FROM public.declutter_item_photos WHERE item_id = p_item_id;
  IF v_current IS DISTINCT FROM (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(p_judged_photo_ids) AS x)
     OR v_item.title IS DISTINCT FROM p_judged_title
     OR v_item.description IS DISTINCT FROM p_judged_description
     OR v_item.category IS DISTINCT FROM p_judged_category THEN
    RAISE EXCEPTION 'ai_check_stale' USING ERRCODE = '40001';
  END IF;
  UPDATE public.declutter_item_private
     SET ai_checked_at = v_at,
         ai_flag_reason = v_flag,
         updated_at = v_at
   WHERE item_id = p_item_id;

  IF v_item.status = 'pending_review' THEN
    IF v_flag IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr
                        WHERE pr.user_id = v_item.seller_id
                          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
       AND public.declutter_active_strike_count(v_item.seller_id) < 3
       AND NOT public.member_under_18(v_item.seller_id) THEN
      -- Clean: back in front of buyers, its open offers still open.
      UPDATE public.declutter_items
         SET status = 'live', updated_at = v_at
       WHERE id = p_item_id AND status = 'pending_review';
    ELSIF v_flag IS NOT NULL THEN
      -- Flagged: held for an admin, and its open offers close (buyers told, nothing charged).
      FOR r IN
        UPDATE public.declutter_offers
           SET status = 'voided', closed_at = v_at, updated_at = v_at
         WHERE item_id = p_item_id AND status = 'open'
        RETURNING id, buyer_id
      LOOP
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
        PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing changed',
          format('The seller changed "%s", so your offer is closed. Nothing was charged.', v_item.title),
          '/declutter?tab=buying', v_item.seller_id);
      END LOOP;
    END IF;
  END IF;
  RETURN v_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. A big edit keeps open offers open and tells their buyers.
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

-- ---------------------------------------------------------------------------
-- 4. A member can report a listing (the shared reports table; its RLS and
--    ledger trigger are unchanged).
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reported_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text, 'application'::text, 'declutter_item'::text]));

-- ---------------------------------------------------------------------------
-- 5. An admin takes a reported listing down.
CREATE OR REPLACE FUNCTION public.declutter_admin_take_down_item(p_item_id uuid, p_note text, p_report_id uuid DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required'
      USING ERRCODE = '22023', HINT = 'Say why the listing is taken down.';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- As declutter_admin_review_item: an admin never decides on their own listing.
  IF v_item.seller_id = v_uid THEN
    RAISE EXCEPTION 'own_listing' USING ERRCODE = '42501', HINT = 'Another admin must decide on your own listing.';
  END IF;
  -- Reserved / sold / completed have a buyer and money in play: those go through
  -- the order's problem case, never a take-down.
  IF v_item.status NOT IN ('live', 'paused', 'pending_review') THEN
    RAISE EXCEPTION 'item_not_removable' USING ERRCODE = '22023';
  END IF;
  -- The report, when the take-down comes from one, must be about this listing.
  IF p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports rp
        WHERE rp.id = p_report_id AND rp.reported_type = 'declutter_item' AND rp.reported_id = p_item_id) THEN
    RAISE EXCEPTION 'report_not_for_item' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Item taken down',
      format('"%s" was taken down, so your offer is closed. Nothing was charged.', v_item.title),
      '/declutter?tab=buying', v_uid);
  END LOOP;

  UPDATE public.declutter_items SET status = 'removed', updated_at = now() WHERE id = p_item_id;
  UPDATE public.declutter_item_private SET review_note = v_note, updated_at = now() WHERE item_id = p_item_id;
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_listing_taken_down', 'declutter_item', p_item_id::text,
          jsonb_build_object('note', v_note, 'report_id', p_report_id, 'was', v_item.status));

  PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your listing was taken down',
    format('"%s" was taken down: %s', COALESCE(v_item.title, 'Your item'), v_note),
    '/declutter/item/' || p_item_id::text, v_uid);
  RETURN 'removed';
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_take_down_item(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_take_down_item(uuid, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The admin reports queue names a reported listing whatever its status (the
--    items policy shows an admin only live and reserved ones, like any member).
CREATE OR REPLACE FUNCTION public.declutter_admin_reported_items(p_item_ids uuid[])
 RETURNS TABLE(item_id uuid, title text, seller_id uuid, status text, is_seed boolean)
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
    SELECT i.id, i.title, i.seller_id, i.status, COALESCE(i.is_seed, false)
      FROM public.declutter_items i
     WHERE i.id = ANY (COALESCE(p_item_ids, ARRAY[]::uuid[]))
     LIMIT 500;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_reported_items(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_reported_items(uuid[]) TO authenticated, service_role;
