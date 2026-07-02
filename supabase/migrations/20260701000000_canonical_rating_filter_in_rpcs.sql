-- HIGH-1: unify the "which reviews count toward a rating" definition across
-- every surface. The client (profile pages, feeds, applicant lists) now routes
-- all rating aggregates through fetchRatingStats(), which applies BOTH filters:
--   * r.feedback_visible_at <= now()   (anti-retaliation reveal has passed)
--   * the review's job is not cancelled
-- These discovery/leaderboard RPCs computed avg_rating from an UNfiltered
-- review set, so a helper's rating on the hero list could diverge from the
-- same helper's rating on their profile. Recreate them with the identical
-- filter, applied in the JOIN's ON clause so helpers with zero qualifying
-- reviews still appear (LEFT JOIN semantics preserved).
--
-- Deploys manually (supabase db push / MCP apply_migration).

CREATE OR REPLACE FUNCTION public.get_helper_tiers(p_limit integer DEFAULT 25)
RETURNS TABLE(user_id uuid, full_name text, parish text, avatar_url text, total_reviews integer, recent_reviews integer, avg_rating numeric, recent_avg_rating numeric, completed_jobs integer, growth_score numeric, tier text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH stats AS (
    SELECT p.user_id, p.full_name, p.parish, p.avatar_url,
      COUNT(DISTINCT r.id)::int AS total_reviews,
      COUNT(DISTINCT r.id) FILTER (WHERE r.created_at > now() - interval '30 days')::int AS recent_reviews,
      COALESCE(AVG(r.rating)::numeric(10,2), 0) AS avg_rating,
      COALESCE(AVG(r.rating) FILTER (WHERE r.created_at > now() - interval '30 days')::numeric(10,2), 0) AS recent_avg_rating,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed' AND j.helper_id = p.user_id)::int AS completed_jobs
    FROM public.profiles p
    LEFT JOIN public.reviews r ON r.reviewee_id = p.user_id
      AND r.feedback_visible_at <= now()
      AND EXISTS (SELECT 1 FROM public.jobs rj WHERE rj.id = r.job_id AND rj.status <> 'cancelled')
    LEFT JOIN public.jobs j ON j.helper_id = p.user_id
    WHERE EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
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

CREATE OR REPLACE FUNCTION public.get_hero_parishes()
RETURNS TABLE(parish text, hero_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH qualified AS (
    SELECT p.parish, p.user_id, AVG(r.rating) AS avg_rating, COUNT(r.id) AS review_count
    FROM public.profiles p
    JOIN public.reviews r ON r.reviewee_id = p.user_id
      AND r.feedback_visible_at <= now()
      AND EXISTS (SELECT 1 FROM public.jobs rj WHERE rj.id = r.job_id AND rj.status <> 'cancelled')
    WHERE EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
      AND p.approval_status = 'approved'
      AND (p.ban_status IS NULL OR p.ban_status = 'active')
      AND p.parish IS NOT NULL
    GROUP BY p.parish, p.user_id
    HAVING COUNT(r.id) >= 3 AND AVG(r.rating) >= 4.5
  )
  SELECT parish, COUNT(*)::int AS hero_count
  FROM qualified GROUP BY parish ORDER BY hero_count DESC, parish ASC;
$function$;

CREATE OR REPLACE FUNCTION public.get_top_helpers_by_parish(p_parish text DEFAULT NULL::text, p_limit integer DEFAULT 10)
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, bio text, location text, parish text, skills text, subscription_tier text, avg_rating numeric, review_count integer, completed_jobs integer, hero_score numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH helper_stats AS (
    SELECT p.user_id, p.full_name, p.avatar_url, p.bio, p.location, p.parish, p.skills, p.subscription_tier,
      COALESCE(AVG(r.rating)::numeric(10,2), 0) AS avg_rating,
      COUNT(DISTINCT r.id)::int AS review_count,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed' AND j.helper_id = p.user_id)::int AS completed_jobs
    FROM public.profiles p
    LEFT JOIN public.reviews r ON r.reviewee_id = p.user_id
      AND r.feedback_visible_at <= now()
      AND EXISTS (SELECT 1 FROM public.jobs rj WHERE rj.id = r.job_id AND rj.status <> 'cancelled')
    LEFT JOIN public.jobs j ON j.helper_id = p.user_id
    WHERE EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
      AND p.approval_status = 'approved'
      AND (p.ban_status IS NULL OR p.ban_status = 'active')
      AND (p_parish IS NULL OR p.parish = p_parish)
    GROUP BY p.user_id, p.full_name, p.avatar_url, p.bio, p.location, p.parish, p.skills, p.subscription_tier
  )
  SELECT user_id, full_name, avatar_url, bio, location, parish, skills, subscription_tier,
    avg_rating, review_count, completed_jobs,
    (avg_rating * LN(review_count + 1) + (completed_jobs * 0.1))::numeric(10,4) AS hero_score
  FROM helper_stats
  WHERE review_count >= 3 AND avg_rating >= 4.5
  ORDER BY hero_score DESC, avg_rating DESC, review_count DESC
  LIMIT p_limit;
$function$;
