-- category_suggestions.reviewed_by is a foreign key to the reviewing admin
-- with no index on it (Supabase performance advisor, unindexed_foreign_keys):
-- deleting or re-keying a referenced profile, and any lookup by reviewer,
-- scans the whole table. Measured on prod 2026-10-17 20:55Z: the table has no
-- index on reviewed_by and idx_category_suggestions_reviewed_by does not
-- exist. Re-created from PR #3150, whose migration carried a hand-typed
-- timestamp (20261015120000); this one comes from `npm run migration:new`.
--
-- REPLAY-SAFETY: DDL only, IF NOT EXISTS, and skipped when the table is not
-- there yet, so it runs any number of times on any rebuild.
DO $$
BEGIN
  IF to_regclass('public.category_suggestions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_category_suggestions_reviewed_by
      ON public.category_suggestions (reviewed_by);
  END IF;
END
$$;
