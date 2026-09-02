-- A helper cannot upload proof photos AT ALL, which blocks every payout.
--
-- src/components/PhotoProof.tsx uploads to `<jobId>/<type>-<ts>.<ext>`, but
-- every proof-photos policy requires the caller's UID as the first path
-- segment (20260403180510 INSERT, 20260403180630 UPDATE, 20260824261000
-- DELETE). Those can never match a jobId, so the upload always fails:
--
--   HTTP 400 {"statusCode":"403",
--             "message":"new row violates row-level security policy"}
--
-- Proof photos GATE completion — the "I'm Done" button stays disabled with
-- "Before & after photos are required — they're the proof that releases your
-- payment" — so `helper_completed_at` is never stamped, the poster never gets
-- an Approve action, and escrow can never be released through the normal
-- flow. A full lifecycle run on 2026-08-31 dead-ended here.
--
-- The sibling `job-photos` bucket already solved this exact problem
-- (20260429194624): allow a `<jobId>/…` path when the caller is that job's
-- customer or helper. That pattern is ported here, for all four verbs, so
-- both parties can upload proof and both can read it back — the poster has to
-- see the helper's before/after photos to approve the release.
--
-- Uploader-owned `<uid>/…` paths stay permitted so nothing already in the
-- bucket becomes unreadable.

-- Reusable predicate: the path's first segment is a job this caller is party to.
CREATE OR REPLACE FUNCTION public.is_party_to_job_folder(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id::text = (storage.foldername(object_name))[1]
      AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
  );
$function$;

REVOKE ALL ON FUNCTION public.is_party_to_job_folder(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_party_to_job_folder(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can upload proof photos to own folder" ON storage.objects;
CREATE POLICY "Users can upload proof photos to own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'proof-photos'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.is_party_to_job_folder(name)
    )
  );

-- SELECT: the bucket is private (20260403194800) and the client reads through
-- createSignedUrl, which requires SELECT. Both parties must be able to read —
-- the poster approves the release based on these photos.
DROP POLICY IF EXISTS "Users can read proof photos for their jobs" ON storage.objects;
CREATE POLICY "Users can read proof photos for their jobs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.is_party_to_job_folder(name)
    )
  );

DROP POLICY IF EXISTS "Users can update their own proof photos" ON storage.objects;
CREATE POLICY "Users can update their own proof photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.is_party_to_job_folder(name)
    )
  );

DROP POLICY IF EXISTS "Users can delete their own proof photos" ON storage.objects;
CREATE POLICY "Users can delete their own proof photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.is_party_to_job_folder(name)
    )
  );
