-- Q1816 (db-drift-detect, nightly-red #4149, run 42105316708): the Supabase performance advisor read
-- no_primary_key 1, a class scripts/ci/performance-advisor-baseline.json does not name, so the nightly check went red.
-- The table is public.declutter_item_views (20261105163501, the owner's item views, 11-05): it has two partial
-- UNIQUE indexes (one row per member, one per guest device) but no primary key. Measured read-only on prod 11-05
-- ~5:20 PM CT: it is the only table in public with no primary key (pg_class x pg_constraint contype 'p').
--
-- Fix: the same shape as 20261105030137 gave declutter_item_price_drops, an identity id column and a primary key on
-- it. Nothing else changes: the two SECURITY DEFINER functions name their INSERT columns (item_id, viewer_id /
-- item_id, device_id) and read only item_id, so the new column fills itself; RLS stays on with no client grant;
-- the table's grants are untouched (service_role only).
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS, and the primary key only when the table has none, so a second and a
-- third run do nothing. The table exists from 20261105163501, older than this file.
-- PGlite proof: src/test/pglite/declutterItemViews.pglite.mjs applies this file too (NEW_PK).

ALTER TABLE public.declutter_item_views ADD COLUMN IF NOT EXISTS id bigint GENERATED ALWAYS AS IDENTITY;
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.declutter_item_views'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.declutter_item_views ADD CONSTRAINT declutter_item_views_pkey PRIMARY KEY (id);
  END IF;
END
$do$;
