-- Create the `profile-videos` bucket + owner RLS policies.
--
-- ProfileLanding.handleVideoUpload uploads a member's intro video to
-- `supabase.storage.from("profile-videos").upload(..., { upsert: true })`
-- and renders it via getPublicUrl on the public profile. But the bucket was
-- never defined in a migration and does not exist in prod, so EVERY intro
-- video upload fails with "Couldn't upload that video" — a shipped feature
-- that is dead on production.
--
-- This mirrors the `avatars` public-bucket pattern
-- (20260505220000_split_avatars_bucket_private_user_documents.sql): a public
-- bucket (the video is marketplace-visible by design) with owner-scoped
-- INSERT/UPDATE/DELETE and an explicit owner SELECT — the SELECT is what makes
-- upsert work, because supabase-js `upsert: true` issues INSERT ... ON CONFLICT
-- and Postgres requires the row to pass SELECT for conflict arbitration (the
-- exact bug fixed for avatars in 20260702050000).
--
-- Replay-safe: ON CONFLICT on the bucket insert, DROP POLICY IF EXISTS guards.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-videos',
  'profile-videos',
  true,
  30 * 1024 * 1024,  -- 30 MB cap (matches VIDEO_UPLOAD_MAX_BYTES client guard)
  ARRAY['video/mp4', 'video/quicktime', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read: the intro video is shown on the public profile. Explicit
-- policy for authenticated/anon direct storage.objects queries; public-URL
-- reads go through the bucket's public flag regardless.
DROP POLICY IF EXISTS "profile-videos: public read" ON storage.objects;
CREATE POLICY "profile-videos: public read"
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'profile-videos');

DROP POLICY IF EXISTS "profile-videos: owner upload" ON storage.objects;
CREATE POLICY "profile-videos: owner upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "profile-videos: owner update" ON storage.objects;
CREATE POLICY "profile-videos: owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "profile-videos: owner delete" ON storage.objects;
CREATE POLICY "profile-videos: owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
