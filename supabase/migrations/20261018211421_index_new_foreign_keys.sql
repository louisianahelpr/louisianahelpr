-- Five foreign keys added by the declutter, rentals, quotes and shops
-- migrations of 2026-10-15..18 shipped without a covering index, so the
-- Supabase performance advisor's unindexed_foreign_keys lint (a class the
-- exact baseline scripts/ci/performance-advisor-baseline.json holds at zero)
-- turned db-drift-detect red (nightly-red #3154; run 39049204801 saw 2,
-- get_advisors on 2026-10-18 21:13Z saw 5):
--   declutter_order_jobs.seller_fault_refund_id -> declutter_refunds  (20261017073146)
--   job_quote_requests.job_id                   -> jobs               (20261015091114)
--   maintenance_requests.visit_job_id           -> jobs               (20261017221621)
--   shop_strikes.order_id                       -> shop_orders        (20261018164444)
--   shop_strikes.removed_by                     -> auth.users         (20261018164444)
-- Each is ON DELETE SET NULL or CASCADE: deleting the parent row (a job, a
-- refund, an order, a user) scans the child table for matches without one.
-- The new names are listed in the baseline's unused_index set in this same
-- change (an index is "unused" until traffic first scans it).
--
-- REPLAY-SAFETY: every table/column here comes from an EARLIER migration;
-- CREATE INDEX IF NOT EXISTS makes a second and third run a no-op.

CREATE INDEX IF NOT EXISTS declutter_order_jobs_seller_fault_refund_idx
  ON public.declutter_order_jobs (seller_fault_refund_id);

CREATE INDEX IF NOT EXISTS job_quote_requests_job_idx
  ON public.job_quote_requests (job_id);

CREATE INDEX IF NOT EXISTS maintenance_requests_visit_job_idx
  ON public.maintenance_requests (visit_job_id);

CREATE INDEX IF NOT EXISTS shop_strikes_order_idx
  ON public.shop_strikes (order_id);

CREATE INDEX IF NOT EXISTS shop_strikes_removed_by_idx
  ON public.shop_strikes (removed_by);
