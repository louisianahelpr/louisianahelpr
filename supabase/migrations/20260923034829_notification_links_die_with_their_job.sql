-- A notification must not link to a job that no longer exists.
--
-- ── The bug (press-every-control, issue #1582, run 35805671843) ─────────────
-- Pressing a row in the dashboard notification panel as the helper persona
-- raised "We can't open this job right now — it may have been filled or taken
-- down." The row's link named a job that had been DELETED:
--
--   notifications.link = '/jobs/5eed0b10-0000-4000-8000-000000000005'
--   select count(*) from jobs where id = '5eed0b10-…-000000000005'  → 0
--
-- /jobs/:id bounces a signed-in reader to /dashboard?quickApply=<id>, the
-- browse view and the party-scoped jobs read both return zero rows, and the
-- reader is told to "try again in a few minutes" about a job that is gone for
-- good. Other shapes fail differently but just as dead: /my-posts?job=<gone>,
-- /dashboard?job=<gone> (silently does nothing), /messages?jobId=<gone>
-- (messages are ON DELETE CASCADE, so the thread is gone too).
--
-- ── Why it happens: which layer ─────────────────────────────────────────────
-- notifications.job_id is ON DELETE SET NULL, so deleting a job nulls the
-- REFERENCE — and the row then falls back to its `link` string
-- (src/components/notificationPanel/notificationDestination.ts: "No
-- reference: the URL is all there is"). Nothing ever touched the link, so the
-- row kept a tap target the reader can never follow. The client cannot tell a
-- dead link from a pre-20260901035600 row that simply never had a job_id;
-- only the database knows the job is gone, at the moment it goes.
--
-- Measured on prod 2026-09-22 (read-only), links whose job id
-- (notification_job_id_from_link) names no row in public.jobs:
--   /messages?jobId=<id>&userId=<id>   80
--   /my-posts?job=<id>                 47
--   /dashboard?job=<id>                 4
--   /jobs/<id>                          4
--   /my-jobs?job=<id>                   3        total 138 of 1,744 rows
-- The 97 other links carrying a uuid are /admin?view=people&user=<id> (92)
-- and /post-job?offerTo=<id> (5); none names a live or dead job.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
-- 1. On job DELETE, null `link` on every notification whose link names the
--    deleted job. The match is the job's id anywhere in the string, not a list
--    of URL shapes, so a new link shape is covered the day it is written.
--    Checked on prod: no job id equals any profile or auth user id, so the
--    substring match cannot hit an unrelated /admin?…&user=<id> link.
--    A row with link NULL and job_id NULL has no destination; the panel marks
--    it read on tap and stops offering it as a control (NotificationPanel
--    isActionable) — an honest row instead of a dead end.
-- 2. Backfill the 138 rows already dead.
--
-- Statement-level with a transition table: one pass over notifications per
-- DELETE statement, not one per deleted job (the nightly sweeper deletes ~30
-- E2E jobs in one statement).
--
-- SECURITY DEFINER: the deleter (a poster removing their own unfunded post,
-- via RLS) cannot UPDATE other users' notifications, and the link must die
-- regardless of who deleted the job.
--
-- Guard: src/test/notificationLinksDieWithTheirJob.test.ts.

CREATE OR REPLACE FUNCTION public.notifications_unlink_deleted_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.notifications n
     SET link = NULL
    FROM gone_jobs g
   WHERE n.link IS NOT NULL
     AND strpos(lower(n.link), g.id::text) > 0;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.notifications_unlink_deleted_jobs()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notifications_unlink_deleted_jobs() IS
  'AFTER DELETE ON jobs (statement): nulls notifications.link wherever it names a deleted job, so no notification offers a tap into a job that is gone. job_id is already nulled by its ON DELETE SET NULL FK.';

DO $$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL AND to_regclass('public.notifications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_notifications_unlink_deleted_jobs ON public.jobs;
    CREATE TRIGGER trg_notifications_unlink_deleted_jobs
      AFTER DELETE ON public.jobs
      REFERENCING OLD TABLE AS gone_jobs
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.notifications_unlink_deleted_jobs();
  END IF;
END
$$;

-- Backfill: every link that already names a job which no longer exists.
-- notification_job_id_from_link() is the same parser trg_notifications_fill_job_id
-- uses; it recognises every job-bearing shape measured above.
DO $$
BEGIN
  IF to_regprocedure('public.notification_job_id_from_link(text)') IS NOT NULL THEN
    UPDATE public.notifications n
       SET link = NULL
     WHERE n.link IS NOT NULL
       AND n.job_id IS NULL
       AND public.notification_job_id_from_link(n.link) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.jobs j
          WHERE j.id = public.notification_job_id_from_link(n.link)
       );
  END IF;
END
$$;
