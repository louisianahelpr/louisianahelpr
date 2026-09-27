-- Q428: Admin People read "Never logged in" for accounts that had logged in.
-- useAdminUserSummaries read the newest 500 login_history rows across ALL
-- users and took each user's max from those, so the shared test accounts
-- (hundreds of sign-ins a day) pushed everyone else out. Measured 2026-09-27:
-- 1507 rows, 8 users with a login, only 7 of them inside the newest 500.
--
-- One row per user, the newest login, computed server-side, so no user's
-- volume can hide another's. SECURITY INVOKER: login_history RLS still
-- applies (admins read all, anyone else only their own), and the explicit
-- has_role check makes a non-admin caller get zero rows, not their own.
CREATE OR REPLACE FUNCTION public.admin_last_logins()
RETURNS TABLE (user_id uuid, last_login_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT l.user_id, max(l.created_at) AS last_login_at
  FROM public.login_history l
  WHERE public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  GROUP BY l.user_id
$$;

REVOKE ALL ON FUNCTION public.admin_last_logins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_last_logins() TO authenticated, service_role;
