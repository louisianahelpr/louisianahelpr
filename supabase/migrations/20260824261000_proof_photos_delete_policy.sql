-- proof-photos gains DELETE for the owner's own folder (2026-08-24 sweep:
-- the bucket had INSERT/UPDATE/SELECT but no DELETE, so a mistaken
-- before/after photo could only be overwritten, never removed — and photos
-- now GATE payout, so a wrong upload shouldn't be permanent). Scope is
-- identical to the existing update/insert policies: your own folder only.
-- Deleting a photo a jobs row still references simply breaks that URL;
-- the completion gate counts array entries, so helpers who delete must
-- re-upload before marking done — the gate logic is unaffected.
DROP POLICY IF EXISTS "Users can delete their own proof photos" ON storage.objects;
CREATE POLICY "Users can delete their own proof photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );
