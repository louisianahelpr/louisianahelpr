-- The Supabase PERFORMANCE advisor's exact baseline (scripts/ci/performance-advisor-baseline.json,
-- Q1321) holds unindexed_foreign_keys at zero. db-drift-detect 42716534692 (2026-11-09 22:59Z) read it
-- at 4; pg_constraint on prod at ~23:45Z names the same 4 keys without a covering index:
--   shop_custom_requests.order_id -> shop_orders (ON DELETE SET NULL) and .subtype -> shop_item_subtypes,
--     both from 20261106205852_shops_custom_order_accept;
--   declutter_funnel_events.item_id -> declutter_items and .order_id -> declutter_orders (ON DELETE SET
--     NULL), both from 20261108203450_declutter_buy_funnel_events.
-- Without an index, deleting an order, item or subtype scans the whole referencing table.
-- Index only: no RLS, grant, function or data change. Replay-safe (IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS shop_custom_requests_order_id_idx ON public.shop_custom_requests (order_id);
CREATE INDEX IF NOT EXISTS shop_custom_requests_subtype_idx ON public.shop_custom_requests (subtype);
CREATE INDEX IF NOT EXISTS declutter_funnel_events_item_id_idx ON public.declutter_funnel_events (item_id);
CREATE INDEX IF NOT EXISTS declutter_funnel_events_order_id_idx ON public.declutter_funnel_events (order_id);
