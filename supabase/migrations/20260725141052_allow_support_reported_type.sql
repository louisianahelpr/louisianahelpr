-- Fix: the in-app support form has never been able to submit.
--
-- `src/components/profile/SupportInline.tsx` inserts into `reports` with
-- `reported_type: 'support'`, but `reports_reported_type_check` only ever
-- allowed ('job','message','user'). Every submission therefore failed with
-- 23514 and the user got "We couldn't send that — please try again."
--
-- Verified against prod before writing this:
--   * pg_constraint definition: CHECK (reported_type = ANY (ARRAY['job','message','user']))
--   * SELECT reported_type, count(*) FROM reports GROUP BY 1
--       → only 'user' (2) and 'job' (1). Zero 'support' rows have ever landed.
--
-- So this is not a hypothetical: the single in-app path for a signed-in user
-- to reach the team has been dead, and because the failure surfaced only as a
-- toast, nothing was recorded anywhere. Adding 'support' to the allowed set
-- makes the existing form work and lets the new /support page's server-side
-- mirror-insert land in the same admin queue.
--
-- Replay-safe: the DROP is IF EXISTS and the constraint is re-added by the
-- same name, so a from-scratch rebuild and an incremental deploy both end at
-- the same definition. No data rewrite — widening a CHECK cannot invalidate
-- existing rows (all current values remain permitted).

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_reported_type_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text]));
