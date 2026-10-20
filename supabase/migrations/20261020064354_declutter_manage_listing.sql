-- Declutter board 158 (2026-10-20): "Manage a listing" for the seller of a live
-- listing, and Paused -> Relist.
--
-- Before this migration a seller could only take a live listing down
-- (declutter_withdraw_item), which DELETES its photos and watchers: there was
-- no way to change the price or the lowest price of a live listing, to stop the
-- nightly 5% drops, or to hide a listing for a while and bring it back.
--
-- New:
--   status 'paused'                         hidden from buyers (the read policy
--                                           shows only 'live'/'reserved' to
--                                           anyone but the seller), photos and
--                                           watchers kept. Nothing can buy,
--                                           offer on, watch or ask about it:
--                                           every one of those RPCs requires
--                                           'live' (checked live 2026-10-20).
--   declutter_set_listing_price(item, price, floor)
--                                           live/paused only. The price shown
--                                           becomes p_price_cents; price_cents
--                                           (the struck-through "was" price) only
--                                           ever rises to it, so lowering keeps
--                                           the original visible. Changing the
--                                           floor re-picks the private drop stop
--                                           (the existing trigger); stopped drops
--                                           stay stopped at the new price.
--   declutter_set_listing_drops(item, on)   off = the drop stop is set to the
--                                           current price, so the sweep's
--                                           "current > greatest(floor, stop)"
--                                           test is false and nothing drops;
--                                           on = the stop is cleared and the
--                                           existing trigger picks a new one
--                                           (2-8% above the floor, never shown).
--   declutter_pause_listing(item)           live -> paused; open offers close
--                                           now with "Nothing was charged".
--   declutter_relist_listing(item)          paused -> live, under the selling
--                                           gate (strikes, under 18, banned).
--   declutter_listing_manage_state(item)    the seller's floor and whether THEY
--                                           stopped the drops (the new private
--                                           drops_stopped flag; never the stop).
--
-- Not built here (no server support yet; the sheet hides them): editing the
-- text of a live listing (it would have to clear the AI check and the four tax
-- confirmations, B19), and relisting a SOLD item as a copy.
--
-- Gates follow the Declutter header (20261014193955): every RPC needs the
-- switch, a signed-in caller who is not banned, and the item to be theirs
-- (P0002 otherwise: a stranger is never told it exists). Pausing is "taking it
-- down" like withdraw, so it skips the selling gate; changing the price and
-- relisting put it on sale and pass declutter_assert_member(true).
--
-- Replay-safe: DROP CONSTRAINT IF EXISTS before the re-add, CREATE OR REPLACE,
-- grants restated by role name. Applied 3x in PGlite.

-- The seller's own choice, kept apart from the stop itself: the stop is private
-- even from the seller (B42), so "drops stopped" must not be inferred from it.
ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS drops_stopped boolean NOT NULL DEFAULT false;

ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_status_check;
ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_status_check CHECK (status IN (
  'draft', 'pending_review', 'live', 'paused', 'reserved', 'sold', 'completed',
  'ended', 'withdrawn', 'rejected', 'removed'
));

CREATE OR REPLACE FUNCTION public.declutter_set_listing_price(
  p_item_id uuid, p_price_cents integer, p_floor_price_cents integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_stopped boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF p_price_cents IS NULL OR p_price_cents < 100 OR p_price_cents > 100000 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023', HINT = 'The price must be between $1 and $1,000.';
  END IF;
  IF p_floor_price_cents IS NULL OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;

  SELECT p.drops_stopped INTO v_stopped FROM public.declutter_item_private p WHERE p.item_id = p_item_id;

  UPDATE public.declutter_items
     SET current_price_cents = p_price_cents,
         price_cents = greatest(price_cents, p_price_cents),
         updated_at = now()
   WHERE id = p_item_id;

  -- A floor change re-picks the stop (trg_declutter_item_private_drop_stop).
  UPDATE public.declutter_item_private
     SET floor_price_cents = p_floor_price_cents, updated_at = now()
   WHERE item_id = p_item_id;
  IF COALESCE(v_stopped, false) THEN
    UPDATE public.declutter_item_private
       SET drop_stop_cents = p_price_cents, updated_at = now()
     WHERE item_id = p_item_id;
  END IF;
  RETURN p_price_cents;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_listing_price(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_listing_price(uuid, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_listing_drops(p_item_id uuid, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  -- NULL makes the trigger pick a fresh stop above the floor.
  UPDATE public.declutter_item_private
     SET drop_stop_cents = CASE WHEN p_on THEN NULL ELSE v_item.current_price_cents END,
         drops_stopped = NOT p_on,
         updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_on;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_listing_drops(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_listing_drops(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_pause_listing(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Not the selling gate on purpose (as withdraw): anyone may hide their own listing.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  -- Open offers close now (as withdraw, B46): the buyer is told, nothing charged.
  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item paused',
      format('The seller paused "%s", so your offer is closed. Nothing was charged.', v_item.title),
      '/declutter?view=offers', v_uid);
  END LOOP;

  UPDATE public.declutter_items SET status = 'paused', updated_at = now() WHERE id = p_item_id;
  RETURN 'paused';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pause_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_pause_listing(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_relist_listing(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status <> 'paused' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = p_item_id;
  RETURN 'live';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_relist_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_relist_listing(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_listing_manage_state(p_item_id uuid)
RETURNS TABLE(floor_price_cents integer, drops_stopped boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT p.floor_price_cents, p.drops_stopped
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_listing_manage_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_listing_manage_state(uuid) TO authenticated, service_role;
