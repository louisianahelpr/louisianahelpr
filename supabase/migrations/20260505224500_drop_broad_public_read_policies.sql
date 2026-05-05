-- Both `avatars` and `job-photos` buckets have public=true, which means
-- legitimate object access (the public URL pattern
-- /storage/v1/object/public/<bucket>/<path>) works via the storage
-- worker's separate code path — RLS isn't consulted for that access.
--
-- The broad "public read" SELECT policies on storage.objects allowed
-- direct queries against storage.objects from anon clients, which lets
-- them LIST (enumerate) every file in the bucket. Filename patterns
-- can leak structure (`<user_id>/avatar.png`) and let attackers iterate
-- through user UUIDs.
--
-- Dropping these policies blocks anon enumeration without affecting
-- public URL access. Authenticated participants get more nuanced
-- access via the existing "Users view job photos for related jobs"
-- and similar policies.

DROP POLICY IF EXISTS "avatars: public read" ON storage.objects;
DROP POLICY IF EXISTS "Public read job-photos" ON storage.objects;
