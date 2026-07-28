-- Admin "Payout Batches" (/admin?view=payouts) and "Helpr Tiers"
-- (/admin?view=tiers) were completely broken in production: both views showed
-- the "We couldn't load…" error state for every admin.
--
-- Root cause (verified against prod): get_payout_batches() and
-- get_helper_tiers() are SECURITY DEFINER, but EXECUTE was granted only to
-- service_role/postgres — NOT authenticated. The admin UI calls them through
-- PostgREST with the logged-in user's `authenticated` role, which was rejected
-- with SQLSTATE 42501 (permission denied for function), so unwrap() threw and
-- the components rendered their error state.
--
-- Neither function had an internal authorization check, so naively granting
-- EXECUTE to authenticated would have exposed every helper's email, Stripe
-- Connect account id, and payout totals (get_payout_batches) and helper PII +
-- ratings (get_helper_tiers) to EVERY logged-in user. The fix therefore does
-- BOTH: it adds a server-side admin guard AND grants EXECUTE to authenticated.
--
-- The guard is expressed as a WHERE predicate `public.has_role(auth.uid(),
-- 'admin')` (the same role check rpc_decide_dispute uses), keeping the
-- functions LANGUAGE sql. For a non-admin (or unauthenticated) caller
-- has_role() is false, so the query returns zero rows — no error, no data
-- leak — while an admin sees the full result. Authorization is enforced inside
-- the SECURITY DEFINER function, not the client.
--
-- Replay-safe: CREATE OR REPLACE + GRANT are idempotent. Function bodies are
-- unchanged except for the added guard predicate.

CREATE OR REPLACE FUNCTION public.get_payout_batches()
 RETURNS TABLE(helper_id uuid, helper_name text, helper_email text, stripe_account_id text, job_count integer, total_payout numeric, oldest_completed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    j.helper_id,
    p.full_name AS helper_name,
    p.email AS helper_email,
    p.stripe_account_id,
    count(*)::int AS job_count,
    sum(j.budget - (j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0))::numeric(10,2) AS total_payout,
    min(COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at)) AS oldest_completed_at
  FROM public.jobs j
  JOIN public.profiles p ON p.user_id = j.helper_id
  WHERE j.status = 'completed'
    AND j.payment_status IN ('escrow', 'payout_pending')
    AND j.helper_id IS NOT NULL
    -- server-side admin authorization: non-admins get zero rows, not the data
    AND public.has_role(auth.uid(), 'admin')
  GROUP BY j.helper_id, p.full_name, p.email, p.stripe_account_id
  ORDER BY oldest_completed_at ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_payout_batches() TO authenticated;

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
    LEFT JOIN public.jobs j ON j.helper_id = p.user_id
    WHERE EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
      AND p.approval_status = 'approved'
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

GRANT EXECUTE ON FUNCTION public.get_helper_tiers(integer) TO authenticated;
