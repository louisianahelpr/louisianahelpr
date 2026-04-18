-- 1. Function: which job categories are taxable under LA Marketplace Facilitator law
CREATE OR REPLACE FUNCTION public.is_category_taxable(_category public.job_category)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _category IN (
    'cleaning'::public.job_category,
    'yard_work'::public.job_category,
    'moving'::public.job_category,
    'handyman'::public.job_category,
    'painting'::public.job_category,
    'delivery'::public.job_category,
    'assembly'::public.job_category
  );
$$;

COMMENT ON FUNCTION public.is_category_taxable IS
'Returns true for LA-taxable services (repair, cleaning, installation, tangible labor). Personal/professional services (errands, pet_care, other) are exempt.';

-- 2. RPC: top community heroes per parish (or all parishes if null)
-- Score formula: avg_rating * ln(review_count + 1) + (completed_jobs * 0.1)
-- Qualification: >= 3 reviews, >= 4.5 avg rating
CREATE OR REPLACE FUNCTION public.get_top_helpers_by_parish(
  p_parish text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  avatar_url text,
  bio text,
  location text,
  parish text,
  skills text,
  subscription_tier text,
  avg_rating numeric,
  review_count integer,
  completed_jobs integer,
  hero_score numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH helper_stats AS (
    SELECT
      p.user_id,
      p.full_name,
      p.avatar_url,
      p.bio,
      p.location,
      p.parish,
      p.skills,
      p.subscription_tier,
      COALESCE(AVG(r.rating)::numeric(10,2), 0) AS avg_rating,
      COUNT(DISTINCT r.id)::int AS review_count,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed' AND j.helper_id = p.user_id)::int AS completed_jobs
    FROM public.profiles p
    LEFT JOIN public.reviews r ON r.reviewee_id = p.user_id
    LEFT JOIN public.jobs j ON j.helper_id = p.user_id
    WHERE p.role = 'helper'
      AND p.approval_status = 'approved'
      AND (p.ban_status IS NULL OR p.ban_status = 'active')
      AND (p_parish IS NULL OR p.parish = p_parish)
    GROUP BY p.user_id, p.full_name, p.avatar_url, p.bio, p.location, p.parish, p.skills, p.subscription_tier
  )
  SELECT
    user_id, full_name, avatar_url, bio, location, parish, skills, subscription_tier,
    avg_rating, review_count, completed_jobs,
    (avg_rating * LN(review_count + 1) + (completed_jobs * 0.1))::numeric(10,4) AS hero_score
  FROM helper_stats
  WHERE review_count >= 3 AND avg_rating >= 4.5
  ORDER BY hero_score DESC, avg_rating DESC, review_count DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_top_helpers_by_parish IS
'Returns top "Community Hero" helpers ranked by weighted score (rating * log(reviews) + jobs*0.1). Filter by parish or pass NULL for all.';

-- 3. RPC: list distinct parishes that have at least one qualifying hero (for filter dropdown)
CREATE OR REPLACE FUNCTION public.get_hero_parishes()
RETURNS TABLE (parish text, hero_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH qualified AS (
    SELECT
      p.parish,
      p.user_id,
      AVG(r.rating) AS avg_rating,
      COUNT(r.id) AS review_count
    FROM public.profiles p
    JOIN public.reviews r ON r.reviewee_id = p.user_id
    WHERE p.role = 'helper'
      AND p.approval_status = 'approved'
      AND (p.ban_status IS NULL OR p.ban_status = 'active')
      AND p.parish IS NOT NULL
    GROUP BY p.parish, p.user_id
    HAVING COUNT(r.id) >= 3 AND AVG(r.rating) >= 4.5
  )
  SELECT parish, COUNT(*)::int AS hero_count
  FROM qualified
  GROUP BY parish
  ORDER BY hero_count DESC, parish ASC;
$$;