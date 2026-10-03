-- docs/OPEN.md Q1149: every deleted job is logged with its seed flag and its
-- lifetime, so the storage orphan sweep can clear a deleted SEED job's files
-- without tripping its cap.
--
-- 2026-10-03: the weekly sweep (scripts/storage-orphan-sweep.mjs) found 228
-- "job gone" orphans, tripped its 50-file / 5%-of-bucket caps, deleted
-- nothing and paged critical (nightly-red #2188, #2189). Every one was a
-- 70-777 byte test-fixture PNG whose seed job had been deleted by a test
-- cleanup (prod-lifecycle-sweeper, press clean-up, throwaway journeys) or the
-- 2026-10-01 seed wipe; none of those paths removes a job's files, and the
-- three job-keyed buckets held no file of any non-seed job. The caps exist
-- because a big orphan count usually means the MATCHING is wrong; a job the
-- database itself recorded deleting, as a seed job, is not a matching
-- question. This log answers it at the one layer every deletion path shares.
--
-- Reader: scripts/storage-orphan-sweep.mjs (service role). Nothing else may
-- read or write it: RLS on with no policy, revoked from PUBLIC, anon and
-- authenticated (prod's default ACL no longer grants new TABLES to them, but
-- the REVOKE keeps that true whatever the default; FUNCTIONS still default to
-- EXECUTE for anon and authenticated, hence the function REVOKE below).
--
-- TRUST (lh-authz-rls reviews, 2026-10-03): is_seed is not a trust boundary
-- on its own (a fixture-email signup is a seed profile, and a client may choose
-- jobs.id), so the log records the job's lifetime and the sweep exempts only
-- files CREATED within it, and a row that ever said "not seed" stays "not
-- seed". That holds while the row exists (90 days): jobs.created_at is still
-- client-writable, so after the prune a reused id with a back-dated
-- created_at could open a wide window (docs/OPEN.md: created_at server-owned).
--
-- REPLAY-SAFETY: public.jobs exists from the first migration; every statement
-- here is IF NOT EXISTS / OR REPLACE / DROP IF EXISTS / ON CONFLICT DO NOTHING,
-- and the backfill is guarded on storage.objects existing.

CREATE TABLE IF NOT EXISTS public.deleted_jobs_log (
  job_id         uuid        PRIMARY KEY,
  is_seed        boolean     NOT NULL,
  job_created_at timestamptz NOT NULL,
  deleted_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deleted_jobs_log ENABLE ROW LEVEL SECURITY;
SELECT public.attach_unconfirmed_email_gate();

REVOKE ALL ON TABLE public.deleted_jobs_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deleted_jobs_log TO service_role;

COMMENT ON TABLE public.deleted_jobs_log IS
  'Q1149: one row per deleted job (AFTER DELETE trigger on jobs): seed flag and lifetime. The storage orphan sweep clears a deleted seed job''s files created within that lifetime without counting them against its caps; it prunes rows older than 90 days.';

-- SECURITY DEFINER: the deleting role (a poster deleting their own unpaid job
-- through PostgREST, a test cleanup, the seed purge) cannot write this table.
CREATE OR REPLACE FUNCTION public.log_deleted_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.deleted_jobs_log (job_id, is_seed, job_created_at)
  VALUES (OLD.id, coalesce(OLD.is_seed, false), OLD.created_at)
  ON CONFLICT (job_id) DO UPDATE
    SET is_seed        = public.deleted_jobs_log.is_seed AND EXCLUDED.is_seed,
        job_created_at = EXCLUDED.job_created_at,
        deleted_at     = now();
  -- Retention, in the database (CJ-003): rows past 90 days are dropped here,
  -- so the log stays bounded even if the weekly sweep (which also prunes)
  -- stops running. The sweep only needs rows newer than its min-age window.
  DELETE FROM public.deleted_jobs_log WHERE deleted_at < now() - interval '90 days';
  RETURN OLD;
END
$$;

REVOKE ALL ON FUNCTION public.log_deleted_job() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_deleted_job ON public.jobs;
CREATE TRIGGER trg_log_deleted_job
  AFTER DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.log_deleted_job();

-- ONE-TIME BACKFILL for jobs deleted before this trigger existed (2026-10-03:
-- 69 objects under 28 such job ids, all uploaded by seed profiles; without
-- this they trip the caps again when they age past 7 days). A slot counts only
-- when it is not a live job, not a live user's folder, and EVERY object under
-- it was uploaded by a seed profile; its window opens at its first upload.
-- Same path schemes as owningJobId in scripts/lib/storageOrphans.mjs.
DO $$
BEGIN
  -- storage.objects.owner_id is not in CI's replay image (supabase/postgres
  -- 15.8.1.060 carries the 2021 storage schema); guard on the column, not
  -- only the table, so the replay applies (lh-authz-rls review 2026-10-03).
  IF to_regclass('storage.objects') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                     WHERE attrelid = 'storage.objects'::regclass
                       AND attname = 'owner_id' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  INSERT INTO public.deleted_jobs_log (job_id, is_seed, job_created_at, deleted_at)
  SELECT s.slot::uuid, true, min(s.created_at), now()
    FROM (
      SELECT o.owner_id, o.created_at,
             CASE
               WHEN o.bucket_id = 'application-attachments' THEN split_part(o.name, '/', 2)
               WHEN o.bucket_id = 'message-attachments' AND split_part(o.name, '/', 1) = 'voice-notes' THEN split_part(o.name, '/', 2)
               WHEN o.bucket_id = 'message-attachments' THEN split_part(o.name, '/', 1)
               WHEN split_part(o.name, '/', 2) = 'disputes' THEN split_part(o.name, '/', 3)
               WHEN split_part(o.name, '/', 2) = 'reviews' THEN NULL
               ELSE split_part(o.name, '/', 1)
             END AS slot
        FROM storage.objects o
       WHERE o.bucket_id IN ('job-photos', 'proof-photos', 'message-attachments', 'application-attachments')
    ) s
   WHERE s.slot ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id::text = s.slot)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id::text = s.slot)
   GROUP BY s.slot
  HAVING bool_and(EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id::text = s.owner_id AND p.is_seed))
     AND min(s.created_at) IS NOT NULL
  ON CONFLICT (job_id) DO NOTHING;
END
$$;
