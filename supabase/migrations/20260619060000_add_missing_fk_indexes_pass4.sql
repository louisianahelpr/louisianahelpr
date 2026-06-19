-- Adds indexes on unindexed foreign-key columns flagged by the Supabase
-- performance advisor (2026-06-19 run). Missing FK indexes cause seq scans on
-- child tables whenever the parent row is updated or deleted.
-- All statements use IF NOT EXISTS so this migration is replay-safe.

create index if not exists idx_home_maintenance_reminders_last_job_id
  on public.home_maintenance_reminders (last_job_id);

create index if not exists idx_job_boosts_boosted_by
  on public.job_boosts (boosted_by);

create index if not exists idx_job_views_viewer_id
  on public.job_views (viewer_id);

create index if not exists idx_partner_applications_reviewed_by
  on public.partner_applications (reviewed_by);

create index if not exists idx_profile_views_viewer_user_id
  on public.profile_views (viewer_user_id);

create index if not exists idx_time_credits_job_id
  on public.time_credits (job_id);

create index if not exists idx_worker_protection_credits_job_id
  on public.worker_protection_credits (job_id);
