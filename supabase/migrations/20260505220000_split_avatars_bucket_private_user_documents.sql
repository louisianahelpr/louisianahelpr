-- Split user-documents bucket into:
--   - `avatars` (public) — profile pictures, marketplace-visible by design
--   - `user-documents` (private) — license, insurance, IDV docs, support attachments
--
-- Background: previously both were stored in a single `user-documents`
-- bucket marked public=true with path structure `<user_id>/<filename>`.
-- Anyone who scraped a user UUID (visible in /user/:userId routes) could
-- guess `<UUID>/license.pdf` and fetch a private document. Real privacy
-- issue.
--
-- Fix: separate buckets so privacy controls match content type. Avatars
-- stay public (needed for marketplace display). License/insurance/IDV
-- become private (signed-URL access only).

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Create avatars bucket (public, image-only, 5MB cap)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5 * 1024 * 1024,  -- 5 MB cap (matches existing client-side check)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. RLS policies for avatars bucket
-- ──────────────────────────────────────────────────────────────────────────────
-- Public-read works via the storage worker's separate code path (the
-- bucket's public=true flag), but we add an explicit SELECT policy too
-- for direct storage.objects queries from authenticated clients.
DROP POLICY IF EXISTS "avatars: public read" ON storage.objects;
CREATE POLICY "avatars: public read"
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars: owner upload" ON storage.objects;
CREATE POLICY "avatars: owner upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "avatars: owner update" ON storage.objects;
CREATE POLICY "avatars: owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "avatars: owner delete" ON storage.objects;
CREATE POLICY "avatars: owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Make user-documents bucket private
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE storage.buckets
SET public = false
WHERE id = 'user-documents';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Drop the broad "Public read" policy on user-documents
-- ──────────────────────────────────────────────────────────────────────────────
-- The owner/admin SELECT policies handle legitimate access. Public read is
-- removed so anon can't enumerate or fetch private documents.
DROP POLICY IF EXISTS "Public read user-documents" ON storage.objects;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. Replace user-documents SELECT with owner OR admin policy
-- ──────────────────────────────────────────────────────────────────────────────
-- Existing "Users can list own user documents" only covers SELECT for the
-- owner. Admins reviewing the credential queue need to read other users'
-- documents too. Combine into one policy.
DROP POLICY IF EXISTS "Users can list own user documents" ON storage.objects;
CREATE POLICY "user-documents: owner or admin read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'user-documents'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  );

-- Existing INSERT/UPDATE/DELETE policies remain (Owner upload/update/delete user-documents).

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. License / insurance URL columns now hold PATH (not URL)
-- ──────────────────────────────────────────────────────────────────────────────
-- Document this in COMMENT so future maintainers don't get confused.
-- Data state: 0 files in user-documents currently store license/insurance,
-- so no migration is needed for existing rows.
COMMENT ON COLUMN public.profiles.license_url IS
  'Storage path within the user-documents bucket (e.g. <user_id>/license.pdf), NOT a full URL. Resolve via supabase.storage.from("user-documents").createSignedUrl(path, ttl) at display time. Bucket is private as of 2026-05-05.';

COMMENT ON COLUMN public.profiles.insurance_url IS
  'Storage path within the user-documents bucket (e.g. <user_id>/insurance.pdf), NOT a full URL. Resolve via supabase.storage.from("user-documents").createSignedUrl(path, ttl) at display time. Bucket is private as of 2026-05-05.';

COMMENT ON COLUMN public.profiles.avatar_url IS
  'Full public URL of the user avatar in the avatars bucket. Bucket is public; URL can be rendered directly in <img src=>.';
