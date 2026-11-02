-- Q1888 (lh-authz-rls re-review 2026-10-16): a member in a block with a seller (either direction) still read that
-- seller's live Declutter listings through the items read policy, and so learned the seller has a moving sale.
--
-- 1. public.declutter_my_block_partners(): the ids of every member in a block with the caller, either direction,
--    as one uuid[]. SECURITY DEFINER because user_blocks' own policy lets a member read only the rows they wrote,
--    so a blocked member could not see that the seller blocked them. Answers only for auth.uid() (no argument, so it
--    cannot be asked about anyone else); empty for anon or a caller with no blocks.
-- 2. Items read policy: restated from 20261030080020_declutter_buyer_reads_own_item.sql (the newest; equal to the
--    live pg_policies qual read 2026-11-01 ~8:45 PM CST) with ONE added condition on the browse branch only:
--    NOT (seller_id = ANY (coalesce((SELECT public.declutter_my_block_partners()), '{}'))). The sub-select is an initplan, run once
--    per query, not per row. The seller's own branch and the paid-buyer branch are unchanged: a buyer who already
--    paid keeps reading the item they bought (their order history), block or not.
-- Proof: src/test/pglite/declutterItemsHiddenFromBlocked.pglite.mjs (applied 3x).
-- REPLAY-SAFETY: CREATE OR REPLACE FUNCTION (new, same signature on replay); DROP POLICY IF EXISTS + CREATE POLICY.

CREATE OR REPLACE FUNCTION public.declutter_my_block_partners()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT coalesce(array_agg(DISTINCT CASE WHEN b.blocker_id = (SELECT auth.uid()) THEN b.blocked_id ELSE b.blocker_id END),
                  '{}'::uuid[])
    FROM public.user_blocks b
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND (b.blocker_id = (SELECT auth.uid()) OR b.blocked_id = (SELECT auth.uid()));
$fn$;

REVOKE ALL ON FUNCTION public.declutter_my_block_partners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_block_partners() TO authenticated, service_role;

DROP POLICY IF EXISTS "declutter items: seller or switched-on members read live" ON public.declutter_items;
CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items
  FOR SELECT TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    OR (status IN ('live', 'reserved')
        AND (SELECT public.feature_enabled_for('declutter'))
        AND NOT seller_hidden
        AND (NOT is_seed OR NOT (SELECT public.seed_hidden_in_discovery()))
        AND NOT (seller_id = ANY (coalesce((SELECT public.declutter_my_block_partners()), '{}'::uuid[]))))
    OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                WHERE c.item_id = declutter_items.id
                  AND c.buyer_id = (SELECT auth.uid())
                  AND c.status = 'paid')
  );
