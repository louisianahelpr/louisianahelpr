-- Q1587: the owner can see the sign-up leads (owner 2026-10-09, "Save it,
-- follow up once"; built without an admin list, so the saved step-1 emails were
-- readable only by SQL).
--
-- admin_signup_leads(): read-only, every lead newest first (sweep_signup_leads
-- keeps the table to about 30 days, so it stays small), with whether it was
-- reminded, completed or unsubscribed. Admins only: a non-admin gets NO rows,
-- not an error (the admin_stalled_job_queue pattern). The table itself stays
-- service_role only; this function is the one client read.
-- Replay-safe: CREATE OR REPLACE, then the same REVOKE/GRANT each time.
-- Guard: src/test/signupLeads.test.ts (grant shape, admin check) and
-- src/components/admin/adminAnalytics/SignupLeadsCard.test.tsx (render).
CREATE OR REPLACE FUNCTION public.admin_signup_leads()
RETURNS TABLE (
  email            text,
  source           text,
  created_at       timestamptz,
  reminder_sent_at timestamptz,
  completed_at     timestamptz,
  unsubscribed_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT l.email, l.source, l.created_at, l.reminder_sent_at, l.completed_at, l.unsubscribed_at
    FROM public.signup_leads l
   WHERE public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
   ORDER BY l.created_at DESC, l.email ASC;
$fn$;

REVOKE ALL ON FUNCTION public.admin_signup_leads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_signup_leads() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_signup_leads() IS
  'Q1587: sign-up step-1 leads for the admin Analytics card, newest first. Admins only; non-admins get zero rows.';
