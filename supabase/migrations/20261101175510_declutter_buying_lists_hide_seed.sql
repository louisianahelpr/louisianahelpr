-- Buying lists skip test (is_seed) items (owner 2026-11-01, via the lead): the owner's Buying tab showed "Your offers:
-- Fixture rocking chair [E2E-PRODAUDIT]", an expired 10-19 offer by admin@ on an is_seed item. Browse and the item
-- page already hide test listings through the items read policy (20261020033623: NOT is_seed OR NOT
-- seed_hidden_in_discovery()), but declutter_my_offers and declutter_my_cart are SECURITY DEFINER and read past it.
-- Same rule here: a test item's line is left out unless the caller is its seller, or a test account (the nightly
-- two-account journeys keep theirs), or the launch switch is off. Admins are not carved out (the owner sees what the
-- public sees). A cart line whose item is gone (a former member, i.id NULL) still shows, as before.
--
-- Free asks (MyFreeAsks) read declutter_free_requests with the item joined under that same items policy; the client
-- now requires the item (an inner join), so it follows the rule without SQL.
--
-- Restated from the NEWEST definitions: declutter_my_offers from 20261031095146_declutter_my_offers_open_wanted_id,
-- declutter_my_cart from 20261030064929_declutter_buy_now_no_strike. Only the WHERE clause changes. Replay-safe:
-- CREATE OR REPLACE, same signatures. Guard: src/test/declutterBuyingListsHideSeed.test.ts.

CREATE OR REPLACE FUNCTION public.declutter_my_offers()
RETURNS TABLE (offer_id uuid, item_id uuid, item_title text, my_side text, amount_cents integer,
               awaiting text, status text, respond_by timestamptz, counter_count integer,
               current_price_cents integer, floor_price_cents integer, updated_at timestamptz,
               from_wanted boolean, open_wanted_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.id, o.item_id, i.title,
         CASE WHEN o.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         o.amount_cents, o.awaiting, o.status, o.respond_by, o.counter_count,
         i.current_price_cents,
         CASE WHEN o.seller_id = v_uid THEN p.floor_price_cents END,
         o.updated_at,
         (o.wanted_id IS NOT NULL),
         w.id
    FROM public.declutter_offers o
    JOIN public.declutter_items i ON i.id = o.item_id
    LEFT JOIN public.declutter_item_private p ON p.item_id = o.item_id
    LEFT JOIN public.declutter_wanted w
           ON w.id = o.wanted_id AND w.user_id = v_uid AND o.buyer_id = v_uid AND w.status = 'open'
   WHERE (o.buyer_id = v_uid OR o.seller_id = v_uid)
     AND (o.status = 'open' OR o.updated_at > now() - interval '30 days')
     -- A test item stays out of a non-test viewer's list (the items read policy's rule; its seller still sees it).
     AND (NOT i.is_seed OR i.seller_id = v_uid OR NOT public.seed_hidden_in_discovery())
   ORDER BY (o.status = 'open') DESC, o.updated_at DESC
   LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_offers() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_my_cart()
 RETURNS TABLE(line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid, price_cents integer, status text, checkout_by timestamp with time zone, order_id uuid, order_status text, handover text, premium_cents integer, total_cents integer, porch_ok boolean, delivery_cents integer, delivery_task_id uuid, handovers text[], source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.item_id, COALESCE(i.title, 'An item from a former member'),
         CASE WHEN c.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         -- Q2427: a line still in the cart shows its original price (a bundle discount is applied at checkout).
         c.seller_id, CASE WHEN c.status = 'in_cart' THEN COALESCE(c.list_price_cents, c.price_cents) ELSE c.price_cents END,
         c.status, c.checkout_by, c.order_id,
         o.status, o.handover, o.premium_cents, o.total_cents,
         COALESCE(i.porch_ok, false), o.delivery_cents, od.task_id, i.handovers,
         c.source  -- DB-5
    FROM public.declutter_cart_items c
    LEFT JOIN public.declutter_items i ON i.id = c.item_id
    LEFT JOIN public.declutter_orders o ON o.id = c.order_id
    LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id
   WHERE (c.buyer_id = v_uid OR c.seller_id = v_uid)
     AND (c.status = 'in_cart' OR c.created_at > now() - interval '30 days')
     -- A test item stays out of a non-test viewer's cart (the items read policy's rule; its seller still sees it).
     AND (i.id IS NULL OR NOT i.is_seed OR c.seller_id = v_uid OR NOT public.seed_hidden_in_discovery())
   ORDER BY (c.status = 'in_cart') DESC, c.checkout_by
   LIMIT 200;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_my_cart() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_cart() TO authenticated, service_role;
