-- Add missing indexes on foreign key columns flagged by Supabase performance advisor.
-- All statements are guarded with IF NOT EXISTS for replay-safety.

CREATE INDEX IF NOT EXISTS idx_marketing_content_created_by
  ON public.marketing_content (created_by);

CREATE INDEX IF NOT EXISTS idx_marketing_settings_updated_by
  ON public.marketing_settings (updated_by);

CREATE INDEX IF NOT EXISTS idx_subscription_cancel_reasons_user_id
  ON public.subscription_cancel_reasons (user_id);

CREATE INDEX IF NOT EXISTS idx_thread_archives_job_id
  ON public.thread_archives (job_id);

CREATE INDEX IF NOT EXISTS idx_thread_archives_other_user_id
  ON public.thread_archives (other_user_id);
