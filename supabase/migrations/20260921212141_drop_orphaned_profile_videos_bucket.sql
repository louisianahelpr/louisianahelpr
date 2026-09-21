-- Drop the orphaned `profile-videos` bucket and its four policies.
--
-- The helper intro-video FEATURE was removed in two steps: the UI first, then
-- 20260827120000_remove_helper_intro_video_data_layer, which dropped the three
-- `profiles.intro_video_*` columns and rebuilt `get_safe_profiles` without
-- them. Neither step touched storage, so the bucket outlived the feature it
-- existed for.
--
-- Measured on prod 2026-09-21:
--
--   bucket          public = true, 30 MB limit, video/mp4|quicktime|webm
--   objects         0
--   INSERT policy   authenticated, own <uid>/ folder
--   SELECT policy   anon + authenticated  -> world-readable
--   UPDATE/DELETE   authenticated, own folder
--
-- So any signed-in account could upload 30 MB of video per file into a
-- world-readable bucket belonging to a feature that no longer exists — with no
-- UI, nothing that would ever surface or moderate what landed there, and
-- nobody watching it against the free-tier storage quota. Nothing was ever
-- uploaded (0 objects), so this removes exposure rather than cleaning up a
-- leak.
--
-- Safe in either deploy order. `accountPurge.ts` lists this bucket among the
-- IDENTITY_BUCKETS it purges, and BOTH of its loops already skip a bucket
-- whose listing says "not found"/"does not exist", so account deletion does
-- not fail closed when the bucket is gone. The dead list entry is removed in
-- the same commit.
--
-- Replay-safe: every statement is guarded, and the deletes are no-ops once the
-- rows are gone.

DROP POLICY IF EXISTS "profile-videos: public read"  ON storage.objects;
DROP POLICY IF EXISTS "profile-videos: owner upload" ON storage.objects;
DROP POLICY IF EXISTS "profile-videos: owner update" ON storage.objects;
DROP POLICY IF EXISTS "profile-videos: owner delete" ON storage.objects;

-- Objects first: storage.objects has an FK to storage.buckets, so a bucket
-- still holding rows cannot be removed. Prod holds zero, but a replay against
-- an environment that has some must not fail here.


-- `social-posts`, same orphan shape, milder (owner decision 2026-09-21).
--
-- Created 20260419014532 for admin-posted social images and referenced by NO
-- application code — not src/, not supabase/functions/. Public read, but its
-- INSERT is `has_role(auth.uid(), 'admin')`, so unlike profile-videos it was
-- dead rather than exposed. 0 objects on prod. The marketing surface uses
-- `marketing-media`, which is untouched by this migration.
DROP POLICY IF EXISTS "Admins can upload social post images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can list social post images"   ON storage.objects;


-- `business-documents`: DRIFT REPAIR, a no-op against prod today.
--
-- Created by 20260425235407. When the business-seats product was removed,
-- 20260828011811 dropped its four policies but deliberately kept the bucket
-- ("leaves the bucket with no policy — closed to every client"). The bucket
-- was then deleted OUT OF BAND — prod has no such bucket, no objects and no
-- policies (verified 2026-09-21), but no migration ever said so.
--
-- That gap only bites in the one situation where it is most expensive: a
-- from-scratch replay, i.e. the disaster-recovery path, would faithfully
-- recreate a bucket for a product that no longer exists. Stating the deletion
-- here makes the migrations describe the database we actually have.

-- ---------------------------------------------------------------------------
-- The deletes themselves.
--
-- `storage.protect_delete()` guards BOTH storage.objects and storage.buckets
-- and refuses any direct DELETE with 42501 "Direct deletion from storage
-- tables is not allowed. Use the Storage API instead." (This migration failed
-- exactly that way on its first db-deploy run.) The guard carries its own
-- sanctioned escape hatch:
--
--   IF COALESCE(current_setting('storage.allow_delete_query', true), 'false')
--      != 'true' THEN RAISE ...
--
-- so the supported way to do this in SQL is to set that GUC. It is set LOCAL,
-- inside a DO block, which matters: a DO block executes as a single statement
-- and therefore in a single transaction, so the setting covers the deletes and
-- cannot outlive them even if the CLI does not wrap the file in an explicit
-- transaction.
--
-- Doing it here rather than by hand through the Storage API is deliberate —
-- the `business-documents` repair above exists precisely because the last
-- bucket deletion happened out of band and no migration ever recorded it.
--
-- Replay-safe: every DELETE is a no-op once its rows are gone.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  SET LOCAL storage.allow_delete_query = 'true';

  DELETE FROM storage.objects
   WHERE bucket_id IN ('profile-videos', 'social-posts', 'business-documents');

  DELETE FROM storage.buckets
   WHERE id IN ('profile-videos', 'social-posts', 'business-documents');
END $$;
