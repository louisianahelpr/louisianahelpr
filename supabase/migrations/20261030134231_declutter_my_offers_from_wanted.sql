-- Audit 1d D4-3 (2026-10-29, shot ~/.lh-shots/app-audit-1028/1d-gaps/1d-wmatch-1440-p2-1440.png): a seller's answer to
-- a buyer's Wanted post is stored as a seller "counter" (declutter_offers.wanted_id set, counter_count 1). Buying ->
-- Your offers showed it as "$12 their counter · Your turn to answer" with "Take back my offer", for an offer the buyer
-- never made. The list now says which offers answer a Wanted post (from_wanted), so the card can say "Reply to your
-- Wanted" and drop "Take back my offer" while the buyer is the one to answer.
--
-- Restated from PROD's effective body (pg_get_functiondef on fncmgoasalhdgfwzhsqa, 2026-10-30, md5
-- 69d6c3e4fcb091f455a9107a8e948407 = 20261014224914_declutter_slice3b_payments.sql's body), with one column added at
-- the end. Only a yes/no leaves the function: never the Wanted post's id, words or poster (the W-spec keeps a Wanted
-- private to its poster; the buyer is that poster, the seller already answered it).
--
-- A new OUT column changes the row type, so the function is dropped and created again (CREATE OR REPLACE cannot).
-- Nothing else in the database calls declutter_my_offers (grep of supabase/migrations and supabase/functions,
-- 2026-10-30); the app reads it through src/lib/declutter/api.ts fetchMyOffers, which reads the new column as optional.
--
-- REPLAY-SAFETY: DROP FUNCTION IF EXISTS + CREATE; the grants are restated after.
DROP FUNCTION IF EXISTS public.declutter_my_offers();

CREATE FUNCTION public.declutter_my_offers()
RETURNS TABLE (offer_id uuid, item_id uuid, item_title text, my_side text, amount_cents integer,
               awaiting text, status text, respond_by timestamptz, counter_count integer,
               current_price_cents integer, floor_price_cents integer, updated_at timestamptz,
               from_wanted boolean)
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
         (o.wanted_id IS NOT NULL)
    FROM public.declutter_offers o
    JOIN public.declutter_items i ON i.id = o.item_id
    LEFT JOIN public.declutter_item_private p ON p.item_id = o.item_id
   WHERE (o.buyer_id = v_uid OR o.seller_id = v_uid)
     AND (o.status = 'open' OR o.updated_at > now() - interval '30 days')
   ORDER BY (o.status = 'open') DESC, o.updated_at DESC
   LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_offers() TO authenticated, service_role;
