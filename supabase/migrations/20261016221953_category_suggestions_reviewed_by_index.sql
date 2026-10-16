-- category_suggestions.reviewed_by (20261015051141) is a foreign key to
-- auth.users with no index, flagged by the Supabase performance advisor
-- (unindexed_foreign_keys). Deleting a staff account then scans the whole
-- table to SET NULL the rows that staff member reviewed. This adds the index.
--
-- From PR #3150, whose file carried the hand-typed version 20261015120000;
-- re-created with `npm run migration:new` (CLAUDE.md: never hand-type a
-- migration timestamp).
--
-- REPLAY-SAFETY: the table is created by the older 20261015051141, so it
-- exists whenever this runs; IF NOT EXISTS makes a second run a no-op.
CREATE INDEX IF NOT EXISTS idx_category_suggestions_reviewed_by
  ON public.category_suggestions (reviewed_by);
