-- Shops audit 11-08 (~/.lh-shots/handoffs-1108/shops-audit.md), Builder 5:
--
--   #1 "Half up front" custom orders can be picked and asked for, but shops_order_custom_quote always refuses them
--      (deposit_not_ready; owner 11-07 "Deposit orders stay off"). While that refusal stands:
--        a. shops_set_custom_orders refuses 'deposit_50' (deposit_orders_closed). The screen no longer offers it.
--        b. Every shop already on 'deposit_50' is moved to 'full_hold' (paid in full) and told so in a plain notice.
--        c. Every OPEN request (requested / quoted) frozen on 'deposit_50' becomes 'full_hold', so the buyer can order
--           the price instead of meeting deposit_not_ready. A request's plan has no freeze trigger (only an order's,
--           shop_orders_deposit_split), and an order is never written from a deposit request today.
--      The column CHECKs still allow 'deposit_50' so the deposit work can reopen it later without a schema change.
--
--   #2 The shop's private pickup address went to any buyer of an accepted order, whatever the fulfillment. A buyer of
--      at-home work (a line with at_buyer), of shop delivery, or of a Helpr delivery that is still a delivery could read
--      the shop's home address. shops_order_pickup_address now returns it to the buyer only when the order is a pickup
--      (fulfillment 'pickup', or a Helpr delivery that fell back to pickup: helpr_unfilled_at set) and no line is
--      at_buyer. The seller still reads their own address back.
--
-- Restated from their NEWEST CREATE: shops_set_custom_orders (20261106202917_shops_custom_requests.sql) and
--   shops_order_pickup_address (20261018210400_shops_pickup_address.sql); only the lines marked "audit 11-08" change.
--   Neither function is restated on origin/ready/b5-preorders or origin/ready/b4-digital (checked 11-08).
-- MONEY: no. AUTHZ: yes (who may read the pickup address; lh-authz-rls).
-- REPLAY-SAFE: CREATE OR REPLACE with unchanged signatures; the data moves only touch rows still on 'deposit_50', so a
--   replay changes and notifies nothing.
-- Proof: src/test/pglite/shopsDepositHiddenPickupPrivate.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

-- #1a
CREATE OR REPLACE FUNCTION public.shops_set_custom_orders(p_mode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF p_mode IS NULL OR p_mode NOT IN ('off', 'full_hold', 'deposit_50') THEN
    RAISE EXCEPTION 'invalid_custom_orders' USING ERRCODE = '22023';
  END IF;
  -- audit 11-08 #1: half up front stays closed while shops_order_custom_quote refuses it (deposit_not_ready).
  IF p_mode = 'deposit_50' THEN
    RAISE EXCEPTION 'deposit_orders_closed' USING ERRCODE = '55000',
      HINT = 'Half up front isn''t open yet. Pick custom orders paid in full for now.';
  END IF;
  UPDATE public.shops SET custom_orders = p_mode, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN p_mode;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_custom_orders(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_custom_orders(text) TO authenticated, service_role;

-- #1b, #1c
DO $do$
DECLARE
  s record;
BEGIN
  UPDATE public.shop_custom_requests SET payment_plan = 'full_hold'
   WHERE payment_plan = 'deposit_50' AND status IN ('requested', 'quoted');
  FOR s IN
    UPDATE public.shops SET custom_orders = 'full_hold', updated_at = now()
     WHERE custom_orders = 'deposit_50'
    RETURNING id, owner_id
  LOOP
    PERFORM public.declutter_notify(s.owner_id, 'info', 'Custom orders are paid in full for now',
      'Half up front isn''t open yet, so your custom orders are now paid in full: the buyer''s card is held and charged in full when you accept. Open requests now use paid in full too.',
      '/shops/mine', NULL);
  END LOOP;
END
$do$;

-- #2
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
             -- audit 11-08 #2: only a buyer who picks up at the shop, and never for work at the buyer's place.
             AND (o.fulfillment = 'pickup'
                  OR (o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NOT NULL))
             AND NOT EXISTS (SELECT 1 FROM public.shop_order_lines l WHERE l.order_id = o.id AND l.at_buyer)
             AND NOT public.is_caller_banned()));
$fn$;
REVOKE ALL ON FUNCTION public.shops_order_pickup_address(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_pickup_address(uuid) TO authenticated, service_role;
