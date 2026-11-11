-- Audit 11-10 F356 (owner pop-up 11-11 ~4:35 PM, OWNER-DECISIONS.md): the seller's offer card never said who made the
-- offer. Sellers now see the buyer as first name + last initial ("Ann S. offered $40"): no photo, no profile link,
-- no id, nothing else (Q2274: declutter_my_offers still returns no counterparty id).
--   buyer_display  member_display_name(the buyer's full_name), on the SELLER's row only. NULL on the buyer's own row,
--                  NULL when the buyer's account is gone, and NULL on a seller's answer to a Wanted post
--                  (o.wanted_id set): that buyer is the Wanted poster, whose name the seller is not otherwise shown
--                  (Wanted-post privacy kept, as the owner said).
--
-- Restated from the NEWEST definition, 20261101175510_declutter_buying_lists_hide_seed.sql; only the new OUT column
-- and the profiles join are added. A new OUT column cannot be added by CREATE OR REPLACE, so the function is dropped
-- and created again, grants restated by role name. Replay-safe (DROP IF EXISTS + CREATE).
--
-- Proof: src/test/pglite/declutterMyOffersBuyerDisplay.pglite.mjs. Guard: src/test/declutterMyOffersFromWanted.test.ts.
-- Sensitive: authz (what a member sees of another member).

DROP FUNCTION IF EXISTS public.declutter_my_offers();
CREATE FUNCTION public.declutter_my_offers()
RETURNS TABLE (offer_id uuid, item_id uuid, item_title text, my_side text, amount_cents integer,
               awaiting text, status text, respond_by timestamptz, counter_count integer,
               current_price_cents integer, floor_price_cents integer, updated_at timestamptz,
               from_wanted boolean, open_wanted_id uuid, buyer_display text)
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
         w.id,
         CASE WHEN o.seller_id = v_uid AND o.buyer_id IS DISTINCT FROM v_uid AND o.wanted_id IS NULL AND bp.user_id IS NOT NULL
              THEN public.member_display_name(bp.full_name) END
    FROM public.declutter_offers o
    JOIN public.declutter_items i ON i.id = o.item_id
    LEFT JOIN public.declutter_item_private p ON p.item_id = o.item_id
    LEFT JOIN public.declutter_wanted w
           ON w.id = o.wanted_id AND w.user_id = v_uid AND o.buyer_id = v_uid AND w.status = 'open'
    LEFT JOIN public.profiles bp ON bp.user_id = o.buyer_id
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
