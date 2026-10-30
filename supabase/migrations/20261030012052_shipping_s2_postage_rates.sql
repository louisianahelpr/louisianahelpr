-- Shipping S2 rates: the quote a buyer picks before paying (docs/specs/shipping-draft.md S2, owner decisions 11
-- and 13 of 2026-10-29; Q2259).
--
-- Why: the ship-rates edge function asks EasyPost for live postage on the buyer's cart and shows at most 3 options.
-- Checkout (S3) must charge EXACTLY the rate the buyer saw, and the label worker (S5) must buy exactly that rate.
-- So the quote is stored server-side, under a random id, with the provider's rate and shipment ids, and the client
-- only ever sends the quote id back. A buyer who edits the price in the browser changes nothing.
--
-- What:
--   1. public.shipping_quotes, service-role only (no client role can read or write it; ship_to is the buyer's
--      private address). Same Louisiana and parcel CHECKs as shipments (missing keys refused). A quote expires
--      30 minutes after it is made (EasyPost rates are live prices; checkout re-quotes after that).
--   2. A quote can be stored only for a buyer the declutter_shipping switch is on for (trigger below), so a stray
--      service-role call can never open shipping to an ordinary account while the switch is testers-only.
--   3. The switch declutter_shipping itself, created for testers (never everyone; the owner flips it).
--   4. UPS Ground joins the allowed label services (decision 13: USPS Ground Advantage incl. cubic, USPS Priority,
--      UPS Ground; never air or overnight).
--   5. declutter_items.ship_preset: the parcel preset a seller picks for "Ship it" (small items only; NULL = the
--      item does not ship). The S3 listing form writes it; ship-rates reads it to build the parcel.
--
-- Replay-safe: CREATE ... IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS before each trigger and constraint,
-- ON CONFLICT DO NOTHING for the switch. Applied 3x in PGlite (src/test/pglite/shippingS2Quotes.pglite.mjs).

-- 3. The switch (testers; FEATURE_SWITCH_KEYS + SERVER_ONLY in src/config/featureSwitches.ts until the S3 screen).
INSERT INTO public.feature_switches (key, audience, description) VALUES
  ('declutter_shipping', 'testers', 'Declutter shipping: live postage quotes (ship-rates), Ship it at checkout, labels and tracking')
ON CONFLICT (key) DO NOTHING;

-- 4. UPS Ground is an allowed label service. shipments has no rows on prod (read 2026-10-30), and the new list
--    is a superset of the old, so no existing row can fail it.
ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_service_check;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_service_check
  CHECK (service IN ('usps_ground_advantage', 'usps_priority', 'ups_ground'));

-- 5. The parcel preset a seller picks when they turn on "Ship it" (spec 6; the S3 listing form writes it). NULL =
--    the item does not ship. Small items only (decision 8). ship-rates quotes each preset at its max weight and a
--    bundle as one parcel (supabase/functions/_shared/easypostRates.ts PARCEL_PRESETS, bundleParcel).
ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS ship_preset text;
ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_ship_preset_check;
ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_ship_preset_check CHECK (ship_preset IS NULL
  OR (ship_preset IN ('envelope', 'small_box', 'medium_box', 'large_box') AND delivery_size = 'small'));

-- 1. Quotes.
CREATE TABLE IF NOT EXISTS public.shipping_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Quotes are short-lived prices, not money records: they go with the account.
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The cart lines this parcel carries (one parcel per seller's bundle, decision 10).
  cart_item_ids uuid[] NOT NULL CHECK (cardinality(cart_item_ids) BETWEEN 1 AND 50),
  -- The Stripe mode of the parties, which picked the EasyPost key (money review fix 8).
  label_mode text NOT NULL CHECK (label_mode IN ('test', 'live')),
  service text NOT NULL CHECK (service IN ('usps_ground_advantage', 'usps_priority', 'ups_ground')),
  rate_cents integer NOT NULL CHECK (rate_cents > 0 AND rate_cents <= 100000),
  provider_rate_id text NOT NULL CHECK (provider_rate_id ~ '^rate_[A-Za-z0-9]{1,64}$'),
  provider_shipment_id text NOT NULL CHECK (provider_shipment_id ~ '^shp_[A-Za-z0-9]{1,64}$'),
  delivery_days integer CHECK (delivery_days IS NULL OR delivery_days BETWEEN 0 AND 60),
  preselected boolean NOT NULL DEFAULT false,
  -- Private. Louisiana only (decision 3), the same CHECK as shipments.ship_to (a missing zip is refused).
  ship_to jsonb NOT NULL CHECK (jsonb_typeof(ship_to) = 'object'
    AND COALESCE(ship_to ->> 'zip' ~ '^(70[013-8]|71[0-4])[0-9]{2}(-[0-9]{4})?$', false)
    AND pg_column_size(ship_to) <= 2048),
  -- Weight in ounces and box inches (small only; at most 20 lb, no side over 22 in), as shipments.parcel.
  parcel jsonb NOT NULL CHECK (jsonb_typeof(parcel) = 'object'
    AND COALESCE(jsonb_typeof(parcel -> 'weight_oz') = 'number'
      AND (parcel ->> 'weight_oz')::numeric > 0 AND (parcel ->> 'weight_oz')::numeric <= 320, false)
    AND greatest(COALESCE((parcel ->> 'length_in')::numeric, 0), COALESCE((parcel ->> 'width_in')::numeric, 0),
                 COALESCE((parcel ->> 'height_in')::numeric, 0)) <= 22),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  CONSTRAINT shipping_quotes_not_own CHECK (buyer_id <> seller_id),
  CONSTRAINT shipping_quotes_short_lived CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes')
);
CREATE INDEX IF NOT EXISTS shipping_quotes_buyer_idx ON public.shipping_quotes (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shipping_quotes_seller_idx ON public.shipping_quotes (seller_id);
CREATE INDEX IF NOT EXISTS shipping_quotes_expires_idx ON public.shipping_quotes (expires_at);

-- 2. Stored only for a buyer the switch is on for, and frozen once stored (a quote is a price the buyer saw:
--    nothing may move it afterwards; a new price is a new quote).
CREATE OR REPLACE FUNCTION public.shipping_quotes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'shipping_quote_frozen' USING ERRCODE = '55000';
  END IF;
  IF NOT COALESCE(public.feature_enabled_for_user('declutter_shipping', NEW.buyer_id), false) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shipping_quotes_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shipping_quotes_guard ON public.shipping_quotes;
CREATE TRIGGER trg_shipping_quotes_guard BEFORE INSERT OR UPDATE ON public.shipping_quotes
  FOR EACH ROW EXECUTE FUNCTION public.shipping_quotes_guard();

ALTER TABLE public.shipping_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipping_quotes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shipping_quotes TO service_role;
COMMENT ON TABLE public.shipping_quotes IS
  'Live postage quotes from ship-rates (Shipping S2, Q2259): the exact rate a buyer may pick, by id. Service-role '
  'only; ship_to is private. Expires 30 minutes after it is made; frozen once stored.';
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
