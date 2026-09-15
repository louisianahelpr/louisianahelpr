-- Cap size and MIME on the PUBLIC storage buckets that shipped with neither.
--
-- Problem (authz-rls hole hunt 2026-09-15, H-003): `job-photos` is a PUBLIC
-- bucket created as `(id, name, public) VALUES ('job-photos','job-photos', true)`
-- with NO `file_size_limit` and NO `allowed_mime_types`. Its INSERT policy lets
-- any signed-in user write to `job-photos/<their-own-uid>/…` (used legitimately
-- by review-photo uploads, see below) and every object is then world-readable
-- at `/storage/v1/object/public/job-photos/<path>` with no auth. Net effect: an
-- unbounded, permanent, publicly-served file host of arbitrary size and type
-- inside prod. `marketing-media` and `social-posts` have the same gap — both
-- were created `public = true` with null limits.
--
-- Fix: give each public bucket a `file_size_limit` and an `allowed_mime_types`
-- allow-list, so "arbitrary large files / arbitrary types" is no longer
-- reachable. The `public` flag is deliberately LEFT AS-IS on all three:
--
--   * job-photos — the app renders job photos, review photos and scope videos
--     straight from `getPublicUrl()` into `<img>/<video src>` (see
--     src/pages/postjob/useJobMediaUpload.ts, src/components/reviewPanel/
--     ReviewForm.tsx, src/lib/imageUrl.ts). Serving is by direct public URL,
--     not signed URL, so the bucket stays PUBLIC and we cap size/MIME instead.
--     MIME set = the four image types the picker accepts
--     (jpeg/png/webp/gif) PLUS the three scope-video types profile-videos
--     already allows (mp4/quicktime/webm), because scope videos upload into
--     THIS bucket too. 50 MB covers a "30s max" phone clip (there is no
--     client-side video size guard yet — flagged to the lead).
--
--   * marketing-media — admin-uploaded art fetched server-side by Instagram's
--     Content Publishing API, which cannot use a signed/private URL, so it
--     MUST stay public (the marketing-autoposter migration says the same). Cap
--     mirrors the client guard in src/components/admin/marketing/marketingMedia.ts
--     (8 MB; image/jpeg, image/png, image/webp).
--
--   * social-posts — legacy admin-only marketing images served via the public
--     CDN; no active client writer remains. Same image-only caps as
--     marketing-media. Kept public to preserve any already-shared CDN URLs.
--
-- NOT touched, on purpose:
--   * INSERT policies. The only client-reachable INSERT branch flagged in H-003
--     (`job-photos` `(storage.foldername(name))[1] = auth.uid()::text`) writes
--     under the caller's OWN uid, never someone else's path, and is LIVE — it is
--     how ReviewForm writes public review photos to `<uid>/reviews/…`. Deleting
--     it (as the finding's fix-direction suggested) would break review-photo
--     uploads, so it stays; the size/MIME cap is what neutralises the exposure.
--   * The private document buckets (id-documents, user-documents). They are not
--     public and complete-signup uploads to them under the service role with a
--     documented `application/octet-stream` fallback for un-updatable shipped
--     clients (supabase/functions/_shared/storageKeys.ts); pinning an
--     allowed_mime_types list there would reject that fallback. Out of scope for
--     this public-bucket hardening.
--
-- REPLAY-SAFETY: guarded on `to_regclass('storage.buckets')` and expressed as
-- idempotent UPDATEs, so a from-scratch rebuild that has not yet created these
-- buckets simply updates zero rows and a re-run is a no-op. Mirrors the pattern
-- in 20260914200051_message_attachments_path_scoped_read_and_voice_notes.sql.

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;

  -- job-photos: images the picker accepts + scope-video types (same bucket).
  UPDATE storage.buckets
     SET file_size_limit  = 50 * 1024 * 1024,  -- 50 MB — covers a short scope video
         allowed_mime_types = ARRAY[
           'image/jpeg', 'image/png', 'image/webp', 'image/gif',
           'video/mp4', 'video/quicktime', 'video/webm'
         ]
   WHERE id = 'job-photos';

  -- marketing-media: admin art, image-only, matches the client's 8 MB guard.
  UPDATE storage.buckets
     SET file_size_limit  = 8 * 1024 * 1024,
         allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
   WHERE id = 'marketing-media';

  -- social-posts: legacy admin marketing images, same image-only caps.
  UPDATE storage.buckets
     SET file_size_limit  = 8 * 1024 * 1024,
         allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
   WHERE id = 'social-posts';
END $$;
