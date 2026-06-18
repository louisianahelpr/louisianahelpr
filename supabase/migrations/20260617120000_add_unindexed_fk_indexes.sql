-- 29 foreign-key columns flagged by the Supabase performance advisor
-- (unindexed_foreign_keys). Without covering indexes these columns force
-- a sequential scan on every JOIN, cascade-delete check, and FK lookup.
-- All use CREATE INDEX IF NOT EXISTS so replay is safe.

-- community_post_likes
CREATE INDEX IF NOT EXISTS idx_community_post_likes_user_id
  ON public.community_post_likes (user_id);

-- community_posts
CREATE INDEX IF NOT EXISTS idx_community_posts_job_id
  ON public.community_posts (job_id);

-- disputes
CREATE INDEX IF NOT EXISTS idx_disputes_decided_by
  ON public.disputes (decided_by);

-- evacuation_pets
CREATE INDEX IF NOT EXISTS idx_evacuation_pets_helper_id
  ON public.evacuation_pets (helper_id);
CREATE INDEX IF NOT EXISTS idx_evacuation_pets_owner_id
  ON public.evacuation_pets (owner_id);
CREATE INDEX IF NOT EXISTS idx_evacuation_pets_pet_id
  ON public.evacuation_pets (pet_id);

-- job_disputes
CREATE INDEX IF NOT EXISTS idx_job_disputes_opened_by
  ON public.job_disputes (opened_by);
CREATE INDEX IF NOT EXISTS idx_job_disputes_resolved_by
  ON public.job_disputes (resolved_by);

-- job_revisions
CREATE INDEX IF NOT EXISTS idx_job_revisions_requested_by
  ON public.job_revisions (requested_by);

-- match_digest_queue
CREATE INDEX IF NOT EXISTS idx_match_digest_queue_job_id
  ON public.match_digest_queue (job_id);

-- pet_report_cards
CREATE INDEX IF NOT EXISTS idx_pet_report_cards_helper_id
  ON public.pet_report_cards (helper_id);
CREATE INDEX IF NOT EXISTS idx_pet_report_cards_owner_id
  ON public.pet_report_cards (owner_id);
CREATE INDEX IF NOT EXISTS idx_pet_report_cards_pet_id
  ON public.pet_report_cards (pet_id);

-- pif_credits (pay-it-forward)
CREATE INDEX IF NOT EXISTS idx_pif_credits_donor_id
  ON public.pif_credits (donor_id);
CREATE INDEX IF NOT EXISTS idx_pif_credits_job_id
  ON public.pif_credits (job_id);
CREATE INDEX IF NOT EXISTS idx_pif_credits_recipient_id
  ON public.pif_credits (recipient_id);

-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_preferred_helper_id
  ON public.profiles (preferred_helper_id);

-- skill_endorsements
CREATE INDEX IF NOT EXISTS idx_skill_endorsements_endorser_id
  ON public.skill_endorsements (endorser_id);
CREATE INDEX IF NOT EXISTS idx_skill_endorsements_job_id
  ON public.skill_endorsements (job_id);

-- str_calendar_connections
CREATE INDEX IF NOT EXISTS idx_str_calendar_connections_preferred_helper_id
  ON public.str_calendar_connections (preferred_helper_id);

-- str_processed_events
CREATE INDEX IF NOT EXISTS idx_str_processed_events_job_id
  ON public.str_processed_events (job_id);

-- thread_mutes
CREATE INDEX IF NOT EXISTS idx_thread_mutes_job_id
  ON public.thread_mutes (job_id);
CREATE INDEX IF NOT EXISTS idx_thread_mutes_other_user_id
  ON public.thread_mutes (other_user_id);

-- user_strikes
CREATE INDEX IF NOT EXISTS idx_user_strikes_dispute_id
  ON public.user_strikes (dispute_id);
CREATE INDEX IF NOT EXISTS idx_user_strikes_issued_by
  ON public.user_strikes (issued_by);
CREATE INDEX IF NOT EXISTS idx_user_strikes_job_id
  ON public.user_strikes (job_id);

-- verification_exceptions
CREATE INDEX IF NOT EXISTS idx_verification_exceptions_check_id
  ON public.verification_exceptions (check_id);
CREATE INDEX IF NOT EXISTS idx_verification_exceptions_credential_id
  ON public.verification_exceptions (credential_id);
CREATE INDEX IF NOT EXISTS idx_verification_exceptions_user_id
  ON public.verification_exceptions (user_id);
