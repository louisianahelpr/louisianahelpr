-- Stop unpublished marketing art being ENUMERABLE, without breaking Instagram.
--
-- `marketing-media` carried two policies on storage.objects:
--   "Admins write marketing media"        ALL    {authenticated}  + has_role(admin)
--   "Marketing media is publicly readable" SELECT {anon,authenticated}
--
-- The second was added so Instagram could fetch the image: the Content
-- Publishing API pulls the URL server-side, so a signed URL cannot be used and
-- the bucket has to be public. That reasoning is sound; the policy is not the
-- thing that makes it work, and this was verified rather than assumed.
--
-- ── What was measured, on prod, 2026-09-04 ───────────────────────────────
-- `avatars` is also a public bucket, and its ONLY read policy is
-- SELECT {authenticated} — no anon. An unauthenticated fetch of an avatar was
-- made on both storage routes:
--
--   GET /storage/v1/object/public/avatars/<path>   -> 200, content-type image/png
--   GET /storage/v1/object/avatars/<path>          -> 200, content-type image/png
--
-- No Authorization header on either. So for a bucket with `public = true`,
-- object READS are served regardless of the SELECT policies on
-- storage.objects. The policy therefore grants nothing that the public flag was
-- not already granting, and removing it cannot break Meta's fetch. That is the
-- fact this migration rests on, and it is the one that had to be true.
--
-- What the policy DID enable is `POST /storage/v1/object/list/marketing-media`
-- — enumeration. Marketing rows are drafted and scheduled ahead of time, so the
-- bucket is a preview of unannounced campaigns: filenames, cadence, and how much
-- is queued. Not a severe leak, and the bucket holds zero objects today, which
-- is exactly why this is the cheap moment to close it.
--
-- Admins keep listing through the ALL policy above, which is what the composer's
-- media picker uses. Nothing in the app calls `.list()` on this bucket today
-- (`src/components/admin/marketing/marketingMedia.ts` only uploads and calls
-- `getPublicUrl`, which is a client-side string builder and touches no policy).
DROP POLICY IF EXISTS "Marketing media is publicly readable" ON storage.objects;

-- Deliberately NOT replaced with an admin-only SELECT policy: "Admins write
-- marketing media" is already `FOR ALL`, which includes SELECT. A second
-- overlapping policy would be redundant and would have to be kept in step.

-- Replay-safe: DROP ... IF EXISTS is idempotent, and re-running after the
-- policy is gone is a no-op.

DO $$
DECLARE
  n_public integer;
  n_admin  integer;
BEGIN
  SELECT count(*) INTO n_public
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'Marketing media is publicly readable';
  IF n_public <> 0 THEN
    RAISE EXCEPTION 'public read policy on marketing-media survived the drop';
  END IF;

  -- The admin path must still exist, or the owner cannot upload art at all and
  -- the whole pipeline stalls with no way to fix it from the UI.
  SELECT count(*) INTO n_admin
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'Admins write marketing media';
  IF n_admin <> 1 THEN
    RAISE EXCEPTION 'admin policy on marketing-media is missing — uploads would break';
  END IF;

  -- And the bucket must still be public, or Instagram cannot fetch the image.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'marketing-media' AND public) THEN
    RAISE EXCEPTION 'marketing-media is no longer public — Instagram publishing would break';
  END IF;
END $$;
