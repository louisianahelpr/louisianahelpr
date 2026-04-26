-- Fix business-documents storage policies: foldername() must be called on the
-- storage object's path (storage.objects.name), not the business name column.
-- Files are stored at "<business_id>/..." so the first folder segment is the business id.

DROP POLICY IF EXISTS "Business owners read own business documents" ON storage.objects;
DROP POLICY IF EXISTS "Business owners upload own business documents" ON storage.objects;
DROP POLICY IF EXISTS "Business owners update own business documents" ON storage.objects;
DROP POLICY IF EXISTS "Business owners delete own business documents" ON storage.objects;

CREATE POLICY "Business owners read own business documents"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'business-documents'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.owner_id = auth.uid()
        AND (b.id)::text = (storage.foldername(storage.objects.name))[1]
    )
  )
);

CREATE POLICY "Business owners upload own business documents"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'business-documents'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND (b.id)::text = (storage.foldername(storage.objects.name))[1]
  )
);

CREATE POLICY "Business owners update own business documents"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'business-documents'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND (b.id)::text = (storage.foldername(storage.objects.name))[1]
  )
);

CREATE POLICY "Business owners delete own business documents"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'business-documents'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND (b.id)::text = (storage.foldername(storage.objects.name))[1]
  )
);