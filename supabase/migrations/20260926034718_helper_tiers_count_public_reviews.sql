-- Q321: admin "Helpr Tiers" counted a different set of reviews from every
-- other screen.
--
-- get_helper_tiers joined `public.reviews` with no predicate at all, so its
-- total_reviews / avg_rating (and the tier it derives from them) included
-- reviews still inside the 14-day anti-retaliation blind period, unpublished
-- reviews, and reviews on jobs that ended up cancelled. Every member-facing
-- surface (applicant row, profile header, dashboard) reads
-- get_public_profile_stats, which counts only reviews that are published, past
-- feedback_visible_at, and on a job that is not cancelled. Measured on prod
-- 2026-09-26 for the e2e helper 437de07d: 39 review rows, 24 that count — the
-- applicant row read "5.0 (24)" while this RPC reported 39 and could promote
-- her to Elite on reviews nobody may see yet.
--
-- This redefines the reviews side of the RPC with the same three predicates,
-- character-for-character those of get_public_profile_stats' visible_reviews
-- CTE. Everything else (return shape, admin gate, tier thresholds, ordering)
-- is unchanged, so CREATE OR REPLACE keeps the existing grants.
--
-- REPLAY-SAFETY: CREATE OR REPLACE of a function whose every dependency
-- (profiles, reviews, jobs, has_role) exists from the first migrations.

CREATE OR REPLACE FUNCTION public.get_helper_tiers(p_limit integer DEFAULT 25)
 RETURNS TABLE(user_id uuid, full_name text, parish text, avatar_url text, total_reviews integer, recent_reviews integer, avg_rating numeric, recent_avg_rating numeric, completed_jobs integer, growth_score numeric, tier text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH visible_reviews AS (
    -- The reviews that count toward a public rating (Q321): the same three
    -- predicates as get_public_profile_stats.visible_reviews.
    SELECT r.id, r.reviewee_id, r.rating, r.created_at
    FROM public.reviews r
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
  ),
  stats AS (
    SELECT p.user_id, p.full_name, p.parish, p.avatar_url,
      COUNT(DISTINCT r.id)::int AS total_reviews,
      COUNT(DISTINCT r.id) FILTER (WHERE r.created_at > now() - interval '30 days')::int AS recent_reviews,
      COALESCE(AVG(r.rating)::numeric(10,2), 0) AS avg_rating,
      COALESCE(AVG(r.rating) FILTER (WHERE r.created_at > now() - interval '30 days')::numeric(10,2), 0) AS recent_avg_rating,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed' AND j.helper_id = p.user_id)::int AS completed_jobs
    FROM public.profiles p
    LEFT JOIN visible_reviews r ON r.reviewee_id = p.user_id
    LEFT JOIN public.jobs j ON j.helper_id = p.user_id
    WHERE EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      -- server-side admin authorization: non-admins get zero rows, not the data
      AND public.has_role(auth.uid(), 'admin')
    GROUP BY p.user_id, p.full_name, p.parish, p.avatar_url
  )
  SELECT user_id, full_name, parish, avatar_url, total_reviews, recent_reviews, avg_rating, recent_avg_rating, completed_jobs,
    (recent_reviews * COALESCE(recent_avg_rating, 0))::numeric(10,2) AS growth_score,
    CASE
      WHEN total_reviews >= 25 AND avg_rating >= 4.7 THEN 'Elite'
      WHEN total_reviews >= 10 AND avg_rating >= 4.5 THEN 'Verified'
      WHEN recent_reviews >= 3 AND recent_avg_rating >= 4.5 THEN 'Rising Star'
      WHEN total_reviews >= 1 THEN 'Active'
      ELSE 'New'
    END AS tier
  FROM stats ORDER BY growth_score DESC, total_reviews DESC LIMIT p_limit;
$function$;

-- Unchanged grant surface, restated so a from-scratch replay cannot widen it.
REVOKE ALL ON FUNCTION public.get_helper_tiers(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_tiers(integer) TO authenticated;
