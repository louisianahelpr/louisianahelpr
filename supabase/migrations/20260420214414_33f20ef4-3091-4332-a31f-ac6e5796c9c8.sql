
-- Tighten review gating: enforce eligibility at the database level, not just RLS.

-- 1. Replace the existing INSERT policy with one that enforces all gating rules.
DROP POLICY IF EXISTS "Users can create reviews for completed jobs" ON public.reviews;

CREATE POLICY "Users can create reviews for eligible jobs"
ON public.reviews
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = reviewer_id
  AND EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = reviews.job_id
      -- Reviewer must be a participant
      AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
      -- Reviewee must be the OTHER participant
      AND (
        (j.customer_id = auth.uid() AND j.helper_id = reviews.reviewee_id)
        OR
        (j.helper_id = auth.uid() AND j.customer_id = reviews.reviewee_id)
      )
      -- Job must be completed AND payment released
      AND j.status = 'completed'
      AND j.payment_status = 'released'
      -- Block reviews while a dispute is open
      AND (j.dispute_status IS NULL OR j.dispute_status <> 'open' OR j.dispute_resolved_at IS NOT NULL)
      -- 30-day review window after completion
      AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days'
  )
);

-- 2. Helper function so the client can show/hide the Review button without duplicating logic.
CREATE OR REPLACE FUNCTION public.can_review_job(_job_id uuid, _reviewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = _job_id
      AND (j.customer_id = _reviewer_id OR j.helper_id = _reviewer_id)
      AND j.status = 'completed'
      AND j.payment_status = 'released'
      AND (j.dispute_status IS NULL OR j.dispute_status <> 'open' OR j.dispute_resolved_at IS NOT NULL)
      AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.reviews r
        WHERE r.job_id = _job_id AND r.reviewer_id = _reviewer_id
      )
  );
$$;

-- 3. Lightweight RPC for parish badges: returns "Verified Local" + "Top Helper" flags for a user.
CREATE OR REPLACE FUNCTION public.get_helper_parish_badges(_user_id uuid)
RETURNS TABLE(
  home_parish text,
  is_verified_local boolean,
  is_top_helper_in_parish boolean,
  parish_completed_jobs integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH p AS (
    SELECT user_id, parish FROM public.profiles WHERE user_id = _user_id LIMIT 1
  ),
  parish_jobs AS (
    SELECT COUNT(*)::int AS n
    FROM public.jobs j, p
    WHERE j.helper_id = _user_id
      AND j.status = 'completed'
      AND j.parish = p.parish
  ),
  has_pref AS (
    SELECT EXISTS (
      SELECT 1 FROM public.helper_preferred_parishes hpp, p
      WHERE hpp.helper_id = _user_id AND hpp.parish = p.parish
    ) AS v
  ),
  top10 AS (
    SELECT 1
    FROM public.get_top_helpers_by_parish((SELECT parish FROM p), 10) t
    WHERE t.user_id = _user_id
  )
  SELECT
    p.parish AS home_parish,
    COALESCE((SELECT v FROM has_pref), false) AND COALESCE((SELECT n FROM parish_jobs), 0) >= 3 AS is_verified_local,
    EXISTS (SELECT 1 FROM top10) AS is_top_helper_in_parish,
    COALESCE((SELECT n FROM parish_jobs), 0) AS parish_completed_jobs
  FROM p;
$$;
