-- Q819: Admin People built each user's "last activity" from the newest 500
-- jobs and the newest 500 applications across ALL listed users, the same
-- global-LIMIT shape that hid logins in Q428. Measured 2026-09-27: 421 jobs,
-- 208 applications, so nothing was cut yet; it would be once either passed 500.
--
-- One row per user: the newest job they posted and the newest application
-- they made, computed server-side with no LIMIT. SECURITY INVOKER keeps the
-- jobs/applications RLS, and the has_role check gives a non-admin zero rows.
CREATE OR REPLACE FUNCTION public.admin_last_activity()
RETURNS TABLE (user_id uuid, last_posted_at timestamptz, last_applied_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT a.user_id, max(a.posted_at) AS last_posted_at, max(a.applied_at) AS last_applied_at
  FROM (
    SELECT j.customer_id AS user_id, j.created_at AS posted_at, NULL::timestamptz AS applied_at
    FROM public.jobs j
    WHERE j.customer_id IS NOT NULL
    UNION ALL
    SELECT ap.helper_id, NULL::timestamptz, ap.created_at
    FROM public.applications ap
    WHERE ap.helper_id IS NOT NULL
  ) a
  WHERE public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  GROUP BY a.user_id
$$;

REVOKE ALL ON FUNCTION public.admin_last_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_last_activity() TO authenticated, service_role;
