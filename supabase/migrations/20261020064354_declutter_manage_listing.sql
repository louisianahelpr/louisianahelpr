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
--                                           becomes p_price_cents, never above
--                                           price_cents (the price it was listed
--                                           at, the struck-through "was" price,
--                                           which never changes). Changing the
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
  -- Never above the price it was listed at (authz review 2): raising then cutting
  -- would put a "was" price on the card the item was never really offered at.
  IF p_price_cents > v_item.price_cents THEN
    RAISE EXCEPTION 'price_above_listed'
      USING ERRCODE = '22023', HINT = 'You can lower the price, or raise it back up to the price you listed it at.';
  END IF;
  IF p_floor_price_cents IS NULL OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;

  SELECT p.drops_stopped INTO v_stopped FROM public.declutter_item_private p WHERE p.item_id = p_item_id;

  UPDATE public.declutter_items
     SET current_price_cents = p_price_cents,
         updated_at = now()
   WHERE id = p_item_id;

  -- A floor change re-picks the stop (trg_declutter_item_private_drop_stop).
  UPDATE public.declutter_item_private
     SET floor_price_cents = p_floor_price_cents, updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Prod CHECK declutter_item_private_stop_above_floor: stop > floor. A stop one
  -- cent above a price that sits at the floor still means "never drop" (the
  -- sweep drops only while current > greatest(floor, stop)). Money review 2.
  IF COALESCE(v_stopped, false) THEN
    UPDATE public.declutter_item_private
       SET drop_stop_cents = greatest(p_price_cents, p_floor_price_cents + 1), updated_at = now()
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
     SET drop_stop_cents = CASE WHEN p_on THEN NULL ELSE greatest(v_item.current_price_cents, floor_price_cents + 1) END,
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
  -- Publish's own checks (authz review 7): payouts still set up, a pickup time on file.
  IF public.helper_award_block_reason(v_uid) IS NOT NULL THEN
    RAISE EXCEPTION 'payout_setup_incomplete'
      USING ERRCODE = '42501', HINT = 'Finish your payout setup before you list an item.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = v_uid) THEN
    RAISE EXCEPTION 'pickup_windows_required' USING ERRCODE = '22023';
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

-- ---------------------------------------------------------------------------
-- Authz review (2026-10-20) 1, 3: functions with a status list that must now
-- know 'paused'. Each body is prod's (pg_get_functiondef, 2026-10-20) verbatim
-- except the marked change.

-- 1 (must-fix): a paused listing can be taken down (Delete / Mark sold
-- elsewhere), even by a seller who can no longer relist (3 strikes, under 18).
CREATE OR REPLACE FUNCTION public.declutter_withdraw_item(p_item_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
  v_paths text[];
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Not the selling gate on purpose: an under-18 or struck member may still
  -- take their own listing down.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- rejected / removed / ended: off sale already, but their photos were
  -- still attached and public by URL (lh-authz-rls review should-fix 2), so
  -- they may be detached too. Reserved / sold / completed are not the
  -- seller's to pull (later slices). 'paused' (board 158) is the seller's own.
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused', 'rejected', 'removed', 'ended') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  -- B46: the listing's open offers close now (buyers told, nothing charged)
  -- instead of later reading "the seller did not answer".
  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item taken down',
      format('The seller took "%s" down, so your offer is closed. Nothing was charged.', v_item.title),
      '/declutter?view=offers', v_uid);
  END LOOP;

  SELECT COALESCE(array_agg(storage_path ORDER BY position), ARRAY[]::text[]) INTO v_paths
    FROM public.declutter_item_photos WHERE item_id = p_item_id;

  IF v_item.status = 'draft' THEN
    DELETE FROM public.declutter_items WHERE id = p_item_id;
  ELSE
    DELETE FROM public.declutter_item_photos WHERE item_id = p_item_id;
    DELETE FROM public.declutter_watchlist WHERE item_id = p_item_id;
    UPDATE public.declutter_items
       SET status = CASE WHEN v_item.status IN ('pending_review', 'live', 'paused') THEN 'withdrawn' ELSE v_item.status END,
           updated_at = now()
     WHERE id = p_item_id;
  END IF;
  RETURN v_paths;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_withdraw_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_item(uuid) TO authenticated, service_role;

-- 3: a paused item is still part of its seller's moving sale (ending the sale
-- or moving its date reaches it; the client's DeclutterMoveView already counts it).
CREATE OR REPLACE FUNCTION public.declutter_my_move_out_date()
 RETURNS date
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_moving_out');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT max(p.move_out_on)
      FROM public.declutter_items i
      JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE i.seller_id = v_uid AND p.seller_id = v_uid
       AND i.in_moving_sale
       AND i.status IN ('draft', 'pending_review', 'live', 'paused', 'reserved'));
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_my_move_out_date() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_move_out_date() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_move_out_date(p_move_out_on date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_n integer;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_moving_out');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_move_out_on IS NOT NULL THEN
    PERFORM public.declutter_assert_member(true);
    IF public.declutter_move_out_date_problem(p_move_out_on) IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_move_out_date'
        USING ERRCODE = '22023', HINT = 'Pick a move-out date from today to 6 months from now.';
    END IF;
    UPDATE public.declutter_item_private p
       SET move_out_on = p_move_out_on, updated_at = now()
      FROM public.declutter_items i
     WHERE i.id = p.item_id
       AND i.seller_id = v_uid AND p.seller_id = v_uid
       AND i.in_moving_sale
       AND i.status IN ('draft', 'pending_review', 'live', 'paused', 'reserved');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END IF;

  UPDATE public.declutter_items
     SET in_moving_sale = false, updated_at = now()
   WHERE seller_id = v_uid
     AND in_moving_sale
     AND status IN ('draft', 'pending_review', 'live', 'paused', 'reserved');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_set_move_out_date(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_move_out_date(date) TO authenticated, service_role;

-- Money review 4 (2026-10-20): a checkout paid in time but recorded late (B41)
-- finds its item back on sale. If the seller PAUSED it in that window, it is
-- still unsold: the late payment sells it (as for 'live') instead of reading
-- 'sold_elsewhere', which refunds with the company absorbing the card fee.
-- Body = 20261017060455_declutter_seller_out_pays_fee.sql's, which matches prod
-- (md5(prosrc) 2fbbbf242bac07c9cc0da48316068540, 2026-10-20), with exactly two
-- changes: the items-ok test and the 'sold' update accept 'paused' too.
CREATE OR REPLACE FUNCTION public.declutter_mark_order_paid(p_order_id uuid, p_payment_intent_id text, p_amount_cents integer,
  p_paid_at timestamptz, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_lines integer;
  v_live integer;
  v_deadline timestamptz;
  v_refund uuid;
  v_reason text;
  v_honour boolean := false;
  v_found boolean;
  r record;
  v_void record;
  v_cant boolean;
  v_items_ok boolean;
  v_sale_ok boolean;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;

  -- Lock order: items -> order -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  v_found := FOUND;
  -- A payment already answered with a refund keeps that answer (replays).
  SELECT r2.id INTO v_refund FROM public.declutter_refunds r2 WHERE r2.stripe_payment_intent_id = p_payment_intent_id;
  IF v_refund IS NOT NULL THEN
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  IF NOT v_found THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(NULL, p_payment_intent_id, 'order_missing', p_amount_cents, p_card_fee_cents));
  END IF;
  IF o.status IN ('paid', 'refunded') THEN
    IF o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id THEN
      RETURN jsonb_build_object('result', 'already_paid');
    END IF;
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'duplicate_payment', p_amount_cents, p_card_fee_cents));
  END IF;
  IF p_amount_cents IS DISTINCT FROM o.total_cents THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'amount_mismatch', p_amount_cents, p_card_fee_cents));
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.order_id = p_order_id ORDER BY c.item_id FOR UPDATE;
  SELECT min(c.checkout_by) INTO v_deadline FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Read once (lh-money-escrow review of 1da32feffe #3): can the seller sell.
  v_cant := public.declutter_seller_out(o.seller_id);

  IF o.status = 'superseded' THEN
    -- B40 (lh-money-escrow review 3b #2): the app expires the old page BEFORE
    -- a restarted checkout can replace it, and refuses to replace a page that
    -- was already paid, so a payment on an order the BUYER restarted means
    -- they went around the app: their own doing, the card fee is kept. A page
    -- that Stripe itself timed out ('session_expired') cannot take a payment;
    -- if one lands anyway, that is ours.
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id,
        CASE WHEN o.close_reason = 'superseded' THEN 'buyer_restarted_checkout' ELSE 'superseded' END,
        p_amount_cents, p_card_fee_cents));
  END IF;

  IF o.status = 'expired' THEN
    IF o.close_reason IN ('seller_cancelled', 'seller_blocked') THEN
      -- Row 60: the seller backed out of a sale the buyer paid for. Paid before
      -- the cancel, or after it on a page the cancel should have closed (the
      -- app expires it; a seller who cancels around the app leaves it open):
      -- either way the seller caused it and pays the card fee (lh-money-escrow
      -- review 3b #5).
      v_reason := 'seller_backed_out';
    ELSIF o.close_reason = 'seller_out' THEN
      -- Owner 2026-10-17 (answer 7): the deadline sweep closed this checkout
      -- because the seller could no longer sell (banned, suspended, 3 Declutter
      -- strikes, an under-18 birthday or flagged business-like), and the buyer
      -- paid anyway: every cent back, and the card fee is the SELLER's debt.
      v_reason := 'seller_out';
    ELSIF o.close_reason = 'missed_checkout' AND v_deadline IS NOT NULL
          AND p_paid_at <= v_deadline + interval '1 hour' THEN
      -- B41: paid in time, recorded late. The strike goes; the sale stands if
      -- every item is still unsold and the seller can still sell to them.
      UPDATE public.declutter_strikes s
         SET removed_at = now()
       WHERE s.cart_line_id IN (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
         AND s.reason = 'missed_checkout' AND s.removed_at IS NULL;
      SELECT count(*), count(*) FILTER (WHERE c.status = 'missed') INTO v_lines, v_live
        FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
      -- The items part apart from the blocks part (lh-money-escrow review of
      -- 905501cb2 #1): whether the seller being out is the one thing that
      -- stops the sale is judged on the items alone, as path (c) does.
      v_items_ok := v_lines > 0 AND v_live = v_lines
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                         WHERE c.order_id = p_order_id AND i.status NOT IN ('live', 'paused'))
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_cart_items c2 ON c2.item_id = c.item_id AND c2.id <> c.id
                         WHERE c.order_id = p_order_id AND c2.status IN ('in_cart', 'paid'));
      v_sale_ok := v_items_ok
        AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                         WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                            OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id));
      v_honour := v_sale_ok AND NOT v_cant;
      IF NOT v_honour THEN
        PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your strike was removed',
          'You paid in time, so the missed-checkout strike is gone. The item is no longer available, so every cent is coming back to your card.',
          '/declutter?view=cart', o.seller_id);
        -- Owner 2026-10-17 (answer 7): when the seller being out is the ONLY
        -- thing that stops the sale, the seller (not us) owes the card fee; the
        -- buyer still gets every cent. An item that went elsewhere is ours.
        -- As in path (c): a seller who is out wins over a BUYER who blocked
        -- them; a seller who blocked the buyer is left as before (filed in docs/OPEN.md).
        v_reason := CASE WHEN v_items_ok AND v_cant
                               AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                                                WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                         THEN 'seller_out' ELSE 'sold_elsewhere' END;
        v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
        IF v_reason = 'seller_out' THEN
          PERFORM public.declutter_seller_out_fee_notice(v_refund);
        END IF;
        RETURN public.declutter_refund_answer(v_refund);
      END IF;
      -- Straight to PAID (lh-money-escrow review 3b #1: never back through
      -- 'awaiting_payment', which a newer open order for the same pair would
      -- refuse on declutter_orders_one_awaiting). Each item comes off sale
      -- again; its open offers close and their buyers are told.
      FOR r IN SELECT c.item_id, i.title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                WHERE c.order_id = p_order_id ORDER BY c.item_id LOOP
        UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status IN ('live', 'paused');
        FOR v_void IN
          UPDATE public.declutter_offers SET status = 'voided', closed_at = now(), updated_at = now()
           WHERE item_id = r.item_id AND status = 'open'
          RETURNING id, buyer_id
        LOOP
          INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (v_void.id, 'system', 'void');
          PERFORM public.declutter_notify(v_void.buyer_id, 'new_offers', 'Item no longer available',
            format('"%s" went to another buyer, so your offer is closed. Nothing was charged.', r.title),
            '/declutter/item/' || r.item_id::text, o.seller_id);
        END LOOP;
      END LOOP;
      UPDATE public.declutter_cart_items SET status = 'paid', closed_at = now()
       WHERE order_id = p_order_id AND status = 'missed';
      UPDATE public.declutter_orders
         SET status = 'paid', close_reason = NULL, closed_at = NULL, paid_at = now(), stripe_paid_at = p_paid_at,
             stripe_payment_intent_id = p_payment_intent_id,
             card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
       WHERE id = p_order_id AND status = 'expired';
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
        format('You paid $%s in time, so the sale stands and there is no strike. Next: pick up your items at the time you chose.',
               to_char(o.total_cents / 100.0, 'FM999990.00')),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
        format('The buyer paid for $%s of your items in time after all, so the sale stands. You get paid when the buyer has them.',
               to_char(o.items_cents / 100.0, 'FM999990.00')),
        '/declutter?view=offers', o.buyer_id);
      RETURN jsonb_build_object('result', 'paid');
    ELSE
      v_reason := 'order_closed';
    END IF;
    IF v_reason IS NOT NULL THEN
      v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
      IF v_reason = 'seller_out' THEN
        PERFORM public.declutter_seller_out_fee_notice(v_refund);
      END IF;
      RETURN public.declutter_refund_answer(v_refund);
    END IF;
  END IF;

  IF o.status <> 'awaiting_payment' THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'order_closed', p_amount_cents, p_card_fee_cents));
  END IF;
  SELECT count(*), count(*) FILTER (WHERE c.status = 'in_cart') INTO v_lines, v_live
    FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Every line must still be in the cart, every item still reserved, and the
  -- seller still able to sell to this buyer.
  v_items_ok := v_lines > 0 AND v_live = v_lines
     AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                      WHERE c.order_id = p_order_id AND i.status <> 'reserved');
  IF NOT v_items_ok
     OR v_cant
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                    OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)) THEN
    -- Who made it unpayable decides who bears the card fee (lh-authz-rls
    -- review 3b #1): a seller who blocked the buyer backed out (row 60); a
    -- BUYER who blocked the seller cancelled it themselves, so the card fee is
    -- kept (owner: never absorb a fee; otherwise blocking would be a free way to
    -- make us pay it); anything else is ours.
    v_reason := CASE WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                     THEN 'seller_backed_out'
                     -- Owner 2026-10-17 (answer 7): a seller who can no longer
                     -- sell owes the card fee and the buyer gets every cent,
                     -- even if the buyer also blocked them; only when the
                     -- sale was otherwise still whole.
                     WHEN v_cant AND v_items_ok THEN 'seller_out'
                     WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)
                     THEN 'buyer_cancelled'
                     ELSE 'order_closed' END;
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now() WHERE id = p_order_id;
    UPDATE public.declutter_cart_items SET order_id = NULL WHERE order_id = p_order_id AND status = 'in_cart';
    v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
    IF v_reason = 'seller_out' THEN
      PERFORM public.declutter_seller_out_fee_notice(v_refund);
    END IF;
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  UPDATE public.declutter_orders
     SET status = 'paid', paid_at = now(), stripe_paid_at = p_paid_at, stripe_payment_intent_id = p_payment_intent_id,
         card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
   WHERE id = p_order_id AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = p_order_id AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now()
     WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
    format('You paid $%s. Next: pick up your items at the time you chose.', to_char(o.total_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid for $%s of your items. You get paid when the buyer has them.', to_char(o.items_cents / 100.0, 'FM999990.00')),
    '/declutter?view=offers', o.buyer_id);
  RETURN jsonb_build_object('result', 'paid');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) TO service_role;
