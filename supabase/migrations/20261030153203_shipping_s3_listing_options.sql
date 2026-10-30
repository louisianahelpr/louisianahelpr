-- Shipping S3 (listing side): the seller turns on "Ship it" for a small listing by picking its parcel preset, and
-- may tick "I'll pay shipping" (docs/specs/shipping-draft.md section 6; owner decisions 8, 9 and 11 of 2026-10-20 and
-- 2026-10-29; Q2259). Behind the declutter_shipping switch (testers).
--
-- Why: ship-rates (S2) can quote only an item whose seller picked a parcel preset (declutter_items.ship_preset,
-- 20261030012052), and nothing could set one. Seller-paid shipping (decision 9) needs its own listing flag so the
-- item page can say "Free shipping" and checkout (S3, after the porch-places restatement lands) charges the buyer $0
-- shipping and takes the label from the seller's payout.
--
-- What:
--   1. declutter_items.seller_pays_shipping (default false), only with a preset (CHECK).
--   2. declutter_set_ship_options(item, preset, seller_pays): the seller's own listing (draft, in review, live or
--      paused), small and priced only, behind declutter + declutter_shipping; turning shipping ON is a selling
--      choice (declutter_assert_member), turning it OFF never is (as declutter_set_auto_free). A NULL preset turns
--      shipping off and clears seller-paid.
--   3. declutter_ship_options_state(item): the seller's own listing's preset and seller-paid flag.
--   4. Shipping follows the listing: when an edit makes it not small, or it becomes free (a $0 price, e.g. "Free on
--      day 12"), its preset and seller-paid flag are cleared in the same update, so no edit ever trips the
--      small-only CHECK (20261030012052) and a free item is never offered for shipping.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, CREATE OR REPLACE; grants by role name
-- (REVOKE ... FROM PUBLIC, anon). Proof: src/test/pglite/shippingS3ListingOptions.pglite.mjs (3x replay).

ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_pays_shipping boolean NOT NULL DEFAULT false;
ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_seller_pays_needs_preset;
ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_seller_pays_needs_preset
  CHECK (NOT seller_pays_shipping OR ship_preset IS NOT NULL);
COMMENT ON COLUMN public.declutter_items.seller_pays_shipping IS
  'Shipping decision 9 (owner 2026-10-29): the seller pays the label; the buyer sees Free shipping and pays $0 '
  'shipping; the label comes out of the seller''s payout, bought only when it fits. Set only by declutter_set_ship_options.';

CREATE OR REPLACE FUNCTION public.declutter_set_ship_options(p_item_id uuid, p_preset text, p_seller_pays boolean)
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
  IF p_seller_pays IS NULL OR (p_preset IS NOT NULL AND p_preset NOT IN ('envelope', 'small_box', 'medium_box', 'large_box'))
     OR (p_preset IS NULL AND p_seller_pays) THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF p_preset IS NOT NULL AND v_item.delivery_size <> 'small' THEN
    RAISE EXCEPTION 'ship_small_only' USING ERRCODE = '22023', HINT = 'Only small items can ship.';
  END IF;
  IF p_preset IS NOT NULL AND v_item.current_price_cents = 0 THEN
    RAISE EXCEPTION 'ship_not_free_items' USING ERRCODE = '22023', HINT = 'Free items are picked up, not shipped.';
  END IF;
  UPDATE public.declutter_items
     SET ship_preset = p_preset, seller_pays_shipping = p_seller_pays
   WHERE id = p_item_id;
  RETURN jsonb_build_object('preset', p_preset, 'seller_pays', p_seller_pays);
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
  SELECT jsonb_build_object('preset', i.ship_preset, 'seller_pays', i.seller_pays_shipping) INTO v_out
    FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid;
  IF v_out IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
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
  IF NEW.ship_preset IS NOT NULL AND (NEW.delivery_size IS DISTINCT FROM 'small' OR NEW.current_price_cents = 0) THEN
    NEW.ship_preset := NULL;
    NEW.seller_pays_shipping := false;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_ship_follows_listing() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_items_ship_follows_listing ON public.declutter_items;
CREATE TRIGGER trg_declutter_items_ship_follows_listing BEFORE UPDATE OF delivery_size, current_price_cents ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_items_ship_follows_listing();
