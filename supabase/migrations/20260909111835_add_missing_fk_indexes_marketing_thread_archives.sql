-- Add missing indexes on foreign key columns flagged by the Supabase performance advisor.
-- All indexes use IF NOT EXISTS for replay-safety.

CREATE INDEX IF NOT EXISTS idx_marketing_content_created_by
  ON public.marketing_content (created_by);

CREATE INDEX IF NOT EXISTS idx_marketing_settings_updated_by
  ON public.marketing_settings (updated_by);

CREATE INDEX IF NOT EXISTS idx_thread_archives_job_id
  ON public.thread_archives (job_id);

CREATE INDEX IF NOT EXISTS idx_thread_archives_other_user_id
  ON public.thread_archives (other_user_id);
