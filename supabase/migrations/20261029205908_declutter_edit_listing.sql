-- Editing a live Declutter listing (audit 1028 D1-1).
--
-- What was broken: a live listing could not be edited at all. Manage offered price, pause, mark sold and delete;
-- fixing a typo in the title meant taking the listing down (its photos are deleted) and listing it again.
--
-- The owner's rule (2026-10-29, relayed by the lead: "REVIEW ONLY BIG CHANGES"):
--   * Title, description or category changed: the listing goes back to pending_review (hidden from buyers until an
--     admin approves it), the AI check is voided, and open offers close with a notice, as a pause does.
--   * Only condition, size or the ways buyers can get it changed: saved at once; the listing stays live and open
--     offers stay open.
--   * The tax checkbox (the four confirmations) is given again on every edit.
-- "Big" is decided HERE from the stored row against the new values (trimmed), never from anything the client says.
--
-- Scope: only a LIVE listing is edited (a paused one is relisted first; a reserved or sold one has a buyer, and a
-- listing in review waits for it). A live item has no cart line or order (declutter_take_item reserves it), so
-- changing its ways cannot move an open order. Photos are not edited here: the photo functions stay draft-only, and
-- photo edits on a live listing are their own queue item. Price stays with declutter_set_listing_price.
--
-- The ways freeze once listed (lh-money-escrow review 2026-10-28 #4-5; 20261028235249 let a listed item ADD a way,
-- never remove one, and turn porch ON, never OFF). Both triggers are restated from 20261028235249 with one exception:
-- a change made inside declutter_edit_listing on a live item, which sets a transaction-local flag naming the item.
-- A member cannot set that flag (no SQL from the client; PostgREST sets only request.* settings).
--
-- REPLAY-SAFETY: CREATE OR REPLACE only; the triggers themselves already exist (20261028235247, 20261017055504).

CREATE OR REPLACE FUNCTION public.declutter_items_handovers_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.handovers IS DISTINCT FROM OLD.handovers AND OLD.status <> 'draft'
     AND NOT (OLD.handovers IS NOT NULL AND NEW.handovers IS NOT NULL AND OLD.handovers <@ NEW.handovers)
     AND NOT (OLD.status = 'live' AND current_setting('declutter.editing_listing', true) = OLD.id::text) THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023',
      HINT = 'Once listed, you can add ways buyers can get it, not take them away.';
  END IF;
  IF NEW.porch_ok IS DISTINCT FROM OLD.porch_ok AND NEW.handovers IS NOT NULL
     AND NEW.handovers IS NOT DISTINCT FROM OLD.handovers THEN
    NEW.handovers := CASE WHEN NEW.porch_ok
      THEN (SELECT array_agg(DISTINCT w ORDER BY w) FROM unnest(NEW.handovers || ARRAY['porch']) AS w)
      ELSE array_remove(NEW.handovers, 'porch') END;
    IF cardinality(NEW.handovers) < 1 THEN
      RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023',
        HINT = 'Porch pickup is the only way buyers can get this item. Tick another way first.';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_handovers_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declutter_items_porch_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.porch_ok IS DISTINCT FROM OLD.porch_ok AND OLD.status <> 'draft'
     AND NOT (OLD.porch_ok IS FALSE AND NEW.porch_ok IS TRUE)
     AND NOT (OLD.status = 'live' AND current_setting('declutter.editing_listing', true) = OLD.id::text) THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023',
      HINT = 'Porch pickup can only be turned off while the listing is a draft.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_porch_frozen() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declutter_edit_listing(
  p_item_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_condition_stars integer,
  p_delivery_size text,
  p_handovers text[],
  p_bought_for_personal_use boolean,
  p_not_in_the_business boolean,
  p_not_a_frequent_seller boolean,
  p_keeps_item_until_handover boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
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

  -- The text the AI judged is gone (B19); an admin looks again before buyers see it.
  UPDATE public.declutter_item_private
     SET ai_checked_at = NULL, ai_flag_reason = NULL, updated_at = now()
   WHERE item_id = p_item_id;
  -- Open offers close (as a pause): the buyer is told, nothing charged.
  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    -- The Declutter offers kind named here (declutter_notice_type maps titles; this one is new).
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing changed',
      format('The seller changed "%s", so your offer is closed. Nothing was charged.', v_item.title),
      '/declutter?tab=buying', v_uid); -- the buyer's own side (#37); the item itself is in review
  END LOOP;
  UPDATE public.declutter_items
     SET status = 'pending_review', submitted_at = now(), updated_at = now()
   WHERE id = p_item_id;
  RETURN 'pending_review';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_edit_listing(uuid, text, text, text, integer, text, text[], boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_edit_listing(uuid, text, text, text, integer, text, text[], boolean, boolean, boolean, boolean) TO authenticated, service_role;
