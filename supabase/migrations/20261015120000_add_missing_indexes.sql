-- Add index on category_suggestions.reviewed_by FK flagged by Supabase performance advisor (unindexed_foreign_keys).
CREATE INDEX IF NOT EXISTS idx_category_suggestions_reviewed_by
  ON public.category_suggestions (reviewed_by);
