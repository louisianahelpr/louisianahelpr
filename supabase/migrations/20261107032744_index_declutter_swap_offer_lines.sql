-- The Supabase PERFORMANCE advisor's exact baseline (scripts/ci/performance-advisor-baseline.json,
-- Q1321) holds unindexed_foreign_keys at zero. db-drift-detect 42333880707 (2026-11-07 03:25Z) read it
-- at 2: pg_constraint on prod the same hour names declutter_swap_offers_buyer_line_id_fkey and
-- declutter_swap_offers_seller_line_id_fkey, the two -> declutter_cart_items keys
-- 20261106163703_declutter_trades adds (ON DELETE SET NULL) without a covering index. Without one,
-- deleting a cart line scans every swap offer to null its rows. Index only: no RLS, grant, function or
-- data change (Q1816).
CREATE INDEX IF NOT EXISTS declutter_swap_offers_buyer_line_id_idx ON public.declutter_swap_offers (buyer_line_id);
CREATE INDEX IF NOT EXISTS declutter_swap_offers_seller_line_id_idx ON public.declutter_swap_offers (seller_line_id);
