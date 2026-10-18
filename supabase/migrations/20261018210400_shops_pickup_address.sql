-- Shops M1b part 2: the maker's EXACT pickup address, private (lead decision
-- 2026-10-18, ~/.lh-wt/handoffs-1017/shops-s3.prev-0305.md "M1b TAX: pickup
-- address"; tax memo Q3: a pickup sale is taxed where the buyer takes it, so
-- Stripe Tax gets this address as the line items' performance_location).
--
-- Who sees it:
--   * the shop's owner: always (shops_my_pickup_address);
--   * the order's buyer: only while the maker has ACCEPTED the order and it
--     is not yet picked up (status accepted, until 7 days after the ready
--     date on M1's Louisiana clock, shop_local_today), never a banned buyer, through shops_order_pickup_address. After
--     handover (M2's handed_over) the buyer no longer reads the shop's
--     CURRENT address (authz review 2026-10-18, finding 1: "forever");
--   * the edge functions (service_role): to make the Stripe Tax location.
--   Never shops, shops_browse, shops_get_shop or anything anon can read: the
--   public page keeps the rough 2-decimal pin and the area label (L50).
-- Selling needs it: a new order on a shop with no pickup address is refused
-- (pickup_address_missing), because M1 orders are pickup only (O4).
--
-- Replay-safe (IF NOT EXISTS, CREATE OR REPLACE, guarded constraint/trigger);
-- REVOKE ... FROM PUBLIC, anon on every function.

CREATE TABLE IF NOT EXISTS public.shop_pickup_addresses (
  shop_id uuid PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  line1 text NOT NULL CHECK (char_length(btrim(line1)) BETWEEN 3 AND 120),
  line2 text CHECK (line2 IS NULL OR char_length(btrim(line2)) BETWEEN 1 AND 120),
  city text NOT NULL CHECK (char_length(btrim(city)) BETWEEN 2 AND 60),
  -- Shops is Louisiana only; Louisiana ZIP codes run 70001-71497.
  -- Named state_code, not state: a bare `state` column would be the only one in
  -- the schema, so every fixture's `state: ...` (job card states, UI states)
  -- would be graded as this table's row (fixtureSchemaContract, 2026-10-18).
  state_code text NOT NULL DEFAULT 'LA' CHECK (state_code = 'LA'),
  postal_code text NOT NULL CHECK (postal_code ~ '^7[01][0-9]{3}$'),
  -- The Stripe Tax location made from this address (tax/locations, type
  -- performance) and the mode it was made in. Cleared whenever the address
  -- changes, so the edge function makes a fresh one.
  stripe_tax_location_id text,
  stripe_tax_location_mode text CHECK (stripe_tax_location_mode IS NULL OR stripe_tax_location_mode IN ('live', 'test')),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_pickup_addresses_location_pair CHECK ((stripe_tax_location_id IS NULL) = (stripe_tax_location_mode IS NULL))
);
CREATE INDEX IF NOT EXISTS shop_pickup_addresses_owner_idx ON public.shop_pickup_addresses (owner_id);
ALTER TABLE public.shop_pickup_addresses ENABLE ROW LEVEL SECURITY;
-- No member reads the table: only the functions below, and service_role.
REVOKE ALL ON TABLE public.shop_pickup_addresses FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_pickup_addresses TO service_role;

-- The owner on the row is the shop's owner, whoever writes it.
CREATE OR REPLACE FUNCTION public.shop_pickup_addresses_owner_is_shop_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  SELECT s.owner_id INTO NEW.owner_id FROM public.shops s WHERE s.id = NEW.shop_id;
  IF NEW.owner_id IS NULL THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.line1, NEW.line2, NEW.city, NEW.postal_code)
       IS DISTINCT FROM (OLD.line1, OLD.line2, OLD.city, OLD.postal_code) THEN
    NEW.stripe_tax_location_id := NULL;
    NEW.stripe_tax_location_mode := NULL;
    NEW.updated_at := now();
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only an address change moves updated_at: the edge function's cache
    -- write (location id + mode) keeps it, so the Stripe idempotency key
    -- (shop-taxloc-<shop>-<mode>-<updated_at>) stays the address's own
    -- (review 2026-10-18, finding 5).
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_pickup_addresses_owner_is_shop_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_pickup_addresses_owner ON public.shop_pickup_addresses;
CREATE TRIGGER trg_shop_pickup_addresses_owner
  BEFORE INSERT OR UPDATE ON public.shop_pickup_addresses
  FOR EACH ROW EXECUTE FUNCTION public.shop_pickup_addresses_owner_is_shop_owner();

-- Save (or change) the caller's own shop's pickup address.
CREATE OR REPLACE FUNCTION public.shops_save_my_pickup_address(
  p_line1 text, p_line2 text, p_city text, p_postal_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
BEGIN
  -- The same gates as M1's shops_set_cancel_policy: the switch, not banned,
  -- an eligible shop owner (shops_assert_owner_eligible raises its own codes).
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT s.id INTO v_shop FROM public.shops s WHERE s.owner_id = v_uid;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 3 AND 120
     OR (p_line2 IS NOT NULL AND btrim(p_line2) <> '' AND char_length(btrim(p_line2)) > 120)
     OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'invalid_pickup_address' USING ERRCODE = '22023';
  END IF;
  IF p_postal_code IS NULL OR btrim(p_postal_code) !~ '^7[01][0-9]{3}$' THEN
    RAISE EXCEPTION 'pickup_address_not_in_louisiana' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shop_pickup_addresses (shop_id, owner_id, line1, line2, city, postal_code)
  VALUES (v_shop, v_uid, btrim(p_line1), NULLIF(btrim(coalesce(p_line2, '')), ''), btrim(p_city), btrim(p_postal_code))
  ON CONFLICT (shop_id) DO UPDATE
    SET line1 = EXCLUDED.line1, line2 = EXCLUDED.line2, city = EXCLUDED.city, postal_code = EXCLUDED.postal_code;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_save_my_pickup_address(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_save_my_pickup_address(text, text, text, text) TO authenticated, service_role;

-- The caller's own shop's pickup address (no row = none saved yet).
CREATE OR REPLACE FUNCTION public.shops_my_pickup_address()
RETURNS TABLE (line1 text, line2 text, city text, state text, postal_code text, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT a.line1, a.line2, a.city, a.state_code, a.postal_code, a.updated_at
  FROM public.shop_pickup_addresses a
  JOIN public.shops s ON s.id = a.shop_id
  WHERE s.owner_id = auth.uid() AND a.owner_id = auth.uid();
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_pickup_address() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_pickup_address() TO authenticated, service_role;

-- Where to pick up an order: to the order's seller always; to its buyer only
-- while it is accepted and not past a week after the ready date, and never to
-- a banned buyer. Anyone else, too early or too late: no row (never an error
-- that says whether the order exists).
CREATE OR REPLACE FUNCTION public.shops_order_pickup_address(p_order_id uuid)
RETURNS TABLE (line1 text, line2 text, city text, state text, postal_code text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT a.line1, a.line2, a.city, a.state_code, a.postal_code
  FROM public.shop_orders o
  JOIN public.shop_pickup_addresses a ON a.shop_id = o.shop_id
  WHERE o.id = p_order_id
    AND auth.uid() IS NOT NULL
    -- The address is the order's seller's own (defence if shops ever change hands).
    AND a.owner_id = o.seller_id
    AND (o.seller_id = auth.uid()
         OR (o.buyer_id = auth.uid()
             AND o.status = 'accepted'
             AND public.shop_local_today() <= o.ready_date + 7
             AND NOT public.is_caller_banned()));
$fn$;
REVOKE ALL ON FUNCTION public.shops_order_pickup_address(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_pickup_address(uuid) TO authenticated, service_role;

-- No pickup address, no new order (M1 orders are pickup only).
CREATE OR REPLACE FUNCTION public.shop_orders_need_pickup_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.shop_pickup_addresses a WHERE a.shop_id = NEW.shop_id) THEN
    RAISE EXCEPTION 'pickup_address_missing' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_need_pickup_address() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_need_pickup_address ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_need_pickup_address
  BEFORE INSERT ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_need_pickup_address();

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
