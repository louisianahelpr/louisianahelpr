-- Add missing index on ops_alert_admin_subjects.user_id flagged by Supabase performance advisor.
-- The FK ops_alert_admin_subjects_user_id_fkey had no covering index.
CREATE INDEX IF NOT EXISTS idx_ops_alert_admin_subjects_user_id
    ON public.ops_alert_admin_subjects (user_id);
