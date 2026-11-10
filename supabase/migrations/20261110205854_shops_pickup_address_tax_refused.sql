-- Q2146 (lh-money-escrow review of Shops M1b part 2, finding fa4320caa#2): a shop whose pickup address Stripe
-- refuses was never told.
--
-- What was broken: shop-checkout works out the sales tax at the shop's pickup address (H6, one Stripe tax
-- calculation). When Stripe refuses that address, the checkout answers 409 pickup_address_unusable and logs
-- shop_pickup_address_unusable, so every buyer sees "needs fixing" while the shop owner's My shop shows nothing
-- and no notice reaches them. The shop silently takes no orders.
--
-- The fix:
--   1. shop_pickup_addresses keeps when Stripe last refused the address (tax_refused_at) and its words
--      (tax_refused_reason: never shown in the app; Download My Data returns the member's own row with it).
--   2. shops_mark_pickup_address_refused (service_role only; shop-checkout calls it on a refusal) stamps the row
--      and, the first time since the address last changed, sends the owner one notice. A second refusal of the
--      same address sends nothing more. It stamps only the copy the checkout was taxed on (its updated_at), so a
--      refusal of the old address never lands on one the owner saved meanwhile (lh-money-escrow review 1).
--   2b. shops_clear_pickup_address_refused (service_role only): Stripe later taxed that same copy, so the refusal
--      was a one-off; the stamp and My shop's note go (review 2).
--   3. The row trigger (newest body 20261103091013) clears the stamp whenever the street, city or ZIP changes,
--      exactly as it already clears the cached Stripe tax location; a fresh address gets a fresh notice.
--   4. shops_my_pickup_address_problem() lets the owner's My shop say so beside the address (their own shop only).
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS + CREATE; grants restated.

ALTER TABLE public.shop_pickup_addresses
  ADD COLUMN IF NOT EXISTS tax_refused_at timestamptz,
  ADD COLUMN IF NOT EXISTS tax_refused_reason text;
ALTER TABLE public.shop_pickup_addresses DROP CONSTRAINT IF EXISTS shop_pickup_addresses_tax_refused_reason_len;
ALTER TABLE public.shop_pickup_addresses
  ADD CONSTRAINT shop_pickup_addresses_tax_refused_reason_len CHECK (tax_refused_reason IS NULL OR char_length(tax_refused_reason) <= 200);

-- The row trigger, restated from its newest body (20261103091013) with one change: an address change also clears
-- the refusal stamp.
CREATE OR REPLACE FUNCTION public.shop_pickup_addresses_owner_is_shop_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  SELECT s.owner_id INTO NEW.owner_id FROM public.shops s WHERE s.id = NEW.shop_id;
  IF NEW.owner_id IS NULL THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.line1, NEW.line2, NEW.city, NEW.postal_code)
       IS DISTINCT FROM (OLD.line1, OLD.line2, OLD.city, OLD.postal_code) THEN
    NEW.stripe_tax_location_id := NULL;
    NEW.stripe_tax_location_mode := NULL;
    -- Q2146: a new address has not been refused; its first refusal sends a fresh notice.
    NEW.tax_refused_at := NULL;
    NEW.tax_refused_reason := NULL;
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
GRANT EXECUTE ON FUNCTION public.shop_pickup_addresses_owner_is_shop_owner() TO service_role;
DROP TRIGGER IF EXISTS trg_shop_pickup_addresses_owner ON public.shop_pickup_addresses;
CREATE TRIGGER trg_shop_pickup_addresses_owner
  BEFORE INSERT OR UPDATE ON public.shop_pickup_addresses
  FOR EACH ROW EXECUTE FUNCTION public.shop_pickup_addresses_owner_is_shop_owner();

-- shop-checkout (service_role) calls this when Stripe refuses the pickup address. Returns true when it sent the
-- owner a notice (the first refusal since the address last changed), false otherwise (already told, or no row).
CREATE OR REPLACE FUNCTION public.shops_mark_pickup_address_refused(p_shop_id uuid, p_address_updated_at timestamptz, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_owner uuid;
  v_first boolean;
BEGIN
  -- One row per shop (PRIMARY KEY shop_id). FOR UPDATE: two refused checkouts at once send one notice.
  SELECT a.owner_id, a.tax_refused_at IS NULL INTO v_owner, v_first
  FROM public.shop_pickup_addresses a
  WHERE a.shop_id = p_shop_id AND a.updated_at = p_address_updated_at
  FOR UPDATE;
  IF v_owner IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.shop_pickup_addresses
     SET tax_refused_at = now(), tax_refused_reason = left(coalesce(p_reason, ''), 200)
   WHERE shop_id = p_shop_id;
  IF NOT v_first THEN
    RETURN false;
  END IF;
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_owner,
    'Check your pickup address',
    'We couldn''t work out sales tax for your shop''s pickup address, so buyers can''t order from your shop right now. Check the street, city and ZIP in My shop.',
    'system_alert',
    '/shops/mine'
  );
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_mark_pickup_address_refused(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_mark_pickup_address_refused(uuid, timestamptz, text) TO service_role;

-- shop-checkout (service_role) calls this when Stripe taxed a pickup address it had refused before, the same copy
-- (updated_at). Returns true when it cleared a stamp.
CREATE OR REPLACE FUNCTION public.shops_clear_pickup_address_refused(p_shop_id uuid, p_address_updated_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.shop_pickup_addresses
     SET tax_refused_at = NULL, tax_refused_reason = NULL
   WHERE shop_id = p_shop_id AND updated_at = p_address_updated_at AND tax_refused_at IS NOT NULL;
  RETURN FOUND;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_clear_pickup_address_refused(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_clear_pickup_address_refused(uuid, timestamptz) TO service_role;

-- The owner's My shop: when Stripe last refused their pickup address (null: not refused since it last changed).
-- Their own shop only; it returns the time, never Stripe's words.
CREATE OR REPLACE FUNCTION public.shops_my_pickup_address_problem()
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_at timestamptz;
BEGIN
  PERFORM public.require_feature('shops');
  SELECT a.tax_refused_at INTO v_at
  FROM public.shop_pickup_addresses a
  JOIN public.shops s ON s.id = a.shop_id
  WHERE s.owner_id = auth.uid() AND a.owner_id = auth.uid();
  RETURN v_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_my_pickup_address_problem() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_pickup_address_problem() TO authenticated, service_role;
