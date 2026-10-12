-- Q1587 (owner pop-up 2026-10-11, "YES"): the admin can see the sign-up leads.
--
-- public.signup_leads (20261009223714) is service_role only: RLS on, no
-- policy, every client role revoked. Nothing in the admin panel could read it,
-- so the only way to see how many step-1 emails were saved, which were
-- reminded and which completed was SQL.
--
-- admin_list_signup_leads(): READ ONLY, admins only. Returns every lead,
-- newest first, with the total count on each row (total_count; zero rows means
-- zero leads), and exactly the columns the card shows: email, created_at,
-- reminder_sent_at, completed_at. The table's grants and policies are NOT
-- changed: this function is the only client path to the rows, and it refuses
-- any caller without the admin role (has_role(NULL, ...) is false, so an
-- anonymous caller is refused too). Bounded at 500 rows; leads are deleted at
-- 30 days unless reminded or unsubscribed (sweep_signup_leads), 6 rows on
-- prod on 2026-10-11.
--
-- Grants: EXECUTE revoked FROM PUBLIC, anon and granted to authenticated (the
-- admin's own session calls it; the role check is inside) and service_role.
-- Replay-safe: CREATE OR REPLACE; grants restated.

CREATE OR REPLACE FUNCTION public.admin_list_signup_leads()
RETURNS TABLE (
  email text,
  created_at timestamptz,
  reminder_sent_at timestamptz,
  completed_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT l.email,
         l.created_at,
         l.reminder_sent_at,
         l.completed_at,
         count(*) OVER () AS total_count
    FROM public.signup_leads l
   ORDER BY l.created_at DESC, l.id
   LIMIT 500;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_signup_leads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_signup_leads() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_list_signup_leads() IS
  'Q1587: admin-only read of public.signup_leads for the AdminAnalytics "Sign-up leads" card (email, created_at, reminder_sent_at, completed_at, total_count). Raises admin_only for anyone else.';
