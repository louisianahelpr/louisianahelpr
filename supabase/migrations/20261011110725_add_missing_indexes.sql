-- Add missing indexes on foreign key columns flagged by Supabase performance advisor (2026-10-11).
-- All indexes use CREATE INDEX IF NOT EXISTS for replay-safety.

CREATE INDEX IF NOT EXISTS backout_notices_job_id_idx
  ON public.backout_notices (job_id);

CREATE INDEX IF NOT EXISTS ban_settlement_queue_decided_by_idx
  ON public.ban_settlement_queue (decided_by);

CREATE INDEX IF NOT EXISTS crew_dispute_member_outcomes_helper_id_idx
  ON public.crew_dispute_member_outcomes (helper_id);

CREATE INDEX IF NOT EXISTS job_detail_change_requests_requested_by_idx
  ON public.job_detail_change_requests (requested_by);

CREATE INDEX IF NOT EXISTS payout_holds_denied_by_idx
  ON public.payout_holds (denied_by);

CREATE INDEX IF NOT EXISTS payout_holds_held_by_idx
  ON public.payout_holds (held_by);

CREATE INDEX IF NOT EXISTS payout_schedule_freezes_requested_by_idx
  ON public.payout_schedule_freezes (requested_by);

CREATE INDEX IF NOT EXISTS pre_verification_wipes_user_id_idx
  ON public.pre_verification_wipes (user_id);

CREATE INDEX IF NOT EXISTS recurring_visit_payments_helper_id_idx
  ON public.recurring_visit_payments (helper_id);
