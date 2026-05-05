-- Supabase performance advisor flagged 12 foreign keys without covering
-- indexes. Without these, every JOIN on the FK column or DELETE CASCADE
-- triggers a full table scan to find dependent rows. Adds them all.
CREATE INDEX IF NOT EXISTS idx_fraud_flags_job_id ON public.fraud_flags(job_id);
CREATE INDEX IF NOT EXISTS idx_helper_verifications_changed_by ON public.helper_verifications(changed_by);
CREATE INDEX IF NOT EXISTS idx_job_checkins_job_id ON public.job_checkins(job_id);
CREATE INDEX IF NOT EXISTS idx_job_tracking_job_id ON public.job_tracking(job_id);
CREATE INDEX IF NOT EXISTS idx_payout_transfers_initiated_by_user_id ON public.payout_transfers(initiated_by_user_id);
CREATE INDEX IF NOT EXISTS idx_platform_settings_updated_by ON public.platform_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_referral_credits_referral_code_id ON public.referral_credits(referral_code_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referral_code_id ON public.referrals(referral_code_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id ON public.reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_saved_jobs_job_id ON public.saved_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_tips_job_id ON public.tips(job_id);
CREATE INDEX IF NOT EXISTS idx_user_violations_job_id ON public.user_violations(job_id);
