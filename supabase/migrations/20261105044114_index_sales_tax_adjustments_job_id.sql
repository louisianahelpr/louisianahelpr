-- The Supabase PERFORMANCE advisor's exact baseline (scripts/ci/performance-advisor-baseline.json,
-- Q1321) holds unindexed_foreign_keys at zero. db-drift-detect 41968943315 (2026-11-05 04:37Z, right
-- after l80 deployed) read it at 1: get_advisors (performance) at 04:40Z names
-- sales_tax_adjustments_job_id_fkey, the job_id -> jobs key 20261105021744_sales_tax_adjustments adds
-- (ON DELETE SET NULL) without a covering index. Without one, deleting a job scans the whole ledger
-- to null its rows. Index only: no RLS, grant, function or data change (Q1816, nightly-red #3743).
CREATE INDEX IF NOT EXISTS sales_tax_adjustments_job_id_idx ON public.sales_tax_adjustments (job_id);
