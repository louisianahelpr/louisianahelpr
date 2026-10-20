-- Declutter seed boundary (Cowork design audit 2026-10-20, item D1).
--
-- Measured on prod 2026-10-20 03:40Z: every 'live' declutter_items row (5) and
-- every 'pending_review' one (4) belongs to a test account ("Fixture rocking
-- chair [E2E-PRODAUDIT]", "Payout proof lamp"), all is_seed = true, and the
-- owner (an admin, not a test account) saw them on Browse. The items read
-- policy asked the 'declutter' switch and the banned-seller rule but never the
-- launch switch that hides test rows from discovery everywhere else
-- (open_jobs_browse: `NOT is_seed OR NOT seed_hidden_in_discovery()`).
--
-- Every Declutter read path a buyer has is this one table under RLS: Browse
-- (fetchLiveItems), the item page (fetchItem), "More from this seller"
-- (fetchSellerItems), "Similar items" (fetchSimilarItems), the moving-sale
-- page, the search box (it filters the Browse rows client-side), and the
-- photos (their policy is EXISTS over this table, so it inherits). One clause
-- here covers all of them.
--
-- Kept: the seller always reads their own listings (first branch); a test
-- account still sees test listings (seed_hidden_in_discovery's carve-out, so
-- the nightly two-account journeys keep working); with the launch switch off
-- nothing changes. Admins are NOT carved out, same as jobs discovery: the
-- owner browses as an admin and must see what the public sees. The admin
-- review queue reads through declutter_admin_pending_items (SECURITY DEFINER),
-- not this policy, so it is unaffected.
--
-- Replay-safe: DROP POLICY IF EXISTS + CREATE. Guard:
-- src/test/declutterSeedBoundary.test.ts. PGlite proof:
-- src/test/pglite/declutterSeedBoundary.pglite.mjs (applied 3x).

DROP POLICY IF EXISTS "declutter items: seller or switched-on members read live" ON public.declutter_items;
CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items
  FOR SELECT TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    OR (status IN ('live', 'reserved')
        AND (SELECT public.feature_enabled_for('declutter'))
        AND NOT public.declutter_seller_hidden(seller_id)
        AND (NOT is_seed OR NOT (SELECT public.seed_hidden_in_discovery())))
  );
