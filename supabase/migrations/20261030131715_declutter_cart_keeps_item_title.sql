-- A Declutter sale keeps its item's title after the listing is deleted (Declutter audit DC-18 + DB-19, 2026-10-30).
--
-- BROKEN: declutter_cart_items stored no title; declutter_my_cart read it live from declutter_items. When a seller
-- deleted a listing that had a cart line (paid, called off, missed or removed), the item_id FK is ON DELETE SET NULL,
-- so the line lost its title and both sides saw "An item from a former member", even when nobody had deleted an
-- account (prod 2026-10-30: 5 of 6 cart lines had item_id NULL, every one with both buyer and seller still present).
-- The seller's own Selling history then called the seller "a former member". Ended cards also showed no date.
--
-- FIX:
--   1. declutter_cart_items.item_title: the item's title, written by a BEFORE INSERT / UPDATE OF item_id, status
--      trigger from declutter_items while the item exists (so it is the title at the moment of sale), and left as it
--      was once the item is gone. Every insert path (Buy now, accepted offer, free claim) goes through it, so no
--      RPC is restated for it. Existing lines whose item still exists are backfilled; lines whose item is already
--      gone cannot be (the title is nowhere else).
--   2. declutter_my_cart reads the live title first, then the kept one: unchanged while the item exists; the kept
--      title after it is deleted. The last-resort words (only lines whose item was deleted before this migration)
--      say "An item from a former member" only when the seller's account is gone (seller_id NULL, Q2307), and
--      "A listing that was taken down" otherwise. It also returns the line's closed_at, so ended cards can show the
--      date it ended (price_cents was already returned).
--
-- RESTATED FROM: declutter_my_cart from 20261030064929_declutter_buy_now_no_strike.sql (B88, DB-5; not on main yet,
-- this branch is stacked on it), which restated prod's definition (md5 of pg_get_functiondef
-- 33f617afb43edbfd5651794690267663, re-read on prod 2026-10-30 and unchanged). Changes are marked "DC-18".
-- Grants restated to prod's proacl (authenticated, service_role).
-- AUTHZ: the new column is covered by authenticated's existing table-level SELECT grant and the table's RLS (a
-- party already sees the item's title); members still have no INSERT/UPDATE on the table. The trigger function is
-- SECURITY DEFINER (it reads declutter_items whatever the caller) and executable by nobody but its owner.
-- MONEY: none; no amount, status or strike changes.
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS; backfill only fills NULLs; CREATE OR REPLACE for the trigger function;
-- DROP TRIGGER IF EXISTS before CREATE; DROP FUNCTION IF EXISTS for my_cart, whose row type gains a column.
-- Proof: src/test/pglite/declutterCartKeepsItemTitle.pglite.mjs (3x).

ALTER TABLE public.declutter_cart_items ADD COLUMN IF NOT EXISTS item_title text;

CREATE OR REPLACE FUNCTION public.declutter_cart_item_keep_title()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_title text;
BEGIN
  IF NEW.item_id IS NOT NULL THEN
    SELECT i.title INTO v_title FROM public.declutter_items i WHERE i.id = NEW.item_id;
  END IF;
  -- The item gone (FK set NULL, or never found): keep the title already on the line.
  NEW.item_title := COALESCE(v_title, NEW.item_title);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_cart_item_keep_title() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS declutter_cart_item_keep_title ON public.declutter_cart_items;
CREATE TRIGGER declutter_cart_item_keep_title
  BEFORE INSERT OR UPDATE OF item_id, status ON public.declutter_cart_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_cart_item_keep_title();

UPDATE public.declutter_cart_items c
   SET item_title = i.title
  FROM public.declutter_items i
 WHERE i.id = c.item_id AND c.item_title IS NULL;

-- DC-18: restated from 20261030064929 (= prod + DB-5's source column); + kept title, + closed_at.
DROP FUNCTION IF EXISTS public.declutter_my_cart();
CREATE OR REPLACE FUNCTION public.declutter_my_cart()
 RETURNS TABLE(line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid, price_cents integer, status text, checkout_by timestamp with time zone, order_id uuid, order_status text, handover text, premium_cents integer, total_cents integer, porch_ok boolean, delivery_cents integer, delivery_task_id uuid, handovers text[], closed_at timestamp with time zone, source text)
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
         c.source  -- DB-5
    FROM public.declutter_cart_items c
    LEFT JOIN public.declutter_items i ON i.id = c.item_id
    LEFT JOIN public.declutter_orders o ON o.id = c.order_id
    LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id
   WHERE (c.buyer_id = v_uid OR c.seller_id = v_uid)
     AND (c.status = 'in_cart' OR c.created_at > now() - interval '30 days')
   ORDER BY (c.status = 'in_cart') DESC, c.checkout_by
   LIMIT 200;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_my_cart() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_cart() TO authenticated, service_role;
