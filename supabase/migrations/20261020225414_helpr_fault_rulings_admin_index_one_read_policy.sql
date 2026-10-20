-- J4 Helpr-at-fault rulings (20261019015301) shipped two findings the Supabase
-- PERFORMANCE advisor's exact baseline (scripts/ci/performance-advisor-baseline.json,
-- Q1321) does not allow, and db-drift-detect went red on both (run
-- 39470586725, 2026-10-20; get_advisors (performance) on prod read the same
-- two at 22:52Z):
--
-- 1. unindexed_foreign_keys (a class the baseline holds at zero):
--    job_helpr_fault_rulings.admin_id -> auth.users ON DELETE SET NULL has no
--    covering index, so deleting an admin's account scans the whole table.
--    Fixed with job_helpr_fault_rulings_admin_idx (named in the baseline's
--    unused_index set in this same change: an index is "unused" until traffic
--    first scans it).
--
-- 2. multiple_permissive_policies (31 -> 32): two permissive SELECT policies
--    for authenticated, "the Helpr reads own" and "admins read". Restated as
--    ONE read policy whose USING is the two conditions OR'd, verbatim, so
--    exactly the same rows stay readable by exactly the same callers (the
--    precedent is 20261012193325_fold_redundant_permissive_policies). The
--    column grant (no admin_id, note or refund_ref for authenticated) is
--    untouched.
--
-- REPLAY-SAFETY: the table comes from an EARLIER migration (20261019015301);
-- CREATE INDEX IF NOT EXISTS and DROP POLICY IF EXISTS / CREATE POLICY make a
-- second and third run a no-op.

CREATE INDEX IF NOT EXISTS job_helpr_fault_rulings_admin_idx
  ON public.job_helpr_fault_rulings (admin_id);

DROP POLICY IF EXISTS "helpr fault rulings: the Helpr reads own" ON public.job_helpr_fault_rulings;
DROP POLICY IF EXISTS "helpr fault rulings: admins read" ON public.job_helpr_fault_rulings;
DROP POLICY IF EXISTS "helpr fault rulings: the Helpr or an admin reads" ON public.job_helpr_fault_rulings;
CREATE POLICY "helpr fault rulings: the Helpr or an admin reads" ON public.job_helpr_fault_rulings
  FOR SELECT TO authenticated
  USING (
    helper_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );
