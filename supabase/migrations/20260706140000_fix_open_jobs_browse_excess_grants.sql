-- F-SEC-05 (pre-launch audit redo, 2026-07-06): open_jobs_browse is a public
-- browsing view owned by `postgres` (rolbypassrls=true) and is_updatable/
-- is_insertable_into=true. It previously carried the FULL default grant set
-- (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, not just SELECT) for both
-- anon and authenticated. Because the view's owner bypasses RLS, any write
-- through it lands on the underlying `jobs` table with ZERO RLS enforcement —
-- letting ANY authenticated user (not just the job's own customer/helper/admin)
-- UPDATE or DELETE any other customer's job row (budget, status, payment_status,
-- customer_id, helper_id, ...) via `supabase.from("open_jobs_browse").update()`/
-- `.delete()` with the client already shipped in the app. No app code ever
-- writes through this view (grep confirms every caller is `.select()`-only) —
-- the write grants were pure excess privilege with no product purpose.
--
-- The view is intentionally left non-security_invoker: jobs' own RLS SELECT
-- policies are all scoped to `authenticated` with no anon policy, so this view
-- is the deliberate, curated, location-masked read path anon guest-browsing
-- depends on (see DashboardGuest.tsx). Flipping security_invoker would break
-- that legitimate feature. The actual bug was the grant set, not the view's
-- SECURITY DEFINER-style read behavior — so this migration only tightens grants.
revoke insert, update, delete, truncate, references, trigger
  on public.open_jobs_browse
  from anon, authenticated;

grant select on public.open_jobs_browse to anon, authenticated;
