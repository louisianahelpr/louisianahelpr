-- DECLUTTER: THE FREE SECTION (owner request 2026-10-27, for the launch on 2026-10-28; lead decisions).
--
-- 1. A seller can list an item as FREE: price_cents = 0 and current_price_cents = 0, a 0 floor (so no
--    price drops: the sweep drops only while the price is above the floor), no offers (an offer must be
--    below the price), no price hint (the app does not ask for one). The price CHECKs allow 0 or $1-$1,000,
--    never 1-99 cents; a free item stays free (price and current price are both 0 or both not).
-- 2. Claiming: declutter_claim_free reserves the item to the buyer exactly as a purchase does (the same
--    reserved status and 48-hour rule, through declutter_take_item), with no card asked, and at most 3 open
--    free claims per buyer. declutter_buy_now refuses a free item (it is claimed, never bought).
-- 3. An order whose items total $0 never opens a payment page: declutter_start_checkout refuses it
--    ('free_order') and declutter_checkout_free takes it: no buyer's fee, no setup fee, nothing charged,
--    paid_with 'free' (fee rule 'free'), straight to paid-equivalent; the existing handover RPCs take it
--    from there. No payout row is ever written for it (declutter_complete_handover) and the seller is never
--    asked to set up payouts for a free item: listing never asks (20261027163240, payout setup only when
--    money is owed), and a free order is never money owed (payout_setup_hire_allowed skips it, so a giver and
--    a friend "claiming" cannot open a payout account). A missed pickup closes it with the existing strike
--    rules and no refund (declutter_close_paid_order).
-- 4. Free orders at launch: pickup at the seller's home or porch pickup only. A cart mixing free and paid
--    lines from one seller checks out normally: the free lines are $0 and the fee is on the paid total.
--
-- Restated, each from its NEWEST definition:
--   declutter_orders_fee_rule_f1     20261027153244
--   declutter_create_item            20261014200728
--   declutter_update_draft           20261014200728
--   payout_setup_hire_allowed        20261027163240
--   declutter_setup_fee_before_list  20261026154738
--   declutter_buy_now                20261014210518
--   declutter_take_item              20261020033623
--   declutter_start_checkout         20261027153244
--   declutter_close_paid_order       20261017055505
--   declutter_complete_handover      20261027153244
--   CHECKs declutter_items_price_cap / _current_price_cap 20261014230342, declutter_item_private_floor_cap
--   20261014230342, declutter_cart_items_price_cap 20261014230342, declutter_orders_items_cents_check
--   (20261014210518, auto-named), declutter_orders_premium_cents_check 20261015023613,
--   declutter_orders_fee_rule / _premium_rule 20261027153244.
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS. Grants by role name, REVOKE ... FROM
-- PUBLIC, anon. Applied 3x by src/test/pglite/declutterFreeSection.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 1. The rules (one place).
CREATE OR REPLACE FUNCTION public.declutter_free_rules()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'max_open_claims', 3,                          -- lead 2026-10-27: free items a buyer may hold at once
    'handovers', jsonb_build_array('pickup_home', 'porch'));  -- lead 2026-10-27: pickup only at launch
$fn$;
REVOKE ALL ON FUNCTION public.declutter_free_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_free_rules() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Data: $0 items, $0 cart lines, the free order.
-- DESTRUCTIVE-DDL-ACK: declutter_items_price_cap, declutter_items_current_price_cap,
-- declutter_item_private_floor_cap, declutter_cart_items_price_cap, declutter_orders_items_cents_check,
-- declutter_orders_premium_cents_check, declutter_orders_fee_rule, declutter_orders_premium_rule
-- ACK-REASON: each CHECK is dropped only to be re-added in the same block allowing exactly one more case
--   (a free item, line or order at $0); every existing row (all priced $1-$1,000, every order on a card
--   fee rule) satisfies the new CHECK.
-- ACK-DATA-LOSS: none; no column, table or row is dropped.
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS paid_with text NOT NULL DEFAULT 'card';
DO $do$
BEGIN
  ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_price_cap;
  ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_price_cap
    CHECK (price_cents = 0 OR price_cents BETWEEN 100 AND 100000);
  ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_current_price_cap;
  ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_current_price_cap
    CHECK (current_price_cents = 0 OR current_price_cents BETWEEN 100 AND 100000);
  -- A free item stays free, and a priced item never drops to $0.
  ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_free_whole;
  ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_free_whole
    CHECK ((price_cents = 0) = (current_price_cents = 0));
  ALTER TABLE public.declutter_item_private DROP CONSTRAINT IF EXISTS declutter_item_private_floor_cap;
  ALTER TABLE public.declutter_item_private ADD CONSTRAINT declutter_item_private_floor_cap
    CHECK (floor_price_cents = 0 OR floor_price_cents BETWEEN 100 AND 100000);
  ALTER TABLE public.declutter_cart_items DROP CONSTRAINT IF EXISTS declutter_cart_items_price_cap;
  ALTER TABLE public.declutter_cart_items ADD CONSTRAINT declutter_cart_items_price_cap
    CHECK (price_cents = 0 OR price_cents BETWEEN 100 AND 100000);
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_paid_with;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_paid_with
    CHECK (paid_with IN ('card', 'free'));
  -- A free order is $0 in every column, never a payment page, a pickup, and only rule 'free'.
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_free;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_free CHECK (
    (paid_with = 'free') = (fee_rule = 'free')
    AND (paid_with <> 'free' OR (items_cents = 0 AND premium_cents = 0 AND tax_cents = 0 AND delivery_cents = 0
         AND shipping_cents = 0 AND total_cents = 0 AND setup_fee_cents = 0 AND COALESCE(card_fee_cents, 0) = 0
         AND stripe_checkout_session_id IS NULL AND stripe_payment_intent_id IS NULL
         AND handover IN ('pickup_home', 'porch'))));
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_items_cents_check;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_items_cents_check
    CHECK (items_cents >= 100 OR paid_with = 'free');
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_premium_cents_check;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_premium_cents_check
    CHECK (premium_cents >= 70 OR paid_with = 'free');
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_fee_rule;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_fee_rule
    CHECK (fee_rule IN ('premium15', 'f1', 'f1_ship', 'f1_seller_delivery', 'free'));
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_premium_rule;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_premium_rule CHECK (
    (fee_rule = 'f1' AND shipping_cents = 0 AND premium_cents = round(items_cents * 0.05)::integer + 70)
    OR (fee_rule = 'f1_ship' AND shipping_cents > 0
        AND premium_cents = round((items_cents + shipping_cents) * 0.05)::integer + 70)
    OR (fee_rule = 'f1_seller_delivery' AND shipping_cents = 0 AND handover = 'seller_delivery'
        AND premium_cents = round((items_cents + delivery_cents) * 0.05)::integer + 70)
    OR (fee_rule = 'free' AND premium_cents = 0)
    OR (fee_rule = 'premium15' AND shipping_cents = 0
        AND premium_cents = greatest(round(items_cents * 0.15)::integer, 100)));
END
$do$;
GRANT SELECT (paid_with) ON TABLE public.declutter_orders TO authenticated;

-- Every new order's fee rule, whatever a caller passes (restated from 20261027153244).
CREATE OR REPLACE FUNCTION public.declutter_orders_fee_rule_f1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- A free claim (20261027170717) carries no fee at all: rule 'free', and only with paid_with 'free'.
  NEW.fee_rule := CASE WHEN NEW.paid_with = 'free' THEN 'free'
                       WHEN NEW.handover = 'seller_delivery' THEN 'f1_seller_delivery' ELSE 'f1' END;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_fee_rule_f1() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Listing a free item (restated from their newest definitions).
CREATE OR REPLACE FUNCTION public.declutter_create_item(
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
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  -- Free (20261027170717, owner 2026-10-27): price 0 and a 0 floor (no drops, offers or hint).
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

  INSERT INTO public.declutter_items (
    seller_id, sale_mode, status, title, description, category, condition_stars,
    delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng)
  VALUES (
    v_uid, 'offers', 'draft', btrim(p_title), COALESCE(btrim(p_description), ''), p_category,
    p_condition_stars, p_delivery_size, p_price_cents, p_price_cents, btrim(p_area_label),
    round(p_pickup_lat, 2), round(p_pickup_lng, 2))
  RETURNING id INTO v_id;

  INSERT INTO public.declutter_item_private (item_id, seller_id, floor_price_cents, pickup_address, pickup_lat, pickup_lng)
  VALUES (v_id, v_uid, p_floor_price_cents, btrim(p_pickup_address), p_pickup_lat, p_pickup_lng);

  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_create_item(text, text, text, integer, text, integer, integer, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_create_item(text, text, text, integer, text, integer, integer, text, text, numeric, numeric) TO authenticated, service_role;

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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
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

-- ---------------------------------------------------------------------------
-- 4. Claiming a free item, and never buying one.
CREATE OR REPLACE FUNCTION public.declutter_buy_now(p_item_id uuid, p_expected_price_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO v_item FROM public.declutter_lock_buyable_item(p_item_id, v_uid);
  -- The buyer agreed to the price they SAW; a drop since only helps them.
  -- A free item is claimed through declutter_claim_free (its own limit and no card), never bought.
  IF v_item.o_price_cents = 0 THEN
    RAISE EXCEPTION 'free_item_claim_it' USING ERRCODE = '22023', HINT = 'This item is free. Tap Get it free.';
  END IF;
  IF p_expected_price_cents IS NULL OR v_item.o_price_cents > p_expected_price_cents THEN
    RAISE EXCEPTION 'price_changed' USING ERRCODE = '55000', HINT = 'The price changed. Check it and try again.';
  END IF;
  RETURN public.declutter_take_item(p_item_id, v_uid, v_item.o_price_cents, 'buy', NULL);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_buy_now(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_buy_now(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_take_item(p_item_id uuid, p_buyer uuid, p_price integer, p_source text, p_offer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_seller uuid;
  v_title text;
  v_line uuid;
  v_price text := to_char(p_price / 100.0, 'FM999990.00');
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.declutter_items WHERE id = p_item_id AND is_seed)
     AND public.seed_hidden_for(p_buyer) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.declutter_items
     SET status = 'reserved', updated_at = now()
   WHERE id = p_item_id AND status = 'live'
  RETURNING seller_id, title INTO v_seller, v_title;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_available'
      USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;

  IF p_offer_id IS NOT NULL THEN
    UPDATE public.declutter_offers
       SET status = 'accepted', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND item_id = p_item_id AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'offer_not_open' USING ERRCODE = '55000';
    END IF;
  END IF;

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item no longer available',
      format('"%s" went to another buyer, so your offer is closed. Nothing was charged.', v_title),
      '/declutter/item/' || p_item_id::text, v_seller);
  END LOOP;

  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, offer_id, checkout_by)
  VALUES (p_item_id, p_buyer, v_seller, p_price, p_source, p_offer_id, now() + interval '48 hours')
  RETURNING id INTO v_line;

  IF p_price = 0 THEN
    -- A free claim (20261027170717): the same 48 hours, nothing to pay.
    PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: pick a pickup within 48 hours',
      format('"%s" is free and held for you. Choose how you''ll pick it up within 48 hours or you get a strike and it goes back up. Nothing is charged.',
             v_title),
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notify(v_seller, 'new_offers', 'Someone claimed your free item',
      format('"%s" was claimed. The buyer has 48 hours to choose a pickup.', v_title),
      '/declutter?view=offers', p_buyer);
  ELSE
  PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: check out within 48 hours',
    format('"%s" is in your cart for $%s. Check out within 48 hours or you get a strike and it goes back up for sale. Your card is not charged until you check out.',
           v_title, v_price),
    '/declutter?view=cart', v_seller);
  PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
    format('"%s" sold for $%s. The buyer has 48 hours to check out and pay.', v_title, v_price),
    '/declutter?view=offers', p_buyer);
  END IF;
  RETURN v_line;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_claim_free(p_item_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_seller uuid;
  v_price integer;
  v_status text;
  v_mode text;
  v_seed boolean;
  v_open integer;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  -- The same lock and visibility as a purchase (declutter_lock_buyable_item), but no card: nothing is charged.
  SELECT i.seller_id, i.current_price_cents, i.status, i.sale_mode, i.is_seed
    INTO v_seller, v_price, v_status, v_mode, v_seed
    FROM public.declutter_items i WHERE i.id = p_item_id FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('live', 'reserved')
     OR public.are_users_blocked(v_seller, v_uid)
     OR public.declutter_seller_out(v_seller)
     OR (v_seed AND public.seed_hidden_for(v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  IF v_mode <> 'offers' THEN
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_price <> 0 THEN
    RAISE EXCEPTION 'not_free' USING ERRCODE = '22023', HINT = 'This item is not free any more. Check its price.';
  END IF;
  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;
  -- Abuse guard (lead 2026-10-27): at most 3 open free claims per buyer: free lines still waiting in the
  -- cart, plus free pickups not done yet. A serialised count: the buyer's own advisory lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('declutter_free_claims:' || v_uid::text, 0));
  SELECT (SELECT count(*) FROM public.declutter_cart_items c
           WHERE c.buyer_id = v_uid AND c.price_cents = 0 AND c.status = 'in_cart' AND c.checkout_by > now())
       + (SELECT count(*) FROM public.declutter_cart_items c JOIN public.declutter_orders o ON o.id = c.order_id
           WHERE c.buyer_id = v_uid AND c.status = 'paid' AND o.status = 'paid' AND o.paid_with = 'free')
    INTO v_open;
  IF v_open >= (public.declutter_free_rules() ->> 'max_open_claims')::integer THEN
    RAISE EXCEPTION 'free_claim_limit' USING ERRCODE = '54000',
      HINT = 'You have 3 free items waiting. Pick those up first.';
  END IF;
  RETURN public.declutter_take_item(p_item_id, v_uid, 0, 'buy', NULL);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_claim_free(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_claim_free(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. A $0 order never opens a payment page.
CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text, p_slot_start timestamptz DEFAULT NULL,
  p_handoff text DEFAULT NULL)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text, delivery_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_items integer;
  v_premium integer;
  v_order uuid;
  v_old_session text;
  v_n integer;
  v_lines uuid[];
  v_existing record;
  v_delivery integer := 0;
  v_setup integer := 0;
  v_dropoff_key text;
  q record;
  sd record;
  v_sd_dropoff text;
  v_rules jsonb := public.declutter_seller_delivery_rules();
BEGIN
  -- Row 62 (B44): no require_feature here. Nothing NEW can start without the
  -- switch (offer, Buy and accept all require it); a line already in the cart
  -- is a sale already agreed, and checkout below needs one.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch', 'delivery', 'seller_delivery') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Choose porch pickup, pickup at the seller''s home, delivery by the seller, or Helpr delivery.';
  END IF;
  -- Slice 5: delivery is new work for a Helpr, so it needs the switch (row 62:
  -- a member the switch is off for can still finish with a pickup).
  IF p_handover = 'delivery' THEN
    PERFORM public.require_feature('declutter');
  END IF;
  -- Seller delivery is new work for the seller: both switches. The buyer says
  -- how they want it: left at the door or handed to them (owner 2026-10-22).
  IF p_handover = 'seller_delivery' THEN
    PERFORM public.require_feature('declutter');
    PERFORM public.require_feature('declutter_seller_delivery');
    IF p_handoff IS NULL OR p_handoff NOT IN ('leave', 'hand') THEN
      RAISE EXCEPTION 'invalid_handoff' USING ERRCODE = '22023',
        HINT = 'Choose "Leave it at my door" or "Hand it to me".';
    END IF;
  ELSE
    p_slot_start := NULL;
    p_handoff := NULL;
  END IF;

  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.handover, o.stripe_checkout_session_id, o.items_cents, o.premium_cents, o.tax_cents, o.total_cents,
         o.delivery_cents, o.setup_fee_cents,
         (SELECT od.dropoff_address || '|' || od.road_miles FROM public.declutter_order_deliveries od WHERE od.order_id = o.id) AS dropoff_key,
         (SELECT x.slot_start FROM public.declutter_seller_deliveries x
           WHERE x.order_id = o.id AND x.status = 'held' AND x.held_until > now()) AS held_slot,
         (SELECT x.dropoff_address FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id) AS sd_dropoff,
         ARRAY(SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'in_cart' ORDER BY c.id) AS lines
    INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  -- The caller's own cart first: an empty cart says nothing about the seller
  -- (no ban / strike / tax-flag oracle on an arbitrary id).
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  -- Only free items (20261027170717): nothing to pay, so never a payment page (no fee, no setup fee).
  -- declutter_checkout_free takes it. A cart mixing free and paid lines checks out here as usual:
  -- the free lines are $0 and the fee is on the paid total.
  IF v_items = 0 THEN
    RAISE EXCEPTION 'free_order' USING ERRCODE = '22023', HINT = 'These items are free. Choose a pickup and tap Get it free.';
  END IF;
  -- B33 tax hook: a business-like seller's sale is never taken untaxed.
  IF EXISTS (SELECT 1 FROM public.declutter_seller_flags f
              WHERE f.user_id = p_seller_id AND f.business_like) THEN
    RAISE EXCEPTION 'seller_tax_not_ready' USING ERRCODE = '55000',
      HINT = 'Checkout for this seller is not available yet.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Row 101: porch only when EVERY line's item allows it. Read from the lines
  -- this checkout groups (v_lines), under the item locks taken above. Before the
  -- idempotent return, so no open porch order is handed back either.
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked buyers to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- Slice 5: the delivery for exactly these lines, from server data only.
  IF p_handover = 'delivery' THEN
    SELECT * INTO q FROM public.declutter_delivery_compute(v_uid, p_seller_id, v_lines);
    v_delivery := q.delivery_cents;
    v_dropoff_key := q.dropoff_address || '|' || q.road_miles;
  END IF;
  -- Seller delivery: under the seller's setting-row lock (held to the end of
  -- this transaction), taken BEFORE the setting is read (lh-money-escrow review
  -- of the free-delivery change #1): a seller saving a new price or turning
  -- delivery off mid-checkout is either seen here or waits, so the order never
  -- freezes terms the seller already changed. Then the setting, items, address,
  -- range and the rate; then the slot.
  IF p_handover = 'seller_delivery' THEN
    PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = p_seller_id FOR UPDATE;
    SELECT * INTO sd FROM public.declutter_seller_delivery_check(v_uid, p_seller_id, v_lines);
    IF sd.reason = 'address_needed' THEN
      RAISE EXCEPTION 'delivery_address_needed' USING ERRCODE = '22023', HINT = 'Enter the address to deliver to.';
    ELSIF sd.reason = 'out_of_range' THEN
      RAISE EXCEPTION 'delivery_out_of_range' USING ERRCODE = '22023',
        HINT = 'This seller doesn''t deliver that far. Choose pickup or another delivery.';
    ELSIF sd.reason IS NOT NULL THEN
      RAISE EXCEPTION 'seller_delivery_unavailable' USING ERRCODE = '22023',
        HINT = 'This seller can''t deliver these items. Choose another way to get them.';
    END IF;
    IF p_slot_start IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.declutter_delivery_open_slots(p_seller_id, v_existing.id) s WHERE s = p_slot_start) THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = '22023',
        HINT = 'That delivery time was just taken or is no longer open. Pick another time.';
    END IF;
    v_delivery := sd.rate_cents;
    v_sd_dropoff := sd.dropoff_address;
  END IF;

  -- Q2352 (owner 2026-10-22, terms #9): the one-time account setup fee rides
  -- the buyer's first Declutter purchase when the account never paid it. It is
  -- frozen on the order OUTSIDE total_cents (the sale's own amount, which every
  -- refund is computed from), so a refund of the sale never returns it.
  v_setup := public.declutter_setup_fee_due_cents(v_uid);

  -- Idempotent (money review #3): the same lines and the same handover return
  -- the order already open, and its Stripe session for the app to reuse.
  -- Slice 5: and the same delivery (fee and drop-off). Seller delivery: and
  -- the same slot, still held, to the same address.
  IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover AND v_existing.lines = v_lines
     AND v_existing.delivery_cents = v_delivery
     AND v_existing.dropoff_key IS NOT DISTINCT FROM v_dropoff_key
     -- Q2352: and the same setup fee (paid elsewhere since: a fresh order without it).
     AND v_existing.setup_fee_cents = v_setup
     AND (p_handover <> 'seller_delivery'
          OR (v_existing.held_slot = p_slot_start AND v_existing.sd_dropoff IS NOT DISTINCT FROM v_sd_dropoff)) THEN
    -- lh-money-escrow review #1: an order handed back with NO page yet (the
    -- last try failed before Stripe attached one) gets a new page that lives
    -- 31 min from now, so its hold is re-armed from now too (the setting row
    -- is locked above). An order with a page keeps its hold: the page dies first.
    IF p_handover = 'seller_delivery' AND v_existing.stripe_checkout_session_id IS NULL THEN
      UPDATE public.declutter_seller_deliveries x
         SET held_until = now() + make_interval(mins => (v_rules ->> 'hold_minutes')::integer), updated_at = now()
       WHERE x.order_id = v_existing.id AND x.status = 'held' AND x.held_until > now();
    END IF;
    -- A changed door choice moves no money: it is updated on the order already open.
    IF p_handover = 'seller_delivery' THEN
      UPDATE public.declutter_seller_deliveries x SET handoff = p_handoff, updated_at = now()
       WHERE x.order_id = v_existing.id AND x.handoff IS DISTINCT FROM p_handoff;
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.items_cents, v_existing.premium_cents, v_existing.tax_cents,
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id, v_existing.delivery_cents;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
    v_old_session := v_existing.stripe_checkout_session_id;
  END IF;

  -- F1: 5% of the item total + 70c, once per checkout (card cost inside it).
  -- The Helpr delivery fee is not part of the item total (row 29 prices it
  -- alone); the seller's delivery rate is (owner 2026-10-22, the shipping rule).
  v_premium := CASE WHEN p_handover = 'seller_delivery'
                    THEN public.declutter_buyer_fee_cents_seller_delivery(v_items, v_delivery)
                    ELSE public.declutter_buyer_fee_cents(v_items) END;
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items + v_premium + v_delivery, v_setup)
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order
   WHERE c.id = ANY (v_lines);
  IF p_handover = 'delivery' THEN
    INSERT INTO public.declutter_order_deliveries (order_id, dropoff_address, dropoff_area, dropoff_lat, dropoff_lng,
                                                   road_miles, size, delivery_cents)
    VALUES (v_order, q.dropoff_address, q.dropoff_area, q.dropoff_lat, q.dropoff_lng, q.road_miles, q.size, v_delivery);
  END IF;
  IF p_handover = 'seller_delivery' THEN
    INSERT INTO public.declutter_seller_deliveries (order_id, buyer_id, seller_id, status, slot_start, slot_end, held_until,
                                                    dropoff_address, dropoff_area, dropoff_lat, dropoff_lng, handoff)
    VALUES (v_order, v_uid, p_seller_id, 'held', p_slot_start,
            p_slot_start + make_interval(mins => (v_rules ->> 'slot_minutes')::integer),
            now() + make_interval(mins => (v_rules ->> 'hold_minutes')::integer),
            sd.dropoff_address, sd.dropoff_area, sd.dropoff_lat, sd.dropoff_lng, p_handoff);
  END IF;

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium + v_delivery, v_old_session, NULL::text, v_delivery;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_checkout_free(p_seller_id uuid, p_handover text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_n integer;
  v_items integer;
  v_lines uuid[];
  v_existing record;
  v_order uuid;
  r record;
BEGIN
  -- Row 62: no require_feature (a claim is a sale already agreed), the same as declutter_start_checkout.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  -- Free pickups at launch: at the seller's home or from the porch. Delivery costs money, so not for a $0 order.
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Free items are picked up: from the porch or at the seller''s home.';
  END IF;
  -- Lock order as checkout: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.stripe_checkout_session_id INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'not_free_order' USING ERRCODE = '22023', HINT = 'Some of these items have a price. Check out to pay for them.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- An order still open on a payment page (the cart once held a paid line) is never replaced here:
  -- that page could still be paid. The buyer finishes or leaves it first (it closes in 31 minutes).
  IF v_existing.id IS NOT NULL AND v_existing.stripe_checkout_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'checkout_page_open' USING ERRCODE = '55000',
      HINT = 'A payment page for this seller is still open. Close it, then try again in a few minutes.';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
  END IF;
  -- The order: $0 everywhere, paid_with 'free' (fee rule 'free' from the trigger), never a Stripe page,
  -- no setup fee. It is paid-equivalent at once: the existing handover RPCs take it from here.
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents, paid_with)
  VALUES (v_uid, p_seller_id, p_handover, 0, 0, 0, 0, 0, 0, 'free')
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order WHERE c.id = ANY (v_lines);
  UPDATE public.declutter_orders SET status = 'paid', paid_at = now(), card_fee_cents = 0
   WHERE id = v_order AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = v_order AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  PERFORM public.declutter_notify(v_uid, 'payment', 'It''s yours',
    'Your free item is set. Next: pick it up at the time you chose. Nothing was charged.',
    '/declutter?view=cart', p_seller_id);
  PERFORM public.declutter_notify(p_seller_id, 'payment', 'Free item claimed',
    'Someone is picking up your free item. Nothing to pay and nothing to set up.',
    '/declutter?view=offers', v_uid);
  RETURN v_order;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_checkout_free(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_checkout_free(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. After the claim: no refund (nothing was paid) and no payout (nothing is owed).
CREATE OR REPLACE FUNCTION public.declutter_close_paid_order(p_order_id uuid, p_reason text, p_strike_side text,
  p_strike_reason text, p_why text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_refund uuid;
  v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out');
  r record;
  v_struck boolean := false;
  v_task public.helpr_tasks;
  v_reserved integer;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  -- A free claim (20261027170717) has no payment to refund: it closes, the strike rules still apply.
  IF o.status IS NOT DISTINCT FROM 'paid' AND o.paid_with = 'free' THEN
    UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
    FOR r IN
      UPDATE public.declutter_cart_items c
         SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
       WHERE c.order_id = o.id AND c.status = 'paid'
      RETURNING c.item_id, c.id
    LOOP
      UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
       WHERE id = r.item_id AND status = 'sold';
      IF p_strike_side IS NOT NULL AND NOT v_struck THEN
        -- The callers' words speak of refunds and card fees; a free pickup has neither.
        PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
          p_strike_side, p_strike_reason, r.item_id,
          CASE WHEN p_strike_side = 'seller' THEN 'You did not show up for a booked free Declutter pickup.'
               ELSE 'You missed a booked free Declutter pickup.' END, r.id);
        v_struck := true;
      END IF;
    END LOOP;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Free pickup cancelled',
      'This free pickup was cancelled. Nothing was charged.', '/declutter?view=cart', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Free pickup cancelled',
      CASE WHEN v_seller_fault THEN 'This free pickup was cancelled.'
           ELSE 'This free pickup was cancelled. Your item is back up.' END,
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'cancelled', 'free', true);
  END IF;
  IF o.status IS DISTINCT FROM 'paid' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = o.id) THEN
    RAISE EXCEPTION 'already_paid_out' USING ERRCODE = '55000';
  END IF;
  -- Slice 5: the order's Helpr task.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NOT NULL THEN
    IF v_task.status IN ('picked_up', 'delivered') THEN
      PERFORM public.helpr_task_confirm(v_task.id, 'admin', NULL);
    ELSIF v_task.status IN ('open', 'accepted') THEN
      PERFORM public.helpr_task_close(v_task.id, 'cancelled', p_reason);
    END IF;
  END IF;
  v_reserved := public.declutter_delivery_reserved_cents(o.id);
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents - v_reserved, o.card_fee_cents);
  UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
     WHERE c.order_id = o.id AND c.status = 'paid'
    RETURNING c.item_id, c.id
  LOOP
    UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
     WHERE id = r.item_id AND status = 'sold';
    -- One strike per order, recorded against its first line.
    IF p_strike_side IS NOT NULL AND NOT v_struck THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
        p_strike_side, p_strike_reason, r.item_id, p_why, r.id);
      v_struck := true;
    END IF;
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN v_seller_fault AND v_reserved > 0
         THEN format('$%s is coming back to your card. The delivery fee paid the Helpr who made the trip.',
                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN v_seller_fault
         THEN format('All $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault')
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card. Your buyer''s fee is not refunded.'
                          ELSE 'The item price, $%s, is coming back to your card. Your buyer''s fee is not refunded.' END,
                     to_char((o.total_cents - v_reserved - o.premium_cents) / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way. The card fee is not refunded.' END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale cancelled',
    CASE WHEN v_seller_fault THEN 'This sale was cancelled and the buyer refunded.'
         ELSE 'This sale was cancelled and the buyer refunded. Your item is back on sale.' END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_complete_handover(p_order_id uuid, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_debt integer;
  v_payout uuid;
  v_task public.helpr_tasks;
  v_task_out jsonb;
  v_rate integer;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
  END IF;
  -- Slice 5: a delivery.
  IF o.handover = 'delivery' THEN
    SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE od.order_id = o.id FOR UPDATE OF t;
    IF v_task.status IN ('picked_up', 'delivered') THEN
      v_task_out := public.helpr_task_confirm(v_task.id,
        CASE p_by WHEN 'code' THEN 'code' WHEN 'buyer' THEN 'customer' WHEN 'admin' THEN 'admin' ELSE 'auto' END, NULL);
    ELSIF v_task.status = 'confirmed' OR (p_by = 'admin' AND v_task.status = 'failed') THEN
      -- Already confirmed, or the damage decision (row 43) that failed the
      -- task itself and refunds the whole order on its own: nothing more here.
      NULL;
    ELSIF p_by = 'admin' AND (v_task.id IS NULL OR v_task.status IN ('open', 'accepted')) THEN
      IF v_task.id IS NOT NULL THEN
        PERFORM public.helpr_task_close(v_task.id, 'cancelled', 'The sale was decided without a delivery');
      END IF;
      PERFORM public.declutter_delivery_refund(o.id, 'delivery_not_done');
    ELSE
      RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
        HINT = 'The Helpr has not picked the item up yet.';
    END IF;
  END IF;
  -- Seller delivery: the rate is the seller's, paid with the items.
  v_rate := CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.declutter_handovers SET confirmed_at = now(), confirmed_by = p_by WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.declutter_orders SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'paid';
  UPDATE public.declutter_items SET status = 'completed', updated_at = now()
   WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
     AND status = 'sold';
  -- A free claim (20261027170717): no money is owed either way, so no payout row and no payout words.
  IF o.paid_with = 'free' THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
      'Your free item has a new home. Thank you for giving it away.', '/declutter?view=selling', o.buyer_id);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
      'The handover is done. Leave the giver a review.', '/declutter?view=cart', o.seller_id);
    RETURN jsonb_build_object('result', 'handed_over', 'payout_id', NULL, 'by', p_by, 'free', true);
  END IF;
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents + v_rate);
  INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, delivery_cents, debt_cents, amount_cents, status)
  VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_debt, o.items_cents + v_rate - v_debt,
          CASE WHEN o.items_cents + v_rate - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The words depend on what is due and whether the seller can be paid (lh-money-escrow review 2.1).
  -- 141d: the payout waits until the sale is final, 24 hours after the handover (an admin's decision is final at once).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    CASE
      WHEN o.items_cents + v_rate - v_debt = 0 THEN
        format('This sale paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format(CASE WHEN p_by = 'admin' THEN 'Set up payouts in Settings to get your $%s. We send it as soon as you do.'
                    ELSE 'Set up payouts in Settings to get your $%s. We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.' END,
               to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
      WHEN p_by = 'admin' THEN format('$%s is on its way to your payout account.', to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('We send your $%s once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.',
                  to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/declutter?view=selling', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
    CASE WHEN p_by = 'admin' THEN 'The handover is done and the sale is final. Leave the seller a review.'
         ELSE 'The handover is done. If something is wrong with it, you can ask the seller for a refund within 24 hours. Leave the seller a review.' END,
    '/declutter?view=cart', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'payout_id', v_payout, 'by', p_by)
         || CASE WHEN v_task_out IS NOT NULL THEN jsonb_build_object('helpr_payout_id', v_task_out->'helpr_payout_id') ELSE '{}'::jsonb END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_complete_handover(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. A free claim is never money owed (restated from 20261027163240 with only the free-order line):
--    a handed-over free order does not let the giver open a payout account. Without this, two members
--    could list and "claim" a free item to reach payout setup, the very thing the owner closed
--    (owner 2026-10-27: payout setup only when money is owed).
CREATE OR REPLACE FUNCTION public.payout_setup_hire_allowed(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_user_id IS NOT NULL AND (
       -- the Helpr on a job that holds money
       EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.helper_id = p_user_id
                  AND public.job_payment_is_funded(j.payment_status::text))
       -- a crew seat on a job that holds money
    OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                 JOIN public.jobs j ON j.id = g.job_id
                WHERE g.helper_id = p_user_id
                  AND public.job_payment_is_funded(j.payment_status::text))
       -- an accept that waits on their setup (switch off), on a job that still holds money
    OR EXISTS (SELECT 1 FROM public.job_accept_pending a
                 JOIN public.jobs j ON j.id = a.job_id
                WHERE a.helper_id = p_user_id
                  AND public.job_payment_is_funded(j.payment_status::text))
       -- a cancellation fee owed or paid to them (single or crew), a crew
       -- block fee: server-written money rows, so a poster cannot fake one
       -- (lh-authz-rls #4, lh-money-escrow #2)
    OR EXISTS (SELECT 1 FROM public.cancellation_fee_transfers c WHERE c.helper_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.crew_cancellation_fee_shares c WHERE c.helper_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.crew_block_fees c WHERE c.helper_id = p_user_id)
       -- money already recorded to them
    OR EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.helper_id = p_user_id)
       -- Owner 2026-10-27: a seller only when money is owed to them, never for
       -- a listing or a shop alone. Rentals moves no money through us, so it
       -- gives no access.
       -- a Declutter sale paid (or handed over) and holding money for them
    OR EXISTS (SELECT 1 FROM public.declutter_orders o
                WHERE o.seller_id = p_user_id AND o.status IN ('paid', 'handed_over')
                  -- a free claim (20261027170717) owes the giver nothing
                  AND o.paid_with <> 'free')
    OR EXISTS (SELECT 1 FROM public.declutter_payouts dp WHERE dp.seller_id = p_user_id)
       -- a Shops order whose card was captured and not refunded in full
    OR EXISTS (SELECT 1 FROM public.shop_orders so
                WHERE so.seller_id = p_user_id AND so.captured_at IS NOT NULL
                  AND so.status IN ('accepted', 'handed_over', 'partially_refunded'))
    OR EXISTS (SELECT 1 FROM public.shop_payouts sp JOIN public.shop_orders so ON so.id = sp.order_id
                WHERE so.seller_id = p_user_id)
       -- a Declutter delivery they took (the order behind it is paid), or its pay
    OR EXISTS (SELECT 1 FROM public.helpr_tasks ht
                WHERE ht.helpr_id = p_user_id AND ht.status IN ('accepted', 'picked_up', 'delivered', 'confirmed'))
    OR EXISTS (SELECT 1 FROM public.helpr_task_payouts hp WHERE hp.helpr_id = p_user_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.payout_setup_hire_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_setup_hire_allowed(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Listing a FREE item never charges the one-time setup fee (owner 2026-10-27: "No fee for free listings").
--    Restated from 20261026154738 (prod prosrc md5 3ceca46ff40161d5e2cb8a1878716735, 2026-10-27) with only the
--    free-item early return; the trigger trg_declutter_items_setup_fee_before_list is unchanged. A free item
--    stays free (declutter_items_free_whole), so it can never go up later without the fee: a priced listing
--    (a draft edited from free to priced, then published) still charges it.
CREATE OR REPLACE FUNCTION public.declutter_setup_fee_before_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status IN ('pending_review', 'live') AND (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'paused')) THEN
    IF public.is_server_context() OR auth.uid() IS NULL OR NEW.seller_id IS DISTINCT FROM auth.uid() THEN
      RETURN NEW;
    END IF;
    -- Admins and enrolled test accounts (is_seed AND a test_accounts row) are
    -- never asked. Spelled out here, NOT identity_check_exempt(): since
    -- 20261023213857 that is also true for every member while the ID switch is
    -- off, which would skip the setup fee at every first listing (PGlite step 10).
    IF public.has_role(auth.uid(), 'admin') OR COALESCE((
         SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
           FROM public.profiles p WHERE p.user_id = auth.uid()
       ), false) THEN
      RETURN NEW;
    END IF;
    -- A FREE item (20261027170717; owner 2026-10-27, "No fee for free listings") never charges the setup
    -- fee: it is charged once per account at the first PAID listing, purchase or job, as before.
    IF NEW.current_price_cents = 0 THEN
      RETURN NEW;
    END IF;
    IF public.declutter_setup_fee_due_cents(auth.uid()) > 0 THEN
      RAISE EXCEPTION 'setup_fee_required_to_list' USING ERRCODE = '42501',
        HINT = 'Your first listing needs the one-time account setup fee. It is charged once per account, and never again if you already paid it for Jobs.';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_setup_fee_before_list() FROM PUBLIC, anon, authenticated;

