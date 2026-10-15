-- DECLUTTER: the buyer's fee becomes 5% of the item total + 70 cents (owner
-- decision F1, docs/specs/louisiana-hub-roadmap.md, 2026-10-14: "match
-- Vinted's usually 5% + $0.70", card cost INCLUDED in it). Supersedes spec rows
-- 20-21 (15% of the items, at least $1). Still one fee per seller checkout
-- (row 38): the 70 cents is charged once per order, however many items.
--
-- The fee can never lose money on a US card: Stripe keeps 2.9% + 30c of the
-- TOTAL charge, so the platform nets
--   (0.05 i + 70) - (0.029 (1.05 i + 70) + 30) = 0.01955 i + 37.97 cents
-- which is positive for every item total i >= 0 (a $1 item nets ~40c; checked
-- for every whole-dollar total $1-$10,000 by src/lib/declutter/money.test.ts).
-- So no minimum is added (owner chose Vinted's rate; none was asked for).
-- SCOPE of "never loses money": a US card at Stripe's standard 2.9% + 30c, NOT
-- international/currency-conversion surcharges, and NOT Connect payout costs
-- (per-payout / active-account fees are paid when the seller is paid, slice 4,
-- and are not modelled here). declutter-checkout sets no Stripe automatic_tax
-- (every line is NONTAXABLE_TAX_CODE and it refuses a session whose
-- amount_total differs from total_cents), so no Stripe Tax fee rides on it.
--
-- Measured 2026-10-15 on prod (fncmgoasalhdgfwzhsqa): to_regclass('public.declutter_orders')
-- is NULL (slice 3b has not deployed), so NO prod row is 'premium15'; the column and
-- rule exist so the migration is correct whatever order the slices land in.
-- Orders ALREADY frozen under the old rule keep their number (the buyer saw it;
-- money is never silently rewritten): a fee_rule column marks them
-- 'premium15', every new order is 'f1' (forced by a trigger, so no caller can
-- pick the old rule), and the table CHECK holds each row to its own rule.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS. Applied 3x by
-- src/test/pglite/declutterFeeF1.pglite.mjs (and scripts/declutter/race-accept.mjs).

-- 1. The fee rule column. Rows that exist when this first runs are the old rule.
ALTER TABLE public.declutter_orders
  ADD COLUMN IF NOT EXISTS fee_rule text NOT NULL DEFAULT 'premium15';
ALTER TABLE public.declutter_orders ALTER COLUMN fee_rule SET DEFAULT 'f1';

DO $do$
BEGIN
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_premium_rule;
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_premium_cents_check;
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_fee_rule;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_fee_rule CHECK (fee_rule IN ('premium15', 'f1'));
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_premium_cents_check CHECK (premium_cents >= 70);
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_premium_rule CHECK (
    (fee_rule = 'f1' AND premium_cents = round(items_cents * 0.05)::integer + 70)
    OR (fee_rule = 'premium15' AND premium_cents = greatest(round(items_cents * 0.15)::integer, 100)));
END
$do$;

-- Every NEW order is on F1, whatever a caller passes.
CREATE OR REPLACE FUNCTION public.declutter_orders_fee_rule_f1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.fee_rule := 'f1';
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_fee_rule_f1() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_orders_fee_rule_f1 ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_fee_rule_f1 BEFORE INSERT ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_orders_fee_rule_f1();
-- The rule is fixed for a row's life (an UPDATE cannot move an order to the other rule).
CREATE OR REPLACE FUNCTION public.declutter_orders_fee_rule_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.fee_rule IS DISTINCT FROM OLD.fee_rule OR NEW.premium_cents IS DISTINCT FROM OLD.premium_cents
     OR NEW.items_cents IS DISTINCT FROM OLD.items_cents OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     -- tax_cents too (money review 1.1): the total CHECK already ties it to the three frozen
     -- amounts, but the freeze names every amount the buyer was shown, so no later CHECK
     -- change can make the tax line the one number a writer may move.
     OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents THEN
    RAISE EXCEPTION 'order_amounts_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_fee_rule_frozen() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_orders_amounts_frozen ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_amounts_frozen BEFORE UPDATE ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_orders_fee_rule_frozen();

-- 2. The one place the fee is computed (checkout below; the app's preview is
--    src/lib/declutter/money.ts and must agree).
CREATE OR REPLACE FUNCTION public.declutter_buyer_fee_cents(p_items_cents integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT round(greatest(COALESCE(p_items_cents, 0), 0) * 0.05)::integer + 70;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_buyer_fee_cents(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_buyer_fee_cents(integer) TO authenticated, service_role;

-- 3. Checkout, restated from 20261014224914 with the one fee line changed.
CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text)
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
BEGIN
  -- Row 62 (B44): no require_feature here. Nothing NEW can start without the
  -- switch (offer, Buy and accept all require it); a line already in the cart
  -- is a sale already agreed, and checkout below needs one.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN
    -- Row 24's third option, Helpr delivery, is slice 5 (row 63).
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Choose pickup at the seller''s home or porch pickup. Helpr delivery is coming later.';
  END IF;

  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.handover, o.stripe_checkout_session_id, o.items_cents, o.premium_cents, o.tax_cents, o.total_cents,
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
  -- B33 tax hook: a business-like seller's sale is never taken untaxed.
  IF EXISTS (SELECT 1 FROM public.declutter_seller_flags f
              WHERE f.user_id = p_seller_id AND f.business_like) THEN
    RAISE EXCEPTION 'seller_tax_not_ready' USING ERRCODE = '55000',
      HINT = 'Checkout for this seller is not available yet.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent (money review #3): the same lines and the same handover return
  -- the order already open, and its Stripe session for the app to reuse.
  IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover AND v_existing.lines = v_lines THEN
    RETURN QUERY SELECT v_existing.id, v_existing.items_cents, v_existing.premium_cents, v_existing.tax_cents,
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
    v_old_session := v_existing.stripe_checkout_session_id;
  END IF;

  -- F1: 5% of the item total + 70c, once per checkout (card cost inside it).
  v_premium := public.declutter_buyer_fee_cents(v_items);
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents, total_cents)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_items + v_premium)
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order
   WHERE c.id = ANY (v_lines);

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium, v_old_session, NULL::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text) TO authenticated, service_role;
