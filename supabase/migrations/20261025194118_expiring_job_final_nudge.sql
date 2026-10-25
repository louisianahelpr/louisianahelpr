-- Hire nudge (owner 2026-10-25: "Remind posters to hire before their job
-- expires", yes). expiring-jobs-push already reminds a poster once about a day
-- before an open, funded job with no Helpr expires (expiring_notif_sent). It
-- now names the applicants waiting, and sends a second, final reminder in the
-- last 6 hours when someone has applied. This flag marks that final reminder.
-- Measured 2026-10-25: three of the owner's paid jobs (43, 27 and 76
-- applicants) sat with nobody hired, and jobs that expire unfilled are refunded.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS expiring_final_notif_sent boolean;

COMMENT ON COLUMN public.jobs.expiring_final_notif_sent IS
  'Set by expiring-jobs-push once the final "pick someone today" reminder (last 6 hours, applicants waiting) has gone to the poster. NULL = not sent.';

-- Column-level SELECT for authenticated (20260915045110): a new jobs column is
-- unreadable until the grants are re-synced.
DO $g$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END
$g$;
