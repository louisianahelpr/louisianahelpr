-- Q182 (F-SEC-04): open_jobs_browse STAYS a SECURITY DEFINER view, and says
-- why where a reviewer (or the Supabase security_definer_view lint) finds it.
--
-- The question was whether the view could be `security_invoker = true`
-- without changing what anon and authenticated see. It cannot. Replayed from
-- the migration ledger (latest definitions, 2026-09-23; live pg_policies /
-- has_table_privilege NOT re-read from this session, which has no prod access):
--
--   1. anon holds NO SELECT on public.jobs at all (sync_jobs_select_grants()
--      revokes it, 20260915045110). As an invoker view every signed-out
--      visitor's browse (DashboardGuest.tsx) would be `permission denied`.
--   2. authenticated holds column-level SELECT on every jobs column EXCEPT
--      offered_to_helper_id (jobs_private_select_columns()). The view reads
--      that column in its CASE and WHERE, so as an invoker view every
--      signed-in read would be 42501.
--   3. Row level: the live SELECT policies on jobs are the caller's own jobs,
--      jobs whose address they may see (hired / offeree / roster / accepted),
--      a pending direct offer to them, and admins. None admits a stranger's
--      open job, so even with (1) and (2) granted the browse feed would be
--      empty for everyone but the poster.
--
-- Making it invoker would therefore mean granting anon SELECT on jobs and
-- adding an "anyone can read open jobs" policy — which hands out the raw
-- `location`, unrounded latitude / longitude, is_seed and offered_to_helper_id
-- straight from the table, every one of which this view exists to mask
-- (mask_job_location, round(…, 2), the offeree CASE). The definer view is the
-- narrower grant. It is safe as long as (a) it is SELECT-only for anon and
-- authenticated (20260915045110 restates REVOKE ALL + GRANT SELECT), and (b)
-- its projection keeps masking those columns — both pinned by
-- src/test/openJobsBrowseStaysDefiner.test.ts and
-- src/test/offeredHelperPrivacy.test.ts.
--
-- This migration changes no behaviour: it only records the reason on the
-- object. Replay-safe: skipped when the view is absent.
DO $migration$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NULL THEN
    RAISE NOTICE 'open_jobs_browse absent: skipped';
    RETURN;
  END IF;

  EXECUTE $comment$
COMMENT ON VIEW public.open_jobs_browse IS
'SECURITY DEFINER on purpose (Q182). Browse visibility for anon + authenticated, with location masked, coordinates rounded to 2 dp and the direct-offer target nulled. As security_invoker it would return nothing: anon has no SELECT on jobs, authenticated cannot SELECT offered_to_helper_id, and no jobs RLS policy admits a stranger''s open job. SELECT-only grant; see migration 20260923191120 and src/test/openJobsBrowseStaysDefiner.test.ts.'
$comment$;
END
$migration$;
