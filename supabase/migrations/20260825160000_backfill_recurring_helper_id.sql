-- The recurring-series stamp (20260824247000, INSERT path added in
-- 20260824267000) only ever fires on the helper_confirmed_at TRANSITION:
--   (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL)
-- Any series whose helper had ALREADY confirmed before those migrations
-- therefore kept recurring_helper_id NULL, and nothing will ever set it —
-- the transition it waits for is in the past.
--
-- charge-recurring-visits selects on `.not("recurring_helper_id","is",null)`
-- (index.ts:107), so such a series is invisible to the cron forever: the
-- helper committed, the poster believes the booking stands, and not one visit
-- is ever created or charged. It fails silently in the direction of doing
-- nothing, which is the hardest kind to notice.
--
-- Both prior migrations shipped the trigger without a backfill. This closes
-- that, and is idempotent — the WHERE clause matches nothing on a second run,
-- and on a from-scratch rebuild it simply finds no rows to fix.
--
-- Scope mirrors the trigger's own INSERT condition — a parent series
-- (parent_job_id IS NULL), with recurrence, a confirmed helper, and no stamp
-- yet — narrowed to the statuses where continuing to charge is actually the
-- right outcome. Stated as a positive list rather than an exclusion so a status
-- added later has to be considered deliberately instead of being swept in:
-- resurrecting a cancelled, completed, or disputed series into the charging
-- cron would not be a repair.
UPDATE public.jobs
   SET recurring_helper_id = helper_id
 WHERE recurrence_days IS NOT NULL
   AND parent_job_id IS NULL
   AND helper_id IS NOT NULL
   AND helper_confirmed_at IS NOT NULL
   AND recurring_helper_id IS NULL
   AND status IN ('open', 'accepted', 'in_progress', 'revision_requested');
