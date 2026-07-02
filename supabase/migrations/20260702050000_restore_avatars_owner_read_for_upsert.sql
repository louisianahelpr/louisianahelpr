-- Restore a SELECT policy on the avatars bucket — scoped to the OWNER only.
--
-- 20260505224500_drop_broad_public_read_policies.sql dropped
-- "avatars: public read" to block anon enumeration of user UUIDs via
-- storage.objects listing (public-URL reads don't consult RLS, so display
-- was unaffected). Side effect nobody caught: that left the avatars bucket
-- with ZERO SELECT policies, and PostgreSQL requires the new row to pass
-- SELECT policies whenever an INSERT carries an ON CONFLICT clause (the
-- conflict arbitration must be able to read the target row). supabase-js
-- `upload(..., { upsert: true })` always issues INSERT ... ON CONFLICT, so
-- EVERY client-side avatar upload started failing with
-- "new row violates row-level security policy" — the CompleteProfile
-- "Enter app" blocker. Edge-function (service-role) uploads bypassed RLS,
-- which is why some avatars still worked.
--
-- Owner-scoped SELECT restores upsert (the new row is always in the
-- uploader's own folder) WITHOUT re-opening anon/cross-user enumeration.
DROP POLICY IF EXISTS "avatars: owner read" ON storage.objects;
CREATE POLICY "avatars: owner read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
