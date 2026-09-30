-- Missing indexes on foreign key columns flagged by Supabase performance advisor 2026-09-30.
-- All three are unindexed FK columns that can cause seq-scans on joins.

CREATE INDEX IF NOT EXISTS idx_crew_dispute_member_outcomes_decided_by
  ON public.crew_dispute_member_outcomes (decided_by);

CREATE INDEX IF NOT EXISTS idx_job_schedule_change_requests_requested_by
  ON public.job_schedule_change_requests (requested_by);

CREATE INDEX IF NOT EXISTS idx_recurring_visit_payments_child_job_id
  ON public.recurring_visit_payments (child_job_id);
