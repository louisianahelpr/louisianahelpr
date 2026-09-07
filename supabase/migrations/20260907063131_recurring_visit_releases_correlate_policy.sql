-- AR-012 — the recurring-visit release policy never referenced the row being
-- inserted, so it refused everyone.
--
-- As shipped:
--
--   WITH CHECK (helper_id = auth.uid() AND EXISTS (
--     SELECT 1 FROM jobs j
--      WHERE j.id = j.parent_job_id
--        AND j.recurring_helper_id = auth.uid()))
--
-- Both `jobs` and `recurring_visit_releases` have a `parent_job_id`, so inside
-- that subquery `j.parent_job_id` binds to JOBS — not to the row being
-- inserted. The predicate therefore asks "does a job exist that is its own
-- parent?", which mentions the new row nowhere and is answered by
--
--   SELECT count(*) FROM jobs WHERE id = parent_job_id;   -- 0 in prod
--
-- so it is permanently false. The intended predicate was
-- `j.id = recurring_visit_releases.parent_job_id`.
--
-- This is the failure mode that hides: it parses, it names plausible columns,
-- it reads exactly like the ownership check it was meant to be, and it fails
-- CLOSED — so it raised no alarm, logged nothing, and simply meant the feature
-- has never worked for anybody. `SELECT count(*) FROM recurring_visit_releases`
-- returns 0: the table has not been written once since it shipped.
--
-- Proved against prod 2026-09-06 as the legitimate assigned recurring helper,
-- on their own series, inside a rolled-back transaction:
--
--   PROBE >> INSERT BLOCKED: new row violates row-level security policy
--            for table "recurring_visit_releases"
--
-- Fix is the correlation and nothing else. Note in passing, deliberately NOT
-- changed here: the DELETE policy requires `visit_date > CURRENT_DATE` and the
-- INSERT does not, so a helper may release a date already past. That is
-- harmless (the visit is gone either way) and tightening it is a product call,
-- not part of closing this hole.

DO $$
BEGIN
  IF to_regclass('public.recurring_visit_releases') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Helper releases their own visit dates"
    ON public.recurring_visit_releases;

  CREATE POLICY "Helper releases their own visit dates"
    ON public.recurring_visit_releases
    FOR INSERT
    TO authenticated
    WITH CHECK (
      helper_id = (SELECT auth.uid())
      AND EXISTS (
        SELECT 1
          FROM public.jobs j
         -- Correlated to the inserted row. `recurring_visit_releases` is
         -- spelled out rather than aliased precisely because an alias is what
         -- let `j.parent_job_id` shadow it last time.
         WHERE j.id = recurring_visit_releases.parent_job_id
           AND j.recurring_helper_id = (SELECT auth.uid())
      )
    );

  -- The SELECT policy beside it carries the IDENTICAL bug, in its poster
  -- branch:
  --
  --   (helper_id = auth.uid()) OR EXISTS (
  --     SELECT 1 FROM jobs j
  --      WHERE j.id = j.parent_job_id AND j.customer_id = auth.uid())
  --
  -- Same alias, same shadow, same permanently-false branch. Fixing only the
  -- INSERT would have left the feature half-dead in a way the "one policy
  -- after three applies" check could never surface: the helper would write a
  -- release and read it back through the first branch, while the POSTER — the
  -- person the release exists to inform — still saw nothing. Two bugs from one
  -- copy-paste get fixed by one migration.
  DROP POLICY IF EXISTS "Series participants read releases"
    ON public.recurring_visit_releases;

  CREATE POLICY "Series participants read releases"
    ON public.recurring_visit_releases
    FOR SELECT
    TO authenticated
    USING (
      helper_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1
          FROM public.jobs j
         WHERE j.id = recurring_visit_releases.parent_job_id
           AND j.customer_id = (SELECT auth.uid())
      )
    );
END $$;
