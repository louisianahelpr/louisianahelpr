-- Audit 11-10 F372: Declutter order cards had no item photo while cart and offer cards did, so a list of orders scanned
-- by title only. The cards are built from declutter_my_cart (the paid lines grouped by order), so the order read now
-- carries the photo: declutter_my_cart gains photo_path, the line's item's first photo (lowest position), the same
-- storage path a cart line's thumbnail (fetchPhotos) and declutter_my_wanted's replies (photo_path) already hand out.
-- Only the line's own buyer or seller gets a row (the WHERE is unchanged); the photo is the listing's public photo,
-- one the buyer could read while it was listed. NULL once the item or its photos are gone (the card shows grey).
-- Cost: one index probe per line (declutter_item_photos_position_key UNIQUE (item_id, position)); 200 lines at most.
--
-- Restated VERBATIM from its newest definition, 20261108195151_declutter_trades_fixes.sql, plus that column (marked
-- "CHANGED 20261112054500"). A new OUT column cannot be added by CREATE OR REPLACE, so it is dropped and created
-- again (no SQL object calls it; the app and the mine prefetch read it by name); grants restated by role name, as
-- 20261101175510 left them. Replay-safe: DROP IF EXISTS + CREATE.
-- Proof: src/test/pglite/declutterMyCartPhotoPath.pglite.mjs. Sensitive: authz (what a member reads through a definer).

DROP FUNCTION IF EXISTS public.declutter_my_cart();
CREATE FUNCTION public.declutter_my_cart()
 RETURNS TABLE(line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid, price_cents integer, status text, checkout_by timestamp with time zone, order_id uuid, order_status text, handover text, premium_cents integer, total_cents integer, porch_ok boolean, delivery_cents integer, delivery_task_id uuid, handovers text[], closed_at timestamp with time zone, source text, photo_path text)
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
  SELECT c.id, c.item_id,
         -- DC-18: the title kept on the line once the listing is gone; "former member" only when the seller's account is.
         COALESCE(i.title, c.item_title,
                  CASE WHEN c.seller_id IS NULL THEN 'An item from a former member' ELSE 'A listing that was taken down' END),
         CASE WHEN c.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         -- Q2427: a line still in the cart shows its original price (a bundle discount is applied at checkout).
         c.seller_id, CASE WHEN c.status = 'in_cart' THEN COALESCE(c.list_price_cents, c.price_cents) ELSE c.price_cents END,
         c.status, c.checkout_by, c.order_id,
         o.status, o.handover, o.premium_cents, o.total_cents,
         COALESCE(i.porch_ok, false), o.delivery_cents, od.task_id, i.handovers,
         c.closed_at,  -- DC-18: when an ended line ended
         CASE WHEN c.swap_id IS NOT NULL THEN 'swap' ELSE c.source END,  -- DB-5; CHANGED (trades #2): 'swap' = a trade line
         -- CHANGED 20261112054500 (F372): the item's first photo (storage path, the public job-photos bucket),
         -- for the line's own two sides only (the WHERE below); NULL once the listing or its photos are gone.
         (SELECT ph.storage_path FROM public.declutter_item_photos ph
           WHERE ph.item_id = c.item_id ORDER BY ph.position LIMIT 1)
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
