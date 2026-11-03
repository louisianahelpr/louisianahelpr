-- Shipping, listing side (Q2259; docs/specs/shipping-draft.md sections 6 and 8; owner decisions 8 and 11): the
-- seller turns on "Ship it" for a small listing by picking the box it ships in (declutter_items.ship_preset).
--
-- Before: ship-rates (S2) quotes, and checkout (S3) offers "Ship it to me", only for an item with a ship_preset
-- (20261030012052; 20261101201500 refuses 'ship' when any line has none), and NOTHING could set one: no RPC, no
-- screen, and declutter_items has no member UPDATE grant. On prod 0 items had a preset (2026-11-03), so no buyer
-- could ever reach a shipped order.
--
-- Now:
--   1. declutter_set_ship_options(item, preset, nothing_restricted): the seller's own listing (draft, in review,
--      live or paused), small and priced only, behind declutter + declutter_shipping. Turning shipping ON needs the
--      seller's tick that nothing in it is on the USPS restricted list (section 8: aerosols, perfume, nail polish,
--      lithium batteries ...), and is a selling choice (declutter_assert_member). Electronics and appliances are
--      pickup-only (section 8 (3): v1 ships nothing with a lithium battery). A NULL preset turns shipping off and
--      never needs the tick or the member gate.
--   2. declutter_ship_options_state(item): the seller's own listing's preset.
--   3. Shipping follows the listing: when an edit makes it not small, free ($0), or moves it to electronics or
--      appliances, its preset is cleared in the same update, so no edit ever trips the small-only CHECK
--      (20261030012052) and a free or restricted item is never offered for shipping.
--
-- NOT here: "I'll pay shipping" (owner decision 9). The S3 checkout and label worker on main always charge the buyer
-- the stored quote, so a seller-paid flag would show "Free shipping" while the buyer still pays. It is its own
-- money change (lh-money-escrow), filed under Q2259.
--
-- Not found answers PT404 (PostgREST 404), never P0002 (500): the Q2390 convention.
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS; REVOKE ... FROM PUBLIC, anon.
-- Proof: src/test/pglite/shippingListingShipIt.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

CREATE OR REPLACE FUNCTION public.declutter_set_ship_options(p_item_id uuid, p_preset text, p_nothing_restricted boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_shipping');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_preset IS NOT NULL AND p_preset NOT IN ('envelope', 'small_box', 'medium_box', 'large_box') THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  IF p_preset IS NOT NULL AND p_nothing_restricted IS NOT TRUE THEN
    RAISE EXCEPTION 'ship_restricted_unconfirmed' USING ERRCODE = '22023',
      HINT = 'Confirm nothing in it is on the USPS restricted list.';
  END IF;
  -- Turning shipping ON is a selling choice (the member gate); turning it OFF never is.
  IF p_preset IS NOT NULL THEN
    v_uid := public.declutter_assert_member(true);
  ELSE
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF p_preset IS NOT NULL AND v_item.delivery_size IS DISTINCT FROM 'small' THEN
    RAISE EXCEPTION 'ship_small_only' USING ERRCODE = '22023', HINT = 'Only small items can ship.';
  END IF;
  IF p_preset IS NOT NULL AND v_item.current_price_cents = 0 THEN
    RAISE EXCEPTION 'ship_not_free_items' USING ERRCODE = '22023', HINT = 'Free items are picked up, not shipped.';
  END IF;
  IF p_preset IS NOT NULL AND v_item.category IN ('electronics', 'appliances') THEN
    RAISE EXCEPTION 'ship_pickup_only_category' USING ERRCODE = '22023',
      HINT = 'Electronics and appliances are pickup only.';
  END IF;
  UPDATE public.declutter_items SET ship_preset = p_preset WHERE id = p_item_id;
  RETURN jsonb_build_object('preset', p_preset);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_ship_options(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_ship_options(uuid, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_ship_options_state(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_out jsonb;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_shipping');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('preset', i.ship_preset) INTO v_out
    FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid;
  IF v_out IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_options_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_ship_options_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_items_ship_follows_listing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.ship_preset IS NOT NULL AND (NEW.delivery_size IS DISTINCT FROM 'small' OR NEW.current_price_cents = 0
                                      OR NEW.category IN ('electronics', 'appliances')) THEN
    NEW.ship_preset := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_ship_follows_listing() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_items_ship_follows_listing ON public.declutter_items;
CREATE TRIGGER trg_declutter_items_ship_follows_listing
  BEFORE UPDATE OF delivery_size, current_price_cents, category ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_items_ship_follows_listing();
