-- =============================================
-- 1. job-photos storage: ownership-based RLS
-- =============================================

DROP POLICY IF EXISTS "Users can upload job photos to own folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can list own job photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own job photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own job photos" ON storage.objects;

-- INSERT: allow if folder is 'chat' (message attachments) OR folder is a job UUID owned by the user
CREATE POLICY "Users upload job photos for owned jobs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'job-photos'
  AND (
    (storage.foldername(name))[1] = 'chat'
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id::text = (storage.foldername(name))[1]
        AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
    )
  )
);

-- SELECT
CREATE POLICY "Users view job photos for related jobs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'job-photos'
  AND (
    (storage.foldername(name))[1] = 'chat'
    OR has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id::text = (storage.foldername(name))[1]
        AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
    )
  )
);

-- UPDATE
CREATE POLICY "Users update job photos for owned jobs"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'job-photos'
  AND EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id::text = (storage.foldername(name))[1]
      AND j.customer_id = auth.uid()
  )
);

-- DELETE
CREATE POLICY "Users delete job photos for owned jobs"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'job-photos'
  AND EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id::text = (storage.foldername(name))[1]
      AND j.customer_id = auth.uid()
  )
);

-- =============================================
-- 2. notification_logs: clearer service-role policies
-- =============================================

DROP POLICY IF EXISTS "Service role inserts notification logs" ON public.notification_logs;

CREATE POLICY "Only service role can insert notification logs"
ON public.notification_logs FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can read notification logs"
ON public.notification_logs FOR SELECT
TO service_role
USING (true);
