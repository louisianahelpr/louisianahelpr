-- The Supabase PERFORMANCE advisor's exact baseline (scripts/ci/performance-advisor-baseline.json,
-- Q1321) holds unindexed_foreign_keys at zero. db-drift-detect 43628190189 (2026-11-14 18:43Z, nightly-red
-- #4415, Q1816) read it at 1; pg_constraint on prod (2026-11-15 ~17:40Z, read-only) names the one key
-- without a covering index: shop_photo_byte_checks.owner_id -> auth.users (ON DELETE CASCADE), from
-- 20261112095000_shops_photo_byte_check (its primary key is storage_path).
-- Without an index, deleting an account scans the whole table.
-- Index only: no RLS, grant, function or data change. Replay-safe (IF NOT EXISTS, and skipped when a
-- later migration has dropped the table).
DO $idx$
BEGIN
  IF to_regclass('public.shop_photo_byte_checks') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS shop_photo_byte_checks_owner_id_idx ON public.shop_photo_byte_checks (owner_id);
  END IF;
END
$idx$;
