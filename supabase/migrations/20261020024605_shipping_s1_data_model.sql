-- SHIPPING S1: the data model and the fee rule for shipped orders
-- (docs/specs/shipping-draft.md, owner decisions 2026-10-20 ~02:40Z; Q2239).
--
-- What this adds, and what it deliberately does NOT:
--   1. The `shipping` feature switch, created OFF (lead 2026-10-20).
--   2. declutter_buyer_fee_cents_ship(items, shipping) = round((items + shipping) * 0.05) + 70
--      (owner decision 2: the buyer fee counts the shipping, so the card fee on a shipped
--      order is always covered: margin = 0.01955 (items + shipping) + 37.97 cents on a US
--      card, 0.0038 (items + shipping) + 36.92 on an international one; spec 5.1).
--   3. declutter_orders.shipping_cents (default 0). The total CHECK and the amounts freeze
--      name it; the fee CHECK gains rule 'f1_ship' (only with shipping > 0) and pins the
--      existing rules to shipping = 0.
--   4. public.shipments: one row per order, ever (idempotency_key UNIQUE, money review
--      fix 7), service-role only. Holds the claim-then-buy state, the Stripe/EasyPost mode
--      (fix 8), the label cost, tracking, and the PRIVATE ship-to address (Louisiana only,
--      decision 3) and parcel.
--   NOT here (each needs its own phase, spec 9.3): the 'ship' handover value (it joins
--   declutter_orders_handover_check only together with the sweep/booking exclusions,
--   money review fix 1, S2); the insert trigger still forces fee_rule 'f1', so NO order can
--   carry shipping until S2 changes it (an insert with shipping > 0 fails the fee CHECK);
--   the fee-debt key change (fix 4, S6); no EasyPost calls (the owner opens the account, S0).
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS / ON CONFLICT DO NOTHING.
-- Applied 3x by src/test/pglite/shippingS1.pglite.mjs.

-- DESTRUCTIVE-DDL-ACK: declutter_orders_total, declutter_orders_premium_rule and declutter_orders_fee_rule
-- ACK-REASON: each CHECK is dropped only to be re-added in the same block with shipping_cents
--   in it; every existing row has shipping_cents = 0 (the column default), so each new
--   CHECK holds for every row already there.
-- ACK-DATA-LOSS: none; no column, table or row is dropped.

-- 1. The switch (off: nobody sees shipping until the owner turns it on).
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('shipping', 'off',
        'Shipping: USPS labels for Declutter (small items) and Shops, Louisiana addresses only (docs/specs/shipping-draft.md).')
ON CONFLICT (key) DO NOTHING;

-- 2. The shipped-order fee. The one place it is computed; the app's mirror is
--    src/lib/shipping/policy.ts (buyerFeeCentsShip) and must agree.
CREATE OR REPLACE FUNCTION public.declutter_buyer_fee_cents_ship(p_items_cents integer, p_shipping_cents integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT round((greatest(COALESCE(p_items_cents, 0), 0) + greatest(COALESCE(p_shipping_cents, 0), 0)) * 0.05)::integer + 70;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_buyer_fee_cents_ship(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_buyer_fee_cents_ship(integer, integer) TO authenticated, service_role;

-- 3. Orders carry the shipping the buyer was shown.
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0;
DO $do$
BEGIN
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_shipping;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_shipping CHECK (shipping_cents >= 0);
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_total;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_total
    CHECK (total_cents = items_cents + premium_cents + tax_cents + delivery_cents + shipping_cents);
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_fee_rule;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_fee_rule
    CHECK (fee_rule IN ('premium15', 'f1', 'f1_ship'));
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_premium_rule;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_premium_rule CHECK (
    (fee_rule = 'f1' AND shipping_cents = 0 AND premium_cents = round(items_cents * 0.05)::integer + 70)
    OR (fee_rule = 'f1_ship' AND shipping_cents > 0
        AND premium_cents = round((items_cents + shipping_cents) * 0.05)::integer + 70)
    OR (fee_rule = 'premium15' AND shipping_cents = 0
        AND premium_cents = greatest(round(items_cents * 0.15)::integer, 100)));
END
$do$;
GRANT SELECT (shipping_cents) ON TABLE public.declutter_orders TO authenticated;

-- The amounts freeze (restated from 20261017055505) names shipping_cents too
-- (money review fix 14). The handover rule is unchanged.
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
     OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
     -- Slice 5: the delivery fee the buyer was shown.
     OR NEW.delivery_cents IS DISTINCT FROM OLD.delivery_cents
     -- Shipping S1: the shipping the buyer was shown.
     OR NEW.shipping_cents IS DISTINCT FROM OLD.shipping_cents THEN
    RAISE EXCEPTION 'order_amounts_frozen' USING ERRCODE = '55000';
  END IF;
  -- Slice 5: the only handover change ever allowed is the no-Helpr fallback
  -- (row 40), delivery -> pickup at the seller's home, on a paid order.
  IF NEW.handover IS DISTINCT FROM OLD.handover
     AND NOT (OLD.handover = 'delivery' AND NEW.handover = 'pickup_home' AND OLD.status = 'paid') THEN
    RAISE EXCEPTION 'order_handover_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_fee_rule_frozen() FROM PUBLIC, anon, authenticated;

-- 4. Shipments. Written only by service-role edge functions (S3 label worker, S4
--    tracking webhook); no client role can read or write it (ship_to is a private
--    address; buyer and seller will read their own through definer RPCs in S2/S5).
CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The order. SET NULL, not CASCADE: a money record outlives an account deletion
  -- (the key below keeps which order it was); not RESTRICT, so deletion never blocks.
  declutter_order_id uuid REFERENCES public.declutter_orders(id) ON DELETE SET NULL,
  shop_order_id uuid,
  -- One label per order, ever (money review fix 7): the claim row is written before any
  -- purchase, and every resume reads this row first.
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^(declutter|shop):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  -- The Stripe mode of the order, which also picks the EasyPost key (fix 8): a test-mode
  -- order never touches the live EasyPost key.
  label_mode text NOT NULL CHECK (label_mode IN ('test', 'live')),
  label_provider text NOT NULL DEFAULT 'easypost' CHECK (label_provider = 'easypost'),
  label_state text NOT NULL DEFAULT 'claimed'
    CHECK (label_state IN ('claimed', 'bought', 'void_requested', 'voided', 'void_rejected', 'failed')),
  service text NOT NULL CHECK (service IN ('usps_ground_advantage', 'usps_priority')),
  -- What the buyer paid for postage (+ label fee + insurance): the most a label may cost
  -- without paging ops (the worker compares BEFORE buying).
  quoted_cents integer NOT NULL CHECK (quoted_cents > 0),
  extra_insurance_cents integer NOT NULL DEFAULT 0 CHECK (extra_insurance_cents >= 0),
  provider_shipment_id text UNIQUE,
  provider_rate_id text,
  label_cost_cents integer CHECK (label_cost_cents >= 0),
  label_path text,
  tracking_code text,
  tracking_status text CHECK (tracking_status IN ('pre_transit', 'in_transit', 'out_for_delivery', 'delivered',
    'available_for_pickup', 'return_to_sender', 'failure', 'unknown')),
  accepted_at timestamptz,
  delivered_at timestamptz,
  -- Private. Louisiana only (decision 3): ZIP 700-701, 703-708, 710-714.
  ship_to jsonb NOT NULL CHECK (ship_to ->> 'zip' ~ '^(70[013-8]|71[0-4])[0-9]{2}(-[0-9]{4})?$'),
  -- Weight in ounces and box inches (decision 8: small only; at most 20 lb, 22 in long).
  parcel jsonb NOT NULL CHECK (
    jsonb_typeof(parcel -> 'weight_oz') = 'number'
    AND (parcel ->> 'weight_oz')::numeric > 0 AND (parcel ->> 'weight_oz')::numeric <= 320
    AND COALESCE((parcel ->> 'length_in')::numeric, 0) <= 22),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipments_at_most_one_order CHECK (num_nonnulls(declutter_order_id, shop_order_id) <= 1),
  CONSTRAINT shipments_key_matches_order CHECK (
    (declutter_order_id IS NULL OR idempotency_key = 'declutter:' || declutter_order_id::text)
    AND (shop_order_id IS NULL OR idempotency_key = 'shop:' || shop_order_id::text)),
  -- A bought label always has its shipment, cost and tracking code recorded (the real
  -- cost is recorded even when above quoted_cents: the purchase already happened).
  CONSTRAINT shipments_bought_has_label CHECK (
    label_state IN ('claimed', 'failed')
    OR (provider_shipment_id IS NOT NULL AND label_cost_cents IS NOT NULL AND tracking_code IS NOT NULL)),
  CONSTRAINT shipments_delivered_has_time CHECK (tracking_status IS DISTINCT FROM 'delivered' OR delivered_at IS NOT NULL)
);
-- The Shops link, only where Shops orders exist (replay-safe on any stack).
DO $do$
BEGIN
  IF to_regclass('public.shop_orders') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipments_shop_order_id_fkey'
      AND conrelid = 'public.shipments'::regclass) THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_shop_order_id_fkey
      FOREIGN KEY (shop_order_id) REFERENCES public.shop_orders(id) ON DELETE SET NULL;
  END IF;
END
$do$;
CREATE INDEX IF NOT EXISTS shipments_declutter_order_idx ON public.shipments (declutter_order_id);
CREATE INDEX IF NOT EXISTS shipments_shop_order_idx ON public.shipments (shop_order_id);
CREATE INDEX IF NOT EXISTS shipments_worker_idx ON public.shipments (next_attempt_at) WHERE label_state = 'claimed';

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shipments TO service_role;
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
