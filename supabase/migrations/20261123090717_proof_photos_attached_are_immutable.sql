-- SEC-1123-01 (backend security audit 2026-11-23, Med): either party to a job could delete or overwrite the OTHER
-- side's attached proof photos.
--
-- The proof-photos UPDATE and DELETE policies (20260925141905) allowed any object under `<jobId>/...` to the job's
-- poster AND its Helpr (public.is_party_to_job_folder), so the poster could remove or upsert the Helpr's before/after
-- photos (PhotoProof.tsx, `<jobId>/<type>-...`, attached in jobs.proof_before_urls / proof_after_urls) and either side
-- the other's revision photos (CompletionChoiceSheet.tsx, `<jobId>/revisions/...`, attached in job_revisions.photos).
-- Those photos gate completion and payout and are what an admin looks at in a dispute. Only `*/disputes/*` was locked.
--
-- The fix, the pattern of "Sellers delete own unattached declutter photos" (20261101235806):
--   * an object a job names (jobs.proof_before_urls / proof_after_urls or a job_revisions.photos row, as a path or,
--     for old rows, inside a full storage URL; a crew member's group_job_helpers.proof_before_urls / proof_after_urls,
--     PhotoProof's crew branch) cannot be deleted or updated by any client;
--   * otherwise only its UPLOADER (storage.objects.owner) may delete or update it, inside the folders the old policy
--     allowed, never under `disputes`.
-- public.proof_photo_object_attached(name) answers only "does a job name this path" (no row data), SECURITY DEFINER
-- so the answer is the same whatever the caller can read (the declutter_photo_object_attached reason: an RLS-bound
-- NOT EXISTS reads "unattached" to whoever cannot see the row).
-- storage.objects.owner, not owner_id: CI's replay image carries the 2021 storage schema without owner_id
-- (20261003192708). Prod 2026-11-23: 378 proof-photos objects, owner NULL on 0, owner = owner_id on all 378.
--
-- Nothing the app runs needs more: every client write to proof-photos is a plain INSERT (.upload without upsert), and
-- no client removes or moves a proof-photos object. The one party-token DELETE, e2e/prod-lifecycle.spec.ts teardown,
-- signs in as the Helpr who uploaded the photos and detaches the paths from the jobs row BEFORE deleting them, so it
-- passes as the uploader of unattached objects. Account purge and the orphan sweep use the service role (no RLS).
-- For UPDATE, USING is also the WITH CHECK, so an object cannot be renamed onto an attached path either.
-- INSERT and SELECT are unchanged.
-- Not closed here (review finding, filed as Q2839): a client that may write the proof arrays on the jobs row
-- can still REMOVE a path from it (the poster's jobs UPDATE policy has no column limit), which unattaches the photo.
--
-- Replay-safe: CREATE OR REPLACE; DROP POLICY IF EXISTS before CREATE POLICY (top level, as 20260925141905).
-- Guard: src/test/proofPhotosAttachedAreImmutable.test.ts; PGlite proof
-- src/test/pglite/proofPhotosAttachedAreImmutable.pglite.mjs (NEW_MIGRATION=skip is red).

CREATE OR REPLACE FUNCTION public.proof_photo_object_attached(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_name IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE p_name = ANY (j.proof_before_urls)
          OR p_name = ANY (j.proof_after_urls)
          OR EXISTS (SELECT 1 FROM unnest(coalesce(j.proof_before_urls, '{}'::text[]) || coalesce(j.proof_after_urls, '{}'::text[])) u
                      WHERE position('/proof-photos/' || p_name IN u) > 0)
    )
    OR EXISTS (
      SELECT 1 FROM public.job_revisions r
       WHERE p_name = ANY (r.photos)
          OR EXISTS (SELECT 1 FROM unnest(coalesce(r.photos, '{}'::text[])) u WHERE position('/proof-photos/' || p_name IN u) > 0)
    )
    OR EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE p_name = ANY (g.proof_before_urls)
          OR p_name = ANY (g.proof_after_urls)
    )
  );
$fn$;
REVOKE ALL ON FUNCTION public.proof_photo_object_attached(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proof_photo_object_attached(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can update their own proof photos" ON storage.objects;
CREATE POLICY "Users can update their own proof photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND (storage.foldername(name))[2] IS DISTINCT FROM 'disputes'
    AND owner = (select auth.uid())
    AND (
      ((select auth.uid()))::text = (storage.foldername(name))[1]
      OR public.is_party_to_job_folder(name)
    )
    AND NOT public.proof_photo_object_attached(name)
  );

DROP POLICY IF EXISTS "Users can delete their own proof photos" ON storage.objects;
CREATE POLICY "Users can delete their own proof photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND (storage.foldername(name))[2] IS DISTINCT FROM 'disputes'
    AND owner = (select auth.uid())
    AND (
      ((select auth.uid()))::text = (storage.foldername(name))[1]
      OR public.is_party_to_job_folder(name)
    )
    AND NOT public.proof_photo_object_attached(name)
  );
