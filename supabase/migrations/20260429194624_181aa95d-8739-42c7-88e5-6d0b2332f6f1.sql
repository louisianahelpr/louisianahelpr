-- Tighten storage policies on the job-photos bucket.
-- Problem: chat uploads previously allowed any authenticated user to write
-- to the `chat/` folder regardless of job ownership, and overly broad
-- "Owner upload/update/delete job-photos" policies allowed writes to any
-- path matching the user's own UUID, conflicting with the job-id based
-- folder structure used elsewhere.

-- Drop overly permissive owner-by-uid policies (they don't match how the
-- bucket is actually structured: <jobId>/..., chat/<jobId>/..., <userId>/avatar).
DROP POLICY IF EXISTS "Owner upload job-photos" ON storage.objects;
DROP POLICY IF EXISTS "Owner update job-photos" ON storage.objects;
DROP POLICY IF EXISTS "Owner delete job-photos" ON storage.objects;

-- Replace the loose "Users upload job photos for owned jobs" insert policy
-- (which allowed any chat/* upload) with one that requires job participation
-- for chat uploads too. New chat path layout: chat/<jobId>/<filename>.
DROP POLICY IF EXISTS "Users upload job photos for owned jobs" ON storage.objects;

CREATE POLICY "Users upload job photos for owned jobs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'job-photos'
  AND (
    -- Avatar uploads: <userId>/avatar.* — only the user themselves
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    -- Job proof photos: <jobId>/... — must own or be assigned to the job
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id::text = (storage.foldername(name))[1]
        AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
    )
    OR
    -- Chat attachments: chat/<jobId>/... — must be a participant on that job
    (
      (storage.foldername(name))[1] = 'chat'
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id::text = (storage.foldername(name))[2]
          AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
      )
    )
  )
);

-- Update the related-jobs SELECT policy so that the chat folder also
-- requires job participation rather than being readable by any folder
-- segment matching 'chat'. Public read still applies for legacy/public
-- assets via the "Public read job-photos" policy (bucket is public for
-- backwards compatibility with already-shared avatar/proof URLs), but
-- this tightens authenticated-path verification used by the app.
DROP POLICY IF EXISTS "Users view job photos for related jobs" ON storage.objects;

CREATE POLICY "Users view job photos for related jobs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'job-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id::text = (storage.foldername(name))[1]
        AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
    )
    OR (
      (storage.foldername(name))[1] = 'chat'
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id::text = (storage.foldername(name))[2]
          AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
      )
    )
  )
);