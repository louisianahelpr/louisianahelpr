-- DECLUTTER, owner row 70 (2026-10-14): the highest price per item is $1,000
-- (100000 cents). It was $10,000 (build decision B3, a sanity cap). The floor,
-- every offer and counter, and every cart line sit within it; the evening
-- price drops only ever lower a price, so they stay within it too.
--
-- The server's only price limit was the table CHECKs (the create / edit RPCs
-- check floor <= price and leave the range to the table), so the cap is
-- enforced by replacing those CHECKs; no RPC can store a higher price.
--
-- EXISTING ROWS (owner: "existing listings can't exceed it"): a listing still
-- with its seller (draft, pending review, live, or already off sale) whose
-- price is over the cap is brought down to it (floor too, never above the
-- price) and a pending or live one is taken down for the seller to look at
-- again, with a notice. A sale already agreed (reserved / sold / completed),
-- a cart line or an offer over the cap is NOT changed silently: the migration
-- stops with an error naming how many, for a person to settle. Declutter has
-- never been switched on, so on prod these tables were empty when this was
-- written; the guard is there so a surprise is loud, never a quiet rewrite of
-- money.
--
-- Replay-safe: constraints dropped IF EXISTS and re-added; the clamp only
-- touches rows still over the cap. Proof: src/test/pglite/declutterPriceCap.pglite.mjs (3x).

DO $do$
DECLARE
  v_cap constant integer := 100000;
  v_bad integer;
  r record;
BEGIN
  -- 1. Agreed sales, cart lines and offers over the cap: stop, never rewrite.
  SELECT (SELECT count(*) FROM public.declutter_items WHERE status IN ('reserved', 'sold', 'completed') AND price_cents > v_cap)
       + (SELECT count(*) FROM public.declutter_cart_items WHERE price_cents > v_cap)
       + (SELECT count(*) FROM public.declutter_offers WHERE amount_cents > v_cap)
       + (SELECT count(*) FROM public.declutter_offer_events WHERE amount_cents > v_cap)
    INTO v_bad;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'declutter_price_cap: % agreed sale / cart / offer row(s) are above $1,000; settle them by hand first', v_bad;
  END IF;

  -- 2. Listings still with their seller: take down a pending / live one, tell
  --    the seller, then bring every over-cap listing down to the cap.
  FOR r IN
    UPDATE public.declutter_items
       SET status = 'withdrawn', updated_at = now()
     WHERE price_cents > v_cap AND status IN ('pending_review', 'live')
    RETURNING id, seller_id, title
  LOOP
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (r.seller_id, 'info', 'Listing taken down: price over $1,000',
            format('"%s" was priced over $1,000, the most an item can sell for on Declutter. It was taken down; list it again at $1,000 or less.', r.title),
            '/declutter');
  END LOOP;
  UPDATE public.declutter_item_private p
     SET floor_price_cents = least(p.floor_price_cents, v_cap)
   WHERE p.floor_price_cents > v_cap;
  UPDATE public.declutter_items
     SET current_price_cents = least(current_price_cents, v_cap),
         price_cents = least(price_cents, v_cap),
         updated_at = now()
   WHERE price_cents > v_cap OR current_price_cents > v_cap;
END
$do$;

-- 3. The cap itself (column CHECKs were auto-named <table>_<column>_check).
ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_price_cents_check;
ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_price_cap;
ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_price_cap CHECK (price_cents BETWEEN 100 AND 100000);
ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_current_price_cents_check;
ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_current_price_cap;
ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_current_price_cap CHECK (current_price_cents BETWEEN 100 AND 100000);
ALTER TABLE public.declutter_item_private DROP CONSTRAINT IF EXISTS declutter_item_private_floor_price_cents_check;
ALTER TABLE public.declutter_item_private DROP CONSTRAINT IF EXISTS declutter_item_private_floor_cap;
ALTER TABLE public.declutter_item_private ADD CONSTRAINT declutter_item_private_floor_cap CHECK (floor_price_cents BETWEEN 100 AND 100000);
ALTER TABLE public.declutter_offers DROP CONSTRAINT IF EXISTS declutter_offers_amount_cents_check;
ALTER TABLE public.declutter_offers DROP CONSTRAINT IF EXISTS declutter_offers_amount_cap;
ALTER TABLE public.declutter_offers ADD CONSTRAINT declutter_offers_amount_cap CHECK (amount_cents BETWEEN 100 AND 100000);
ALTER TABLE public.declutter_offer_events DROP CONSTRAINT IF EXISTS declutter_offer_events_amount_cents_check;
ALTER TABLE public.declutter_offer_events DROP CONSTRAINT IF EXISTS declutter_offer_events_amount_cap;
ALTER TABLE public.declutter_offer_events ADD CONSTRAINT declutter_offer_events_amount_cap
  CHECK (amount_cents IS NULL OR amount_cents BETWEEN 100 AND 100000);
ALTER TABLE public.declutter_cart_items DROP CONSTRAINT IF EXISTS declutter_cart_items_price_cents_check;
ALTER TABLE public.declutter_cart_items DROP CONSTRAINT IF EXISTS declutter_cart_items_price_cap;
ALTER TABLE public.declutter_cart_items ADD CONSTRAINT declutter_cart_items_price_cap CHECK (price_cents BETWEEN 100 AND 100000);
