-- Missing indexes on foreign key columns flagged by Supabase performance advisor.
-- Both columns reference auth.users and appear in join/filter paths.
CREATE INDEX IF NOT EXISTS idx_jobs_recurring_helper_id
    ON public.jobs (recurring_helper_id);

CREATE INDEX IF NOT EXISTS idx_recurring_visit_releases_helper_id
    ON public.recurring_visit_releases (helper_id);
