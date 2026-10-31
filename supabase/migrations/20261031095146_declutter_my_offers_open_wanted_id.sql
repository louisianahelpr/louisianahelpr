-- BUY-29 (buying audit 10-30 #29; lead decision 10-31 04:55): after a buyer accepts a seller's reply to their Wanted
-- post, the post stayed open and kept matching new listings. The owner prefers asking over silent changes, so the card
-- asks "Close your Wanted post?" right after the accept. To ask, the app needs the post's id: the list now gives the
-- buyer (the post's poster) the id of the still-open Wanted post an offer answers.
--
-- Restated from origin/main's NEWEST CREATE, 20261030134231_declutter_my_offers_from_wanted.sql (newest file on
-- origin/main naming FUNCTION public.declutter_my_offers, read 2026-10-31; no newer restatement on wip/b75-1031),
-- with one column added at the end and one LEFT JOIN. Every earlier column and row is unchanged.
--
-- Privacy: open_wanted_id is set only on the poster's own row (buyer_id = caller AND the post's user_id = caller) and
-- only while the post is open. The seller who answered never gets it, as before (20261030134231 kept the id inside).
--
-- A new OUT column changes the row type, so the function is dropped and created again (CREATE OR REPLACE cannot).
-- Nothing else in the database calls declutter_my_offers (grep of supabase/migrations and supabase/functions,
-- 2026-10-31); the app reads it through src/lib/declutter/api.ts fetchMyOffers, which reads the new column as optional.
--
-- REPLAY-SAFETY: DROP FUNCTION IF EXISTS + CREATE; the grants are restated after.
DROP FUNCTION IF EXISTS public.declutter_my_offers();

CREATE FUNCTION public.declutter_my_offers()
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
   ORDER BY (o.status = 'open') DESC, o.updated_at DESC
   LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_offers() TO authenticated, service_role;
