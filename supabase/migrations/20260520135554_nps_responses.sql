-- ============================================================
-- nps_responses — Net Promoter Score survey results
-- ============================================================
-- Fires once per user at a high-context post-completion moment (the
-- 2nd completed job — see src/lib/nps.ts for the eligibility rule).
-- One row per submission; client guards against re-prompt via a server
-- lookup of the most recent row plus a localStorage 90-day cooldown.
--
-- score is 0..10 (the classic NPS scale).  comment is optional free-text
-- the user can leave when they choose a score.  triggered_at_jobs_completed
-- is stamped at prompt-show time so we can analyse the funnel between
-- jobs-completed and detractor/promoter mix.
CREATE TABLE IF NOT EXISTS public.nps_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score SMALLINT NOT NULL CHECK (score >= 0 AND score <= 10),
  comment TEXT,
  user_role TEXT CHECK (user_role IN ('customer','helper')),
  triggered_at_jobs_completed INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Eligibility check + admin analytics both want the latest-per-user row;
-- a single composite index serves both query shapes.
CREATE INDEX IF NOT EXISTS idx_nps_responses_user_created
  ON public.nps_responses (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nps_responses_created
  ON public.nps_responses (created_at DESC);

ALTER TABLE public.nps_responses ENABLE ROW LEVEL SECURITY;

-- Users can insert their own NPS row.
DROP POLICY IF EXISTS "users_insert_own_nps" ON public.nps_responses;
CREATE POLICY "users_insert_own_nps"
  ON public.nps_responses FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can read their own NPS rows so the client can answer the
-- "have I already submitted?" gate without a privileged endpoint.
-- Admins can read everyone's for dashboarding.
DROP POLICY IF EXISTS "users_read_own_nps" ON public.nps_responses;
CREATE POLICY "users_read_own_nps"
  ON public.nps_responses FOR SELECT
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));
