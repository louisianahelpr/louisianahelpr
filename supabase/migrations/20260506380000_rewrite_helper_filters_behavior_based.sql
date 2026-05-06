-- Eight functions filtered "is helper" via has_role(uid, 'helper'::app_role).
-- Under the unified-user model that match-set is always empty (0 rows
-- have role='helper' in production after the 2026-05-06 shift), so all
-- eight returned empty arrays — silently broken. Rewriting to a behavior
-- definition: a "helper" is anyone who has been assigned to ≥1 job
-- (jobs.helper_id IS NOT NULL).
--
-- Two of the eight (notify_helpers_on_job_post, notify_saved_searches_on_new_job)
-- could simply drop the role check entirely, since the underlying tables
-- (helper_preferred_parishes, saved_searches) are already opt-in by design.

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

CREATE OR REPLACE FUNCTION public.get_parish_activity(p_limit integer DEFAULT 5)
RETURNS TABLE(parish text, active_jobs integer, completed_jobs_30d integer, revenue_30d numeric, helper_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH job_stats AS (
    SELECT COALESCE(j.parish, 'Unknown') AS parish,
      COUNT(*) FILTER (WHERE j.status IN ('open','accepted','in_progress'))::int AS active_jobs,
      COUNT(*) FILTER (WHERE j.status = 'completed' AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days')::int AS completed_jobs_30d,
      COALESCE(SUM(CASE WHEN j.status = 'completed' AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days' THEN COALESCE(j.platform_fee_amount, 0) + COALESCE(j.customer_fee_amount, 0) ELSE 0 END), 0)::numeric(10,2) AS revenue_30d
    FROM public.jobs j WHERE j.parish IS NOT NULL GROUP BY COALESCE(j.parish, 'Unknown')
  ),
  helper_stats AS (
    SELECT p.parish, COUNT(*)::int AS helper_count
    FROM public.profiles p
    WHERE EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
      AND p.parish IS NOT NULL AND p.approval_status = 'approved' AND COALESCE(p.ban_status, 'active') = 'active'
    GROUP BY p.parish
  )
  SELECT js.parish, js.active_jobs, js.completed_jobs_30d, js.revenue_30d, COALESCE(hs.helper_count, 0) AS helper_count
  FROM job_stats js LEFT JOIN helper_stats hs ON hs.parish = js.parish
  WHERE (js.active_jobs + js.completed_jobs_30d) > 0
  ORDER BY (js.active_jobs * 2 + js.completed_jobs_30d) DESC, js.revenue_30d DESC LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, bio text, location text, skills text, hourly_rate numeric, role text, subscription_tier text, portfolio_urls text[], created_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.user_id, p.full_name, p.avatar_url, p.bio, p.location, p.skills, p.hourly_rate,
    (
      -- Unified-user model: role label is admin if they have one, else
      -- the literal 'member' (no helper-vs-customer surface distinction).
      SELECT CASE WHEN ur.role = 'admin'::app_role THEN 'admin' ELSE 'member' END
      FROM public.user_roles ur WHERE ur.user_id = p.user_id
      ORDER BY CASE ur.role WHEN 'admin'::app_role THEN 1 ELSE 2 END LIMIT 1
    ) AS role,
    p.subscription_tier, p.portfolio_urls, p.created_at
  FROM public.profiles p
  WHERE p.user_id = ANY(user_ids)
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'));
$function$;

CREATE OR REPLACE FUNCTION public.get_approved_helpers(max_count integer DEFAULT 50)
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, bio text, location text, skills text, subscription_tier text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.user_id, p.full_name, p.avatar_url, p.bio, p.location, p.skills, p.subscription_tier
  FROM public.profiles p
  WHERE EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status = 'active')
  LIMIT max_count;
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

CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  helper_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
BEGIN
  IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  v_title := '🎯 New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/dashboard?job=' || NEW.id::text;

  -- helper_preferred_parishes is opt-in (users who set parish prefs are
  -- expressing helper intent by definition). Drop the role gate.
  FOR helper_record IN
    SELECT DISTINCT hpp.helper_id
    FROM public.helper_preferred_parishes hpp
    JOIN public.profiles p ON p.user_id = hpp.helper_id
    WHERE hpp.parish = NEW.parish
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND hpp.helper_id <> NEW.customer_id
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (helper_record.helper_id, v_title, v_message, 'job_match', v_link);

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', helper_record.helper_id,
        'title', v_title,
        'message', v_message,
        'type', 'job_match',
        'link', v_link
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  match_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  -- saved_searches is opt-in (users explicitly created the search).
  -- Drop the role gate.
  FOR match_record IN
    SELECT DISTINCT s.id, s.user_id, s.name
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    WHERE s.notify_enabled = true
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      AND (s.category IS NULL OR s.category = NEW.category::text)
      AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget)
      AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (
        s.location_keyword IS NULL
        OR NEW.location ILIKE '%' || s.location_keyword || '%'
      )
      AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
  LOOP
    v_title := '🎯 New job matches your saved search';
    v_message := 'A new job matches "' || match_record.name || '": ' || NEW.title || ' ($' || NEW.budget || ')';
    v_link := '/dashboard?job=' || NEW.id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (match_record.user_id, v_title, v_message, 'job_match', v_link);

    UPDATE public.saved_searches
       SET last_notified_at = now()
     WHERE id = match_record.id;

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', match_record.user_id,
        'title', v_title,
        'message', v_message,
        'type', 'job_match',
        'link', v_link
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;
